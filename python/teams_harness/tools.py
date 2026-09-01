from __future__ import annotations

from typing import Any, Literal

MCP_TEAMS_READ_SERVER = "teams-read"
MCP_TEAMS_WRITE_SERVER = "teams-post"

TOOL_CHAT_POST = "mcp_graph_chat_postMessage"
TOOL_CHAT_LIST = "mcp_graph_chat_listChatMessages"
TOOL_CHAT_GET = "mcp_graph_chat_getChatMessage"
TOOL_TEAMS_POST = "mcp_graph_teams_postChannelMessage"
TOOL_TEAMS_REPLY = "mcp_graph_teams_replyToChannelMessage"
TOOL_TEAMS_LIST = "mcp_graph_teams_listChannelMessages"
TOOL_TEAMS_LIST_REPLIES = "mcp_graph_teams_listChannelMessageReplies"
TOOL_CHAT_SET_REACTION = "mcp_graph_chat_setReaction"
TOOL_CHAT_UNSET_REACTION = "mcp_graph_chat_unsetReaction"
TOOL_TEAMS_SET_REACTION = "mcp_graph_teams_setReaction"
TOOL_TEAMS_UNSET_REACTION = "mcp_graph_teams_unsetReaction"
TOOL_DRAIN_INBOX = "harness_drainInbox"

POST_TOOLS = (TOOL_CHAT_POST, TOOL_TEAMS_POST, TOOL_TEAMS_REPLY)

McpRole = Literal["read", "write"]

WriteScope = dict[str, str]


def is_post_tool(name: str) -> bool:
    return name in POST_TOOLS


def server_name_for_role(role: McpRole) -> str:
    if role == "read":
        return MCP_TEAMS_READ_SERVER
    if role == "write":
        return MCP_TEAMS_WRITE_SERVER
    raise ValueError(f"unknown MCP role {role}")


def write_scope_from_message(message: Any) -> dict[str, str]:
    from .surface import write_scope_from_surface

    surface = getattr(message, "surface", None)
    if surface is not None:
        return write_scope_from_surface(surface)
    conversation_type = getattr(message, "conversation_type", None)
    if conversation_type == "channel":
        team_id = getattr(message, "team_id", None)
        channel_id = getattr(message, "channel_id", None)
        if not team_id or not channel_id:
            raise ValueError("channel write scope requires teamId and channelId")
        thread_id = getattr(message, "reply_to_id", None) or getattr(message, "message_id")
        return {
            "kind": "channel",
            "teamId": team_id,
            "channelId": channel_id,
            "threadId": thread_id,
        }
    return {"kind": "chat", "conversationId": message.conversation_id}


def extract_post_text(args: dict[str, Any]) -> str:
    def body_text(body: object) -> str:
        if isinstance(body, str):
            return body
        if isinstance(body, dict):
            content = body.get("content")
            return content if isinstance(content, str) else json_dumps(body)
        return ""

    from_body = body_text(args.get("body"))
    if from_body:
        return from_body
    from_text = body_text(args.get("text"))
    if from_text:
        return from_text
    return body_text(args.get("content"))


def json_dumps(value: object) -> str:
    import json

    return json.dumps(value)
