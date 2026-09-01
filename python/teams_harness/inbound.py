from __future__ import annotations

from .types import (
    InboundMessage,
    brand_conversation_key,
    brand_message_id,
    is_record,
    read_string,
)


def parse_inbound_message(value: object) -> InboundMessage:
    if not is_record(value):
        raise ValueError("message payload is not an object")
    kind = read_string(value.get("kind"))
    if kind != "message":
        raise ValueError("message payload missing kind=message")
    message_id = read_string(value.get("messageId"))
    text = read_string(value.get("text"))
    conversation_key = read_string(value.get("conversationKey"))
    conversation_id = read_string(value.get("conversationId"))
    service_url = read_string(value.get("serviceUrl"))
    from_id = read_string(value.get("fromId"))
    conversation_type = read_string(value.get("conversationType"))
    if (
        message_id is None
        or text is None
        or conversation_key is None
        or conversation_id is None
        or service_url is None
        or from_id is None
        or conversation_type is None
    ):
        raise ValueError("message payload missing required fields")
    msg = InboundMessage(
        kind="message",
        message_id=brand_message_id(message_id),
        text=text,
        conversation_key=brand_conversation_key(conversation_key),
        conversation_id=conversation_id,
        service_url=service_url,
        from_id=from_id,
        conversation_type=conversation_type,
    )
    reply_raw = read_string(value.get("replyToId"))
    if reply_raw:
        msg.reply_to_id = brand_message_id(reply_raw)
    team_id = read_string(value.get("teamId"))
    if team_id:
        msg.team_id = team_id
    channel_id = read_string(value.get("channelId"))
    if channel_id:
        msg.channel_id = channel_id
    return msg
