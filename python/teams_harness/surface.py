from __future__ import annotations

from typing import Literal, TypedDict

from .types import ConversationKey, brand_conversation_key


class SurfaceDm(TypedDict):
    kind: Literal["dm"]
    chatId: str


class SurfaceGroup(TypedDict):
    kind: Literal["group"]
    chatId: str


class SurfaceThread(TypedDict):
    kind: Literal["thread"]
    teamId: str
    channelId: str
    threadId: str


Surface = SurfaceDm | SurfaceGroup | SurfaceThread


def thread_conversation_id(channel_id: str, thread_id: str) -> str:
    if ";messageid=" in channel_id:
        return channel_id
    return f"{channel_id};messageid={thread_id}"


def message_id_suffix(conversation_id: str) -> str | None:
    marker = ";messageid="
    i = conversation_id.find(marker)
    if i < 0:
        return None
    ident = conversation_id[i + len(marker) :]
    return ident or None


def channel_id_from_conversation_id(conversation_id: str) -> str:
    marker = ";messageid="
    i = conversation_id.find(marker)
    return conversation_id[:i] if i >= 0 else conversation_id


def conversation_key_from_surface(surface: Surface) -> ConversationKey:
    kind = surface["kind"]
    if kind in ("dm", "group"):
        return brand_conversation_key(surface["chatId"])
    return brand_conversation_key(thread_conversation_id(surface["channelId"], surface["threadId"]))


def conversation_type_from_surface(surface: Surface) -> str:
    kind = surface["kind"]
    if kind == "dm":
        return "personal"
    if kind == "group":
        return "groupChat"
    return "channel"


def write_scope_from_surface(surface: Surface) -> dict[str, str]:
    if surface["kind"] in ("dm", "group"):
        return {"kind": "chat", "conversationId": surface["chatId"]}
    return {
        "kind": "channel",
        "teamId": surface["teamId"],
        "channelId": surface["channelId"],
        "threadId": surface["threadId"],
    }


def surface_from_fields(
    *,
    conversation_id: str,
    conversation_type: str,
    is_group: bool = False,
    message_id: str | None = None,
    reply_to_id: str | None = None,
    thread_hint: str | None = None,
    team_id: str | None = None,
    channel_id: str | None = None,
) -> Surface:
    channel = channel_id or (channel_id_from_conversation_id(conversation_id) if conversation_type == "channel" else None)
    is_channel = conversation_type == "channel" or bool(team_id and channel)
    if is_channel:
        if not team_id or not channel:
            raise ValueError("thread surface requires teamId and channelId")
        thread_id = message_id_suffix(conversation_id) or thread_hint or reply_to_id or message_id
        if not thread_id:
            raise ValueError("thread surface requires a thread id")
        return {"kind": "thread", "teamId": team_id, "channelId": channel, "threadId": thread_id}
    if conversation_type == "groupChat" or is_group:
        return {"kind": "group", "chatId": conversation_id}
    return {"kind": "dm", "chatId": conversation_id}


def surface_prompt_fields(surface: Surface) -> dict[str, str]:
    if surface["kind"] in ("dm", "group"):
        return {"chat-id": surface["chatId"]}
    return {
        "team-id": surface["teamId"],
        "channel-id": surface["channelId"],
        "thread-id": surface["threadId"],
    }


def parse_surface(value: object) -> Surface | None:
    if not isinstance(value, dict):
        return None
    kind = value.get("kind")
    if kind in ("dm", "group"):
        chat_id = value.get("chatId")
        if isinstance(chat_id, str) and chat_id:
            return {"kind": kind, "chatId": chat_id}
        return None
    if kind == "thread":
        team_id = value.get("teamId")
        channel_id = value.get("channelId")
        thread_id = value.get("threadId")
        if isinstance(team_id, str) and isinstance(channel_id, str) and isinstance(thread_id, str):
            if team_id and channel_id and thread_id:
                return {"kind": "thread", "teamId": team_id, "channelId": channel_id, "threadId": thread_id}
    return None
