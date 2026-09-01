"""Generic inbound fixtures. No personal names."""

from __future__ import annotations

from teams_harness.surface import surface_from_fields
from teams_harness.types import (
    InboundMessage,
    InboundReaction,
    brand_conversation_key,
    brand_message_id,
)


def inbound_message(
    message_id: str,
    text: str,
    *,
    conversation_id: str = "a:chat-1",
    conversation_key: str | None = None,
    conversation_type: str = "personal",
    service_url: str = "http://127.0.0.1:9",
    from_id: str = "29:user-1",
    reply_to_id: str | None = None,
    team_id: str | None = None,
    channel_id: str | None = None,
) -> InboundMessage:
    try:
        surface = surface_from_fields(
            conversation_id=conversation_id,
            conversation_type=conversation_type,
            message_id=message_id,
            reply_to_id=reply_to_id,
            team_id=team_id,
            channel_id=channel_id,
        )
    except ValueError:
        surface = {"kind": "dm", "chatId": conversation_id}
    return InboundMessage(
        kind="message",
        message_id=brand_message_id(message_id),
        text=text,
        conversation_key=brand_conversation_key(conversation_key or conversation_id),
        conversation_id=conversation_id,
        service_url=service_url,
        from_id=from_id,
        conversation_type=conversation_type,
        surface=surface,
        reply_to_id=brand_message_id(reply_to_id) if reply_to_id else None,
        team_id=team_id,
        channel_id=channel_id,
    )


def inbound_reaction(
    message_id: str,
    emoji: str = "like",
    *,
    conversation_id: str = "a:chat-1",
    conversation_key: str | None = None,
    from_id: str = "29:user-1",
) -> InboundReaction:
    return InboundReaction(
        kind="reaction",
        message_id=brand_message_id(message_id),
        emoji=emoji,
        action="add",
        from_id=from_id,
        conversation_key=brand_conversation_key(conversation_key or conversation_id),
        conversation_id=conversation_id,
        service_url="http://127.0.0.1:9",
    )


def personal_activity(message_id: str, text: str) -> dict[str, object]:
    return {
        "type": "message",
        "id": message_id,
        "text": text,
        "serviceUrl": "http://127.0.0.1:9",
        "from": {"id": "29:user-1", "name": "User"},
        "conversation": {"id": "a:chat-1", "conversationType": "personal"},
    }


def thread_activity(message_id: str, text: str, thread_id: str) -> dict[str, object]:
    return {
        "type": "message",
        "id": message_id,
        "text": text,
        "serviceUrl": "http://127.0.0.1:9",
        "from": {"id": "29:user-1", "name": "User"},
        "conversation": {
            "id": "19:channel-1@thread.tacv2",
            "conversationType": "channel",
            "threadId": thread_id,
        },
        "channelData": {
            "team": {"id": "team-1"},
            "channel": {"id": "19:channel-1@thread.tacv2"},
        },
    }
