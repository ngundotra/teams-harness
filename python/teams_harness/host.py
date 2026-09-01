from __future__ import annotations

import os
import sys
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from pathlib import Path
from subprocess import Popen
from typing import Any

from .acp_client import AcpClient, auth_method_id
from .inbox import append_inbox, mcp_ready_role_path, pending_inbox_count, read_mcp_calls
from .mcp_recorder import McpRecorder
from .mcp_spec import grok_config_for_mcp, teams_mcp_servers
from .prompt import drain_prompt, followup_prompt, reaction_prompt, start_prompt
from .spawn import GROK_ACP_ARGS, GROK_BIN, spawn_grok
from .tools import extract_post_text, is_post_tool, write_scope_from_message
from .turn_store import TurnStore, new_turn_id, turns_root
from .types import (
    AckRecord,
    InboxFollowup,
    InboxReaction,
    InboundMessage,
    InboundReaction,
    StoredReaction,
    TurnId,
    TurnRunning,
    is_record,
    read_string,
)


SpawnFn = Callable[[dict[str, str]], Popen[bytes]]


class HarnessHost:
    """ACP handoff host. Production spawn is real grok; MCP is the Teams plane."""

    def __init__(
        self,
        *,
        store: TurnStore,
        mcp: McpRecorder | None = None,
        spawn: SpawnFn | None = None,
    ) -> None:
        self.store = store
        self.mcp = mcp if mcp is not None else McpRecorder()
        self.acks: list[AckRecord] = []
        self.children: dict[TurnId, Popen[bytes]] = {}
        self.last_spawn_args: list[str] = []
        self.last_spawn_file = ""
        self.inbound_message_ids: set[str] = set()
        self.callback_url: str | None = None
        self._spawn = spawn or spawn_grok
        self._jobs: dict[TurnId, Future[None]] = {}
        self._disposed = False
        self._poll_stop = threading.Event()
        self._disposers: list[Callable[[], None]] = []
        self._acp_by_turn: dict[TurnId, AcpClient] = {}
        self._session_by_turn: dict[TurnId, str] = {}
        self._inject_waits: dict[TurnId, list[Future[object]]] = {}
        self._session_ready: dict[TurnId, threading.Event] = {}

    def session_id(self, turn_id: TurnId) -> str | None:
        return self._session_by_turn.get(turn_id)

    def acp_client(self, turn_id: TurnId) -> AcpClient | None:
        return self._acp_by_turn.get(turn_id)

    def wait_session(self, turn_id: TurnId, timeout: float) -> bool:
        event = self._session_ready.get(turn_id)
        if event is None:
            return False
        return event.wait(timeout)

    def start_turn(self, message: InboundMessage) -> TurnRunning:
        self.inbound_message_ids.add(message.message_id)
        turn_id = new_turn_id(message.conversation_key)
        self.acks.append(
            AckRecord(conversation_key=message.conversation_key, text="Working on it…", at=time.time())
        )
        self.mcp.remember_route(message.conversation_id, message.service_url, message.conversation_id)
        if message.channel_id is not None:
            self.mcp.remember_route(message.channel_id, message.service_url, message.conversation_id)
        if message.team_id is not None:
            self.mcp.remember_route(message.team_id, message.service_url, message.conversation_id)
        self.mcp.ack_immediate(message)

        spec_kwargs: dict[str, Any] = {
            "turn_id": turn_id,
            "turns_dir": turns_root(),
            "conversation_id": message.conversation_id,
            "service_url": message.service_url,
            "conversation_type": message.conversation_type,
            "write_scope": write_scope_from_message(message),
        }
        if self.callback_url:
            spec_kwargs["callback_url"] = self.callback_url
        servers = teams_mcp_servers(**spec_kwargs)
        child_env = {
            **os.environ,
            "HARNESS_JOB_MS": os.environ.get("HARNESS_JOB_MS") or "8000",
            "TURN_ID": turn_id,
            "TURNS_DIR": turns_root(),
            "CONVERSATION_ID": message.conversation_id,
            "SERVICE_URL": message.service_url,
            "CONVERSATION_TYPE": message.conversation_type,
            "GROK_CONFIG": grok_config_for_mcp(servers["read"], servers["write"]),
        }
        child = self._spawn(child_env)
        self.last_spawn_file = _spawnfile(child)
        self.last_spawn_args[:] = [GROK_BIN, *GROK_ACP_ARGS]
        pid = child.pid if child.pid is not None else -1
        self.store.increment_spawn()
        running = TurnRunning(
            kind="running",
            turn_id=turn_id,
            conversation_key=message.conversation_key,
            start_message=message,
            followups=[],
            inbound_reactions=[],
            set_reactions=[],
            pid=pid,
            started_at=time.time() * 1000,
        )
        self.store.put(running)
        self.children[turn_id] = child
        self._session_ready[turn_id] = threading.Event()
        self._start_poll(turn_id)
        job: Future[None] = Future()
        self._jobs[turn_id] = job

        def _run() -> None:
            try:
                self._run_grok(turn_id, child, message, servers)
                if not job.done():
                    job.set_result(None)
            except Exception as err:  # noqa: BLE001 — match TS: log and mark done
                text = str(err) if err else "grok failed"
                sys.stderr.write(f"[host] {text}\n")
                self.store.mark_done(turn_id)
                if not job.done():
                    job.set_exception(err)

        threading.Thread(target=_run, name=f"run-grok-{turn_id}", daemon=True).start()
        return running

    def enqueue_followup(self, turn_id: TurnId, message: InboundMessage) -> None:
        self.inbound_message_ids.add(message.message_id)
        current = self.store.get_by_id(turn_id)
        if current is None or current.kind != "running":
            return
        current.followups.append(message)
        self.store.put(current)
        append_inbox(turn_id, InboxFollowup(kind="followup", message=message))
        self.inject(turn_id, followup_prompt(message))

    def ferry_reaction(self, turn_id: TurnId, reaction: InboundReaction) -> None:
        current = self.store.get_by_id(turn_id)
        if current is None or current.kind != "running":
            return
        stored = StoredReaction(
            message_id=reaction.message_id,
            emoji=reaction.emoji,
            action=reaction.action,
            from_id=reaction.from_id,
        )
        current.inbound_reactions.append(stored)
        self.store.put(current)
        self.mcp.record_inbound(stored)
        append_inbox(
            turn_id,
            InboxReaction(
                kind="reaction",
                message_id=stored.message_id,
                emoji=stored.emoji,
                action=stored.action,
                from_id=stored.from_id,
            ),
        )
        self.inject(turn_id, reaction_prompt(stored))

    def wait_until_done(self, turn_id: TurnId, timeout_ms: int) -> None:
        started = time.time()
        while True:
            state = self.store.get_by_id(turn_id)
            if state is not None and state.kind == "done":
                self.mcp.hydrate_from_calls(read_mcp_calls(turn_id))
                return
            if (time.time() - started) * 1000 > timeout_ms:
                raise TimeoutError(f"timeout waiting for turn {turn_id}")
            time.sleep(0.025)

    def on_dispose(self, fn: Callable[[], None]) -> None:
        self._disposers.append(fn)

    def dispose(self) -> None:
        self._disposed = True
        self._poll_stop.set()
        for fn in self._disposers:
            fn()
        self._disposers.clear()
        for turn_id, child in list(self.children.items()):
            if child.poll() is None:
                child.terminate()
            self.store.mark_done(turn_id)
        self.children.clear()
        self._acp_by_turn.clear()
        self._session_by_turn.clear()
        self._inject_waits.clear()

    def inject(self, turn_id: TurnId, text: str) -> None:
        """Mid-turn extra session/prompt. No-ops until session/new has populated the maps."""
        acp = self._acp_by_turn.get(turn_id)
        session_id = self._session_by_turn.get(turn_id)
        if acp is None or session_id is None:
            return
        sys.stderr.write(f"[host] inject session/prompt {session_id}\n")
        pending = acp.request(
            "session/prompt",
            {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": text}],
            },
        )
        waits = self._inject_waits.setdefault(turn_id, [])
        waits.append(pending)

    def _run_grok(
        self,
        turn_id: TurnId,
        child: Popen[bytes],
        message: InboundMessage,
        servers: dict[str, Any],
    ) -> None:
        acp = AcpClient(child)
        init = acp.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientInfo": {"name": "teams-harness", "version": "0.1.0"},
                "clientCapabilities": {
                    "fs": {"readTextFile": True, "writeTextFile": True},
                    "terminal": True,
                },
            },
        ).result()
        sys.stderr.write(f"[host] initialize ok command={servers['read']['command']}\n")
        method_id = auth_method_id(init)
        if method_id is not None:
            acp.request("authenticate", {"methodId": method_id, "_meta": {"headless": True}}).result()
        created = acp.request(
            "session/new",
            {
                "cwd": os.getcwd(),
                "mcpServers": [servers["read"], servers["write"]],
            },
        ).result()
        session_id = read_string(created.get("sessionId")) if is_record(created) else None
        if session_id is None:
            raise RuntimeError("session/new did not return sessionId")
        sys.stderr.write(f"[host] session/new {session_id} mcp={servers['read']['name']}+{servers['write']['name']}\n")
        wait_for_mcp_ready(turn_id, 15_000)
        current = self.store.get_by_id(turn_id)
        if current is not None and current.kind == "running":
            current.grok_session_id = session_id
            self.store.put(current)
        # Maps are set only after session/new. inject() no-ops until this point.
        self._acp_by_turn[turn_id] = acp
        self._session_by_turn[turn_id] = session_id
        ready = self._session_ready.get(turn_id)
        if ready is not None:
            ready.set()

        acp.request(
            "session/prompt",
            {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": start_prompt(message)}],
            },
        ).result()

        waits = list(self._inject_waits.get(turn_id, []))
        for pending in waits:
            try:
                pending.result()
            except Exception:  # noqa: BLE001 — Promise.allSettled
                pass

        while pending_inbox_count(turn_id) > 0:
            acp.request(
                "session/prompt",
                {
                    "sessionId": session_id,
                    "prompt": [{"type": "text", "text": drain_prompt()}],
                },
            ).result()

        self.mcp.hydrate_from_calls(read_mcp_calls(turn_id))
        reply = last_post_text(read_mcp_calls(turn_id))
        self.store.mark_done(turn_id, reply)
        if child.poll() is None:
            child.terminate()
        self.children.pop(turn_id, None)
        self._acp_by_turn.pop(turn_id, None)
        self._session_by_turn.pop(turn_id, None)
        self._inject_waits.pop(turn_id, None)

    def _start_poll(self, turn_id: TurnId) -> None:
        def tick() -> None:
            while not self._disposed and not self._poll_stop.is_set():
                self.mcp.hydrate_from_calls(read_mcp_calls(turn_id))
                state = self.store.get_by_id(turn_id)
                if state is None or state.kind != "running":
                    return
                time.sleep(0.025)

        threading.Thread(target=tick, name=f"poll-mcp-{turn_id}", daemon=True).start()


def wait_for_mcp_ready(turn_id: TurnId, timeout_ms: int) -> None:
    read_path = mcp_ready_role_path(turn_id, "read")
    write_path = mcp_ready_role_path(turn_id, "write")
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if Path(read_path).exists() and Path(write_path).exists():
            time.sleep(0.75)
            return
        time.sleep(0.05)
    sys.stderr.write(f"[host] mcp-ready timed out for {turn_id}\n")


def last_post_text(calls: list[object]) -> str | None:
    text: str | None = None
    for raw in calls:
        if not is_record(raw):
            continue
        tool = read_string(raw.get("tool"))
        if tool is None or not is_post_tool(tool):
            continue
        args = raw.get("args")
        if not is_record(args):
            continue
        text = extract_post_text(args)
    return text


def _spawnfile(child: Popen[bytes]) -> str:
    args = child.args
    if isinstance(args, (list, tuple)) and args:
        return str(args[0])
    return str(args)
