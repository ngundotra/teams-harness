from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .types import (
    ConversationKey,
    InboundEvent,
    InboundIgnored,
    InboundMessage,
    InboundReaction,
    MessageId,
    brand_conversation_key,
    brand_message_id,
    is_record,
    read_string,
)

IGNORED_TYPES = {
    "conversationUpdate",
    "installationUpdate",
    "invoke",
    "typing",
    "event",
}


@dataclass(slots=True, frozen=True)
class ParseOk:
    kind: str
    event: InboundEvent


@dataclass(slots=True, frozen=True)
class ParseErr:
    kind: str
    message: str


ParseResult = ParseOk | ParseErr


def conversation_key_of(conversation_id: str, thread_hint: str | None) -> ConversationKey:
    if thread_hint and ";messageid=" not in conversation_id:
        return brand_conversation_key(f"{conversation_id};thread={thread_hint}")
    return brand_conversation_key(conversation_id)


def _read_conversation(value: object) -> tuple[str, str] | None:
    if not is_record(value):
        return None
    conv_id = read_string(value.get("id"))
    if not conv_id:
        return None
    conversation_type = read_string(value.get("conversationType")) or "personal"
    return conv_id, conversation_type


def _read_from_id(value: object) -> str:
    if not is_record(value):
        return "unknown"
    return read_string(value.get("id")) or "unknown"


def _read_reply_to_id(value: object) -> MessageId | None:
    raw = read_string(value)
    if not raw:
        return None
    return brand_message_id(raw)


def _read_thread_hint(activity: dict[str, Any]) -> str | None:
    conversation = activity.get("conversation")
    if is_record(conversation):
        thread_id = read_string(conversation.get("threadId"))
        if thread_id:
            return thread_id
    channel_data = activity.get("channelData")
    if is_record(channel_data):
        thread = channel_data.get("thread")
        if is_record(thread):
            thread_id = read_string(thread.get("id"))
            if thread_id:
                return thread_id
    return None


def _read_team_channel(activity: dict[str, Any]) -> tuple[str | None, str | None]:
    channel_data = activity.get("channelData")
    if not is_record(channel_data):
        return None, None
    team_id = None
    channel_id = None
    team = channel_data.get("team")
    if is_record(team):
        team_id = read_string(team.get("id")) or None
    channel = channel_data.get("channel")
    if is_record(channel):
        channel_id = read_string(channel.get("id")) or None
    return team_id, channel_id


def _parse_message(activity: dict[str, Any]) -> ParseResult:
    conversation = _read_conversation(activity.get("conversation"))
    if conversation is None:
        return ParseErr(kind="error", message="message activity missing conversation.id")
    conv_id, conversation_type = conversation
    msg_id = read_string(activity.get("id"))
    if not msg_id:
        return ParseErr(kind="error", message="message activity missing id")
    text = read_string(activity.get("text")) or ""
    service_url = read_string(activity.get("serviceUrl")) or ""
    reply_to_id = _read_reply_to_id(activity.get("replyToId"))
    team_id, channel_id = _read_team_channel(activity)
    event = InboundMessage(
        kind="message",
        message_id=brand_message_id(msg_id),
        text=text,
        conversation_key=conversation_key_of(conv_id, _read_thread_hint(activity)),
        conversation_id=conv_id,
        service_url=service_url,
        from_id=_read_from_id(activity.get("from")),
        conversation_type=conversation_type,
        reply_to_id=reply_to_id,
        team_id=team_id,
        channel_id=channel_id,
    )
    return ParseOk(kind="ok", event=event)


def _reactions_from(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    emojis: list[str] = []
    for item in value:
        if is_record(item):
            emoji = read_string(item.get("type"))
            if emoji:
                emojis.append(emoji)
    return emojis


def _build_reaction_events(body: dict[str, Any]) -> list[InboundReaction]:
    conversation = _read_conversation(body.get("conversation"))
    if conversation is None:
        return []
    conv_id, _conversation_type = conversation
    target = _read_reply_to_id(body.get("replyToId"))
    if target is None:
        return []
    from_id = _read_from_id(body.get("from"))
    service_url = read_string(body.get("serviceUrl")) or ""
    key = conversation_key_of(conv_id, _read_thread_hint(body))
    out: list[InboundReaction] = []
    for emoji in _reactions_from(body.get("reactionsAdded")):
        out.append(
            InboundReaction(
                kind="reaction",
                message_id=target,
                emoji=emoji,
                action="add",
                from_id=from_id,
                conversation_key=key,
                conversation_id=conv_id,
                service_url=service_url,
            )
        )
    for emoji in _reactions_from(body.get("reactionsRemoved")):
        out.append(
            InboundReaction(
                kind="reaction",
                message_id=target,
                emoji=emoji,
                action="remove",
                from_id=from_id,
                conversation_key=key,
                conversation_id=conv_id,
                service_url=service_url,
            )
        )
    return out


def parse_reaction_all(body: object) -> list[InboundReaction]:
    if not is_record(body):
        return []
    if read_string(body.get("type")) != "messageReaction":
        return []
    return _build_reaction_events(body)


def parse_activity(body: object) -> ParseResult:
    if not is_record(body):
        return ParseErr(kind="error", message="activity is not an object")
    activity_type = read_string(body.get("type"))
    if activity_type is None:
        return ParseErr(kind="error", message="activity missing type")
    if activity_type == "message":
        return _parse_message(body)
    if activity_type == "messageReaction":
        if _read_conversation(body.get("conversation")) is None:
            return ParseErr(kind="error", message="messageReaction missing conversation.id")
        if _read_reply_to_id(body.get("replyToId")) is None:
            return ParseErr(kind="error", message="messageReaction missing replyToId (target message)")
        events = _build_reaction_events(body)
        if not events:
            return ParseErr(kind="error", message="messageReaction has no reactionsAdded or reactionsRemoved")
        return ParseOk(kind="ok", event=events[0])
    if activity_type in IGNORED_TYPES:
        return ParseOk(
            kind="ok",
            event=InboundIgnored(kind="ignored", type=activity_type, reason=f"activity type {activity_type} does not start a turn"),
        )
    return ParseOk(
        kind="ok",
        event=InboundIgnored(kind="ignored", type=activity_type, reason=f"unhandled activity type {activity_type}"),
    )
