from __future__ import annotations

import json
import os
import random
import time
from pathlib import Path

from .types import ConversationKey, TurnDone, TurnId, TurnRunning, TurnState, brand_turn_id


def turns_root() -> str:
    return os.environ.get("TURNS_DIR", "/tmp/turns")


class TurnStore:
    def __init__(self) -> None:
        self._by_key: dict[str, TurnState] = {}
        self._by_id: dict[str, TurnState] = {}
        self._spawn_count = 0

    def get_spawn_count(self) -> int:
        return self._spawn_count

    def increment_spawn(self) -> None:
        self._spawn_count += 1

    def get_running(self, key: ConversationKey) -> TurnRunning | None:
        current = self._by_key.get(key)
        if current is not None and current.kind == "running":
            return current
        return None

    def get_by_id(self, turn_id: TurnId) -> TurnState | None:
        return self._by_id.get(turn_id)

    def running_count(self) -> int:
        return sum(1 for state in self._by_key.values() if state.kind == "running")

    def put(self, state: TurnState) -> None:
        self._by_key[state.conversation_key] = state
        self._by_id[state.turn_id] = state
        persist_turn(state)

    def mark_done(self, turn_id: TurnId, final_reply: str | None = None) -> TurnState | None:
        current = self._by_id.get(turn_id)
        if current is None or current.kind != "running":
            return current
        done = TurnDone(
            kind="done",
            turn_id=current.turn_id,
            conversation_key=current.conversation_key,
            start_message=current.start_message,
            followups=list(current.followups),
            inbound_reactions=list(current.inbound_reactions),
            set_reactions=list(current.set_reactions),
            final_reply=final_reply,
        )
        self.put(done)
        return done


def persist_turn(state: TurnState) -> None:
    directory = Path(turns_root()) / state.turn_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "state.json").write_text(json.dumps(_state_to_json(state), indent=2), encoding="utf-8")


def new_turn_id(key: ConversationKey) -> TurnId:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in key)[:48]
    return brand_turn_id(f"trn_{safe}_{int(time.time() * 1000)}_{random.randrange(0, 16**6):x}")


def _state_to_json(state: TurnState) -> dict[str, object]:
    msg = state.start_message
    payload: dict[str, object] = {
        "kind": state.kind,
        "turnId": state.turn_id,
        "conversationKey": state.conversation_key,
        "startMessage": {
            "kind": "message",
            "messageId": msg.message_id,
            "text": msg.text,
            "conversationKey": msg.conversation_key,
            "conversationId": msg.conversation_id,
            "serviceUrl": msg.service_url,
            "fromId": msg.from_id,
            "conversationType": msg.conversation_type,
        },
        "followups": [m.message_id for m in state.followups],
        "inboundReactions": [
            {"messageId": r.message_id, "emoji": r.emoji, "action": r.action, "fromId": r.from_id}
            for r in state.inbound_reactions
        ],
    }
    if state.kind == "running":
        payload["pid"] = state.pid
        payload["startedAt"] = state.started_at
        if state.grok_session_id is not None:
            payload["grokSessionId"] = state.grok_session_id
    if state.kind == "done" and state.final_reply is not None:
        payload["finalReply"] = state.final_reply
    return payload
