from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path
from subprocess import PIPE, Popen

from teams_harness.host import HarnessHost
from teams_harness.mcp_recorder import McpRecorder
from teams_harness.turn_store import TurnStore

RECORDED_ACP = Path(__file__).resolve().parent / "recorded_acp.py"


def spawn_recorded(env: dict[str, str], extra: dict[str, str] | None = None) -> Popen[bytes]:
    merged = {**os.environ, **env, **(extra or {})}
    pythonpath = str(Path(__file__).resolve().parent.parent)
    existing = merged.get("PYTHONPATH", "")
    merged["PYTHONPATH"] = pythonpath if not existing else f"{pythonpath}{os.pathsep}{existing}"
    merged.setdefault("PYTHONUNBUFFERED", "1")
    return Popen(
        [sys.executable, "-u", str(RECORDED_ACP)],
        stdin=PIPE,
        stdout=PIPE,
        stderr=PIPE,
        env=merged,
    )


def make_host(spawn: Callable[[dict[str, str]], Popen[bytes]] | None = None) -> HarnessHost:
    return HarnessHost(store=TurnStore(), mcp=McpRecorder(), spawn=spawn)


def read_jsonl(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    out: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        raw = json.loads(trimmed)
        if isinstance(raw, dict):
            out.append(raw)
    return out


def prompt_text(msg: dict[str, object]) -> str:
    params = msg.get("params")
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


def prompt_phase(msg: dict[str, object]) -> str | None:
    text = prompt_text(msg)
    for phase in ("start", "inject", "drain"):
        if f'"phase":"{phase}"' in text or f'"phase": "{phase}"' in text:
            return phase
    return None


def session_prompts(log: list[dict[str, object]]) -> list[dict[str, object]]:
    return [m for m in log if m.get("method") == "session/prompt"]


def wait_until(predicate: Callable[[], bool], timeout: float, *, interval: float = 0.02) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(interval)
    raise TimeoutError("condition not met")


def wait_log(path: Path, match: Callable[[list[dict[str, object]]], bool], timeout: float = 8.0) -> list[dict[str, object]]:
    def _ready() -> bool:
        return match(read_jsonl(path))

    wait_until(_ready, timeout)
    return read_jsonl(path)


def touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("ok\n", encoding="utf-8")
