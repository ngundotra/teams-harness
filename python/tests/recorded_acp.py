#!/usr/bin/env python3
"""Recorded ACP stdio peer for tests. Speaks JSON-RPC NDJSON. Not a grok shim."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

_REPLY_LOCK = threading.Lock()


def _log(obj: object) -> None:
    path = os.environ.get("RECORDED_ACP_LOG")
    if not path:
        return
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(obj, separators=(",", ":")) + "\n")


def _reply(req_id: object, result: object) -> None:
    payload = (json.dumps({"jsonrpc": "2.0", "id": req_id, "result": result}, separators=(",", ":")) + "\n").encode("utf-8")
    with _REPLY_LOCK:
        sys.stdout.buffer.write(payload)
        sys.stdout.buffer.flush()


def _wait_hold(env_name: str) -> None:
    path = os.environ.get(env_name)
    if not path:
        return
    deadline = time.time() + 30
    while not Path(path).exists():
        if time.time() > deadline:
            break
        time.sleep(0.01)


def _prompt_text(params: object) -> str:
    if not isinstance(params, dict):
        return ""
    prompt = params.get("prompt")
    if not isinstance(prompt, list):
        return ""
    parts: list[str] = []
    for item in prompt:
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(str(item.get("text") or ""))
    return "\n".join(parts)


def _phase(text: str) -> str:
    if '"phase":"inject"' in text or '"phase": "inject"' in text:
        return "inject"
    if '"phase":"drain"' in text or '"phase": "drain"' in text:
        return "drain"
    if '"phase":"start"' in text or '"phase": "start"' in text:
        return "start"
    return "other"


def _mark_mcp_ready() -> None:
    turn_id = os.environ.get("TURN_ID")
    turns = os.environ.get("TURNS_DIR", "/tmp/turns")
    if not turn_id:
        return
    directory = Path(turns) / turn_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "mcp-ready-read").write_text("session/new\n", encoding="utf-8")
    (directory / "mcp-ready-write").write_text("session/new\n", encoding="utf-8")


def _consume_inbox() -> None:
    turn_id = os.environ.get("TURN_ID")
    turns = os.environ.get("TURNS_DIR", "/tmp/turns")
    if not turn_id:
        return
    directory = Path(turns) / turn_id
    inbox = directory / "inbox.jsonl"
    cursor = directory / "inbox.cursor"
    count = 0
    if inbox.exists():
        count = sum(1 for line in inbox.read_text(encoding="utf-8").splitlines() if line.strip())
    directory.mkdir(parents=True, exist_ok=True)
    cursor.write_text(f"{count}\n", encoding="utf-8")


def _handle(msg: dict[str, object], session_id: str, offer_auth: str) -> None:
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params")
    if method == "initialize":
        result: dict[str, object] = {"protocolVersion": 1, "agentCapabilities": {}}
        if offer_auth:
            result["authMethods"] = [{"id": offer_auth}]
        _reply(req_id, result)
        return
    if method == "authenticate":
        _reply(req_id, {})
        return
    if method == "session/new":
        _wait_hold("RECORDED_ACP_HOLD_SESSION")
        _mark_mcp_ready()
        _reply(req_id, {"sessionId": session_id})
        return
    if method == "session/prompt":
        text = _prompt_text(params)
        phase = _phase(text)
        if phase == "start":
            _wait_hold("RECORDED_ACP_HOLD_START")
        elif phase == "inject":
            _wait_hold("RECORDED_ACP_HOLD_INJECT")
        elif phase == "drain":
            _consume_inbox()
        _reply(req_id, {"stopReason": "end_turn"})
        return
    if req_id is not None:
        _reply(req_id, {})


def main() -> None:
    session_id = os.environ.get("RECORDED_ACP_SESSION", "sess_recorded_1")
    offer_auth = os.environ.get("RECORDED_ACP_AUTH", "cached_token")
    # Hold replies off the stdin loop so a mid-turn inject can be logged
    # while the start prompt is still outstanding — same as a live ACP peer.
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(msg, dict):
            continue
        _log(msg)
        threading.Thread(
            target=_handle,
            args=(msg, session_id, offer_auth),
            name=f"acp-{msg.get('method')}",
            daemon=True,
        ).start()
    # Keep the process alive until in-flight holds finish (or the host SIGTERMs).
    time.sleep(0.05)


if __name__ == "__main__":
    main()
