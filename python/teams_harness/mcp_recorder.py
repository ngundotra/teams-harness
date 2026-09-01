"""In-process MCP call recorder. No Graph REST and no Graph SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .tools import extract_post_text, is_post_tool
from .types import MessageId, StoredReaction, is_record, read_string


@dataclass
class SentMessage:
    conversation_id: str
    service_url: str
    text: str
    message_id: MessageId
    reply_to_id: MessageId | None = None


class McpRecorder:
    def __init__(self) -> None:
        self.sent: list[SentMessage] = []
        self.set_reactions: list[dict[str, str]] = []
        self.unset_reactions: list[dict[str, str]] = []
        self.inbound_by_message: dict[str, list[StoredReaction]] = {}
        self.tools_invoked: list[str] = []
        self._hydrated = 0
        self._routes: dict[str, tuple[str, str]] = {}
        self._inbound_texts: dict[str, str] = {}

    def remember_route(self, key: str, service_url: str, conversation_id: str) -> None:
        if key and service_url and conversation_id:
            self._routes[key] = (service_url, conversation_id)

    def remember_inbound(self, message: Any) -> None:
        message_id = getattr(message, "message_id", None) or (message.get("messageId") if isinstance(message, dict) else None)
        text = getattr(message, "text", None) or (message.get("text") if isinstance(message, dict) else None)
        if message_id and text is not None:
            self._inbound_texts[str(message_id)] = str(text)

    def record_inbound(self, reaction: StoredReaction) -> None:
        self.inbound_by_message.setdefault(reaction.message_id, []).append(reaction)

    def ack_immediate(self, message: Any) -> None:
        conversation_id = getattr(message, "conversation_id", "")
        service_url = getattr(message, "service_url", "")
        self.remember_route(conversation_id, service_url, conversation_id)
        channel_id = getattr(message, "channel_id", None)
        team_id = getattr(message, "team_id", None)
        if channel_id:
            self.remember_route(channel_id, service_url, conversation_id)
        if team_id:
            self.remember_route(team_id, service_url, conversation_id)

    def record_set(self, rec: dict[str, str]) -> None:
        if not any(r["messageId"] == rec["messageId"] and r["emoji"] == rec["emoji"] for r in self.set_reactions):
            self.set_reactions.append(rec)

    def record_unset(self, rec: dict[str, str]) -> None:
        if not any(r["messageId"] == rec["messageId"] and r["emoji"] == rec["emoji"] for r in self.unset_reactions):
            self.unset_reactions.append(rec)

    def fire_set_reaction(self, _args: dict[str, Any]) -> None:
        return None

    def fire_unset_reaction(self, _args: dict[str, Any]) -> None:
        return None

    def harness_reaction_args(self, args: dict[str, Any]) -> dict[str, Any]:
        return dict(args)

    def hydrate_from_calls(self, calls: list[object]) -> None:
        unread = calls[self._hydrated :]
        self._hydrated += len(unread)
        for raw in unread:
            if not is_record(raw):
                continue
            tool = read_string(raw.get("tool"))
            if tool is None:
                continue
            self.tools_invoked.append(tool)
            raw_args = raw.get("args") if is_record(raw.get("args")) else {}
            if is_post_tool(tool) and isinstance(raw_args, dict):
                text = extract_post_text(raw_args)
                self.sent.append(
                    SentMessage(
                        conversation_id=str(raw_args.get("chat-id") or raw_args.get("channel-id") or ""),
                        service_url="",
                        text=text,
                        message_id=f"mcp-msg-{len(self.sent) + 1}",
                    )
                )
