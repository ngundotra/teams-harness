from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .inbound import parse_inbound_message
from .jsonl import parse_json_line
from .turn_store import turns_root
from .types import (
    InboxFollowup,
    InboxItem,
    InboxReaction,
    TurnId,
    brand_message_id,
    is_record,
    read_string,
)


def turn_dir(turn_id: TurnId) -> Path:
    return Path(turns_root()) / turn_id


def inbox_path(turn_id: TurnId) -> Path:
    return turn_dir(turn_id) / "inbox.jsonl"


def cursor_path(turn_id: TurnId) -> Path:
    return turn_dir(turn_id) / "inbox.cursor"


def mcp_ready_role_path(turn_id: TurnId, role: str) -> Path:
    return turn_dir(turn_id) / f"mcp-ready-{role}"


def mcp_calls_path(turn_id: TurnId) -> Path:
    return turn_dir(turn_id) / "mcp-calls.jsonl"


def ensure_turn_dir(turn_id: TurnId) -> Path:
    path = turn_dir(turn_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def inbox_item_to_json(item: InboxItem) -> dict[str, Any]:
    if item.kind == "followup":
        msg = item.message
        payload: dict[str, Any] = {
            "kind": "followup",
            "message": {
                "kind": "message",
                "messageId": msg.message_id,
                "text": msg.text,
                "conversationKey": msg.conversation_key,
                "conversationId": msg.conversation_id,
                "serviceUrl": msg.service_url,
                "fromId": msg.from_id,
                "conversationType": msg.conversation_type,
            },
        }
        if msg.reply_to_id is not None:
            payload["message"]["replyToId"] = msg.reply_to_id
        if msg.team_id is not None:
            payload["message"]["teamId"] = msg.team_id
        if msg.channel_id is not None:
            payload["message"]["channelId"] = msg.channel_id
        return payload
    return {
        "kind": "reaction",
        "messageId": item.message_id,
        "emoji": item.emoji,
        "action": item.action,
        "fromId": item.from_id,
    }


def append_inbox(turn_id: TurnId, item: InboxItem) -> None:
    import json

    ensure_turn_dir(turn_id)
    with inbox_path(turn_id).open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(inbox_item_to_json(item)) + "\n")


def read_cursor(turn_id: TurnId) -> int:
    path = cursor_path(turn_id)
    if not path.exists():
        return 0
    raw = path.read_text(encoding="utf-8").strip()
    try:
        n = int(raw, 10)
    except ValueError:
        return 0
    return n if n >= 0 else 0


def write_cursor(turn_id: TurnId, value: int) -> None:
    ensure_turn_dir(turn_id)
    cursor_path(turn_id).write_text(f"{value}\n", encoding="utf-8")


def parse_inbox_item(value: object) -> InboxItem | None:
    if not is_record(value):
        return None
    kind = read_string(value.get("kind"))
    if kind == "followup":
        return InboxFollowup(kind="followup", message=parse_inbound_message(value.get("message")))
    if kind == "reaction":
        message_id = read_string(value.get("messageId"))
        emoji = read_string(value.get("emoji"))
        action = read_string(value.get("action"))
        from_id = read_string(value.get("fromId"))
        if message_id is None or emoji is None or from_id is None:
            return None
        if action not in ("add", "remove"):
            return None
        return InboxReaction(
            kind="reaction",
            message_id=brand_message_id(message_id),
            emoji=emoji,
            action=action,
            from_id=from_id,
        )
    return None


def read_inbox_lines(turn_id: TurnId) -> list[InboxItem]:
    path = inbox_path(turn_id)
    if not path.exists():
        return []
    items: list[InboxItem] = []
    for line in path.read_text(encoding="utf-8").split("\n"):
        try:
            raw = parse_json_line(line)
        except ValueError:
            continue
        if raw is None:
            continue
        item = parse_inbox_item(raw)
        if item is not None:
            items.append(item)
    return items


def pending_inbox_count(turn_id: TurnId) -> int:
    items = read_inbox_lines(turn_id)
    cursor = read_cursor(turn_id)
    return max(0, len(items) - cursor)


def drain_inbox(turn_id: TurnId) -> list[InboxItem]:
    items = read_inbox_lines(turn_id)
    cursor = read_cursor(turn_id)
    nxt = items[cursor:]
    write_cursor(turn_id, len(items))
    return nxt


def read_mcp_calls(turn_id: TurnId) -> list[object]:
    path = mcp_calls_path(turn_id)
    if not path.exists():
        return []
    out: list[object] = []
    for line in path.read_text(encoding="utf-8").split("\n"):
        try:
            raw = parse_json_line(line)
        except ValueError:
            continue
        if raw is not None:
            out.append(raw)
    return out


def turns_dir_from_env() -> str:
    return os.environ.get("TURNS_DIR", "/tmp/turns")
