from __future__ import annotations

import json
from typing import Any

from .tools import (
    TOOL_CHAT_POST,
    TOOL_CHAT_SET_REACTION,
    TOOL_DRAIN_INBOX,
    TOOL_TEAMS_POST,
    TOOL_TEAMS_REPLY,
    TOOL_TEAMS_SET_REACTION,
)
from .types import InboundMessage


def start_prompt(message: InboundMessage) -> str:
    payload: dict[str, Any] = {
        "v": 1,
        "phase": "start",
        "conversationType": message.conversation_type,
        "chat-id": message.conversation_id,
        "message-id": message.message_id,
        "text": message.text,
    }
    if message.team_id is not None:
        payload["team-id"] = message.team_id
    if message.channel_id is not None:
        payload["channel-id"] = message.channel_id
    if message.reply_to_id is not None:
        payload["reply-to-id"] = message.reply_to_id
    channel = message.conversation_type == "channel"
    if channel:
        post_tool = TOOL_TEAMS_REPLY if message.reply_to_id is not None else TOOL_TEAMS_POST
        set_tool = TOOL_TEAMS_SET_REACTION
    else:
        post_tool = TOOL_CHAT_POST
        set_tool = TOOL_CHAT_SET_REACTION
    return "\n".join(
        [
            "[teams-harness]",
            json.dumps(payload, separators=(",", ":")),
            "",
            "You are the Teams long-turn worker. You have no Microsoft Graph credentials.",
            "Every Teams/chat/channel operation MUST be an MCP tool.",
            "list/get/drain/reactions go through teams-read (whole channel or chat, not destination-pinned).",
            "post/reply go through teams-post, which is bound to this turn's thread — do not try another destination.",
            "Do not call search_tool. Do not spawn subagents. Do not run a shell. Call use_tool with the exact MCP names below.",
            (
                f"1. Follow-ups and reactions are injected as extra prompts on this same session. "
                f"Handle each inject immediately (star if asked via {set_tool}). "
                f"{TOOL_DRAIN_INBOX} is only a backup if an inject was missed. "
                "Do not sleep, wait, or run a timer."
            ),
            "2. The harness walks a seen-cursor (eyes) as messages land. Do not set or unset eyes unless the user asks. Other reactions (star) you still set via MCP.",
            f"3. Then call {post_tool} listing: original text, queued follow-ups, reactions per messageId, MCP tools invoked.",
        ]
    )


def followup_prompt(message: InboundMessage) -> str:
    return "\n".join(
        [
            "[teams-harness]",
            json.dumps(
                {
                    "v": 1,
                    "phase": "inject",
                    "kind": "followup",
                    "message-id": message.message_id,
                    "text": message.text,
                },
                separators=(",", ":"),
            ),
            "Follow-up injected mid-turn on this same session. Handle it now (star/react if asked). Include it in the eventual post/reply. Do not sleep. Do not change destination.",
        ]
    )


def reaction_prompt(reaction: dict[str, str] | Any) -> str:
    message_id = reaction["messageId"] if isinstance(reaction, dict) else reaction.message_id
    emoji = reaction["emoji"] if isinstance(reaction, dict) else reaction.emoji
    action = reaction["action"] if isinstance(reaction, dict) else reaction.action
    return "\n".join(
        [
            "[teams-harness]",
            json.dumps(
                {
                    "v": 1,
                    "phase": "inject",
                    "kind": "reaction",
                    "message-id": message_id,
                    "emoji": emoji,
                    "action": action,
                },
                separators=(",", ":"),
            ),
            "User reaction injected mid-turn. Honor it now. Do not sleep.",
        ]
    )


def drain_prompt() -> str:
    return "\n".join(
        [
            "[teams-harness]",
            json.dumps({"v": 1, "phase": "drain"}, separators=(",", ":")),
            f"Inbox still has items. Call {TOOL_DRAIN_INBOX} and update the summary via the post/reply MCP tool.",
        ]
    )
