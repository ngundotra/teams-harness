import type { Surface } from "../surface.js";
import { surfacePromptFields } from "../surface.js";
import type { InboundMessage } from "../types.js";
import {
  TOOL_CHAT_POST,
  TOOL_CHAT_SET_REACTION,
  TOOL_DRAIN_INBOX,
  TOOL_TEAMS_REPLY,
  TOOL_TEAMS_SET_REACTION,
} from "../mcp/tools.js";

const NO_NON_MCP_EXPLORE =
  "Do not call fs/read_text_file. Do not read .cursor/skills. Do not do any non-MCP exploration. Do not call search_tool. Do not spawn subagents. Do not run a shell.";

export type StartPayload = {
  v: 1;
  phase: "start";
  surface: Surface;
  "message-id": string;
  text: string;
  "chat-id"?: string;
  "team-id"?: string;
  "channel-id"?: string;
  "thread-id"?: string;
  "reply-to-id"?: string;
};

function postToolForSurface(surface: Surface): string {
  switch (surface.kind) {
    case "dm":
    case "group":
      return TOOL_CHAT_POST;
    case "thread":
      return TOOL_TEAMS_REPLY;
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

function setToolForSurface(surface: Surface): string {
  switch (surface.kind) {
    case "dm":
    case "group":
      return TOOL_CHAT_SET_REACTION;
    case "thread":
      return TOOL_TEAMS_SET_REACTION;
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

export function startPrompt(message: InboundMessage): string {
  const payload: StartPayload = {
    v: 1,
    phase: "start",
    surface: message.surface,
    "message-id": message.messageId,
    text: message.text,
    ...surfacePromptFields(message.surface),
  };
  if (message.replyToId !== undefined) {
    payload["reply-to-id"] = message.replyToId;
  }
  const postTool = postToolForSurface(message.surface);
  const setTool = setToolForSurface(message.surface);
  return [
    "[teams-harness]",
    JSON.stringify(payload),
    "",
    "You are the Teams long-turn worker. You have no Microsoft Graph credentials.",
    "Every Teams/chat/channel operation MUST be an MCP tool.",
    "list/get/drain/reactions go through teams-read. Use only the tools that server advertised.",
    "post/reply go through teams-post, which is bound to this turn's surface — do not try another destination.",
    `${NO_NON_MCP_EXPLORE} Call use_tool with the exact MCP names below.`,
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
    `Follow-up injected mid-turn on this same session. Handle it now (star/react if asked). Include it in the eventual post/reply. Do not sleep. Do not change destination. ${NO_NON_MCP_EXPLORE}`,
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
    `Inbox still has items. Call ${TOOL_DRAIN_INBOX} and update the summary via the post/reply MCP tool. ${NO_NON_MCP_EXPLORE}`,
  ].join("\n");
}
