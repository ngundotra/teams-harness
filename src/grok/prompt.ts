import type { InboundMessage } from "../types.js";
import {
  TOOL_CHAT_POST,
  TOOL_CHAT_SET_REACTION,
  TOOL_DRAIN_INBOX,
  TOOL_TEAMS_POST,
  TOOL_TEAMS_REPLY,
  TOOL_TEAMS_SET_REACTION,
} from "../mcp/tools.js";

export type StartPayload = {
  v: 1;
  phase: "start";
  conversationType: string;
  "chat-id": string;
  "message-id": string;
  text: string;
  "team-id"?: string;
  "channel-id"?: string;
  "reply-to-id"?: string;
};

export function startPrompt(message: InboundMessage): string {
  const payload: StartPayload = {
    v: 1,
    phase: "start",
    conversationType: message.conversationType,
    "chat-id": message.conversationId,
    "message-id": message.messageId,
    text: message.text,
  };
  if (message.teamId !== undefined) {
    payload["team-id"] = message.teamId;
  }
  if (message.channelId !== undefined) {
    payload["channel-id"] = message.channelId;
  }
  if (message.replyToId !== undefined) {
    payload["reply-to-id"] = message.replyToId;
  }
  const channel = message.conversationType === "channel";
  const postTool = channel ? (message.replyToId !== undefined ? TOOL_TEAMS_REPLY : TOOL_TEAMS_POST) : TOOL_CHAT_POST;
  const setTool = channel ? TOOL_TEAMS_SET_REACTION : TOOL_CHAT_SET_REACTION;
  return [
    "[teams-harness]",
    JSON.stringify(payload),
    "",
    "You are the Teams long-turn worker. You have no Microsoft Graph credentials.",
    "Every Teams/chat/channel operation MUST be an MCP tool.",
    "list/get/drain/reactions go through teams-read (whole channel or chat, not destination-pinned).",
    "post/reply go through teams-post, which is bound to this turn's thread — do not try another destination.",
    "Do not call search_tool. Do not spawn subagents. Do not run a shell. Call use_tool with the exact MCP names below.",
    `1. Follow-ups and reactions are injected as extra prompts on this same session. Handle each inject immediately (star if asked via ${setTool}). ${TOOL_DRAIN_INBOX} is only a backup if an inject was missed. Do not sleep, wait, or run a timer.`,
    "2. The harness walks a seen-cursor (eyes) as messages land. Do not set or unset eyes unless the user asks. Other reactions (star) you still set via MCP.",
    `3. Then call ${postTool} listing: original text, queued follow-ups, reactions per messageId, MCP tools invoked.`,
  ].join("\n");
}

export function followupPrompt(message: InboundMessage): string {
  return [
    "[teams-harness]",
    JSON.stringify({
      v: 1,
      phase: "inject",
      kind: "followup",
      "message-id": message.messageId,
      text: message.text,
    }),
    "Follow-up injected mid-turn on this same session. Handle it now (star/react if asked). Include it in the eventual post/reply. Do not sleep. Do not change destination.",
  ].join("\n");
}

export function reactionPrompt(reaction: { messageId: string; emoji: string; action: string }): string {
  return [
    "[teams-harness]",
    JSON.stringify({
      v: 1,
      phase: "inject",
      kind: "reaction",
      "message-id": reaction.messageId,
      emoji: reaction.emoji,
      action: reaction.action,
    }),
    "User reaction injected mid-turn. Honor it now. Do not sleep.",
  ].join("\n");
}

export function drainPrompt(): string {
  return [
    "[teams-harness]",
    JSON.stringify({ v: 1, phase: "drain" }),
    `Inbox still has items. Call ${TOOL_DRAIN_INBOX} and update the summary via the post/reply MCP tool.`,
  ].join("\n");
}
