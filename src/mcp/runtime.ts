import { appendMcpCall, drainInbox } from "../inbox.js";
import { SEEN_EMOJI, readSeenMessageId, seenWalk, writeSeenMessageId } from "../seenCursor.js";
import {
  type InboxItem,
  type InboundMessage,
  type TurnId,
  brandTurnId,
  isRecord,
  readString,
} from "../types.js";
import { executeGraphTool, isGraphConfigured } from "./graph.js";
import {
  TEAM_MCP_TOOL_DEFS,
  TOOL_CHAT_GET,
  TOOL_CHAT_LIST,
  TOOL_CHAT_POST,
  TOOL_CHAT_SET_REACTION,
  TOOL_CHAT_UNSET_REACTION,
  TOOL_DRAIN_INBOX,
  TOOL_TEAMS_LIST,
  TOOL_TEAMS_LIST_REPLIES,
  TOOL_TEAMS_POST,
  TOOL_TEAMS_REPLY,
  TOOL_TEAMS_SET_REACTION,
  TOOL_TEAMS_UNSET_REACTION,
  isPostTool,
  isSetReactionTool,
  isUnsetReactionTool,
  toolAllowedOnRole,
  toolDefsForRole,
  type McpRole,
  type WriteScope,
} from "./tools.js";

export function turnIdFromEnv(): TurnId {
  const raw = process.env.TURN_ID;
  if (raw === undefined || raw.length === 0) {
    throw new Error("TURN_ID is required for the Teams MCP mock");
  }
  return brandTurnId(raw);
}

export type BindWriteResult =
  | { ok: true; tool: string; args: Record<string, unknown> }
  | { ok: false; error: string };

export function writeScopeFromMessage(message: InboundMessage): WriteScope {
  if (message.conversationType === "channel") {
    const teamId = message.teamId;
    const channelId = message.channelId;
    if (teamId === undefined || channelId === undefined) {
      throw new Error("channel write scope requires teamId and channelId");
    }
    return {
      kind: "channel",
      teamId,
      channelId,
      threadId: message.replyToId ?? message.messageId,
    };
  }
  return { kind: "chat", conversationId: message.conversationId };
}

export function writeScopeFromEnv(env: NodeJS.ProcessEnv = process.env): WriteScope | undefined {
  const kind = env.WRITE_KIND;
  if (kind === undefined || kind.length === 0) {
    return undefined;
  }
  if (kind === "chat") {
    const conversationId = env.WRITE_CONVERSATION_ID;
    if (conversationId === undefined || conversationId.length === 0) {
      throw new Error("WRITE_CONVERSATION_ID is required when WRITE_KIND=chat");
    }
    return { kind: "chat", conversationId };
  }
  if (kind === "channel") {
    const teamId = env.WRITE_TEAM_ID;
    const channelId = env.WRITE_CHANNEL_ID;
    const threadId = env.WRITE_THREAD_ID;
    if (teamId === undefined || teamId.length === 0) {
      throw new Error("WRITE_TEAM_ID is required when WRITE_KIND=channel");
    }
    if (channelId === undefined || channelId.length === 0) {
      throw new Error("WRITE_CHANNEL_ID is required when WRITE_KIND=channel");
    }
    if (threadId === undefined || threadId.length === 0) {
      throw new Error("WRITE_THREAD_ID is required when WRITE_KIND=channel");
    }
    return { kind: "channel", teamId, channelId, threadId };
  }
  throw new Error(`invalid WRITE_KIND=${kind}`);
}

function bindChatWrite(
  scope: Extract<WriteScope, { kind: "chat" }>,
  toolName: string,
  args: Record<string, unknown>,
): BindWriteResult {
  if (toolName === TOOL_CHAT_POST) {
    return {
      ok: true,
      tool: TOOL_CHAT_POST,
      args: { ...args, "chat-id": scope.conversationId },
    };
  }
  if (toolName === TOOL_TEAMS_POST || toolName === TOOL_TEAMS_REPLY) {
    return { ok: false, error: "wrong surface" };
  }
  return { ok: false, error: `cannot bind ${toolName} on chat write scope` };
}

function bindChannelWrite(
  scope: Extract<WriteScope, { kind: "channel" }>,
  toolName: string,
  args: Record<string, unknown>,
): BindWriteResult {
  if (toolName === TOOL_CHAT_POST) {
    return { ok: false, error: "wrong surface" };
  }
  if (toolName === TOOL_TEAMS_POST || toolName === TOOL_TEAMS_REPLY) {
    return {
      ok: true,
      tool: TOOL_TEAMS_REPLY,
      args: {
        ...args,
        "team-id": scope.teamId,
        "channel-id": scope.channelId,
        "message-id": scope.threadId,
      },
    };
  }
  return { ok: false, error: `cannot bind ${toolName} on channel write scope` };
}

export function bindWriteArgs(
  scope: WriteScope,
  toolName: string,
  args: Record<string, unknown>,
): BindWriteResult {
  switch (scope.kind) {
    case "chat":
      return bindChatWrite(scope, toolName, args);
    case "channel":
      return bindChannelWrite(scope, toolName, args);
    default: {
      const _exhaustive: never = scope;
      return { ok: false, error: `unknown write scope ${JSON.stringify(_exhaustive)}` };
    }
  }
}


function bodyText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (isRecord(body)) {
    return readString(body.content) ?? JSON.stringify(body);
  }
  return "";
}

export function extractPostText(args: Record<string, unknown>): string {
  const fromBody = bodyText(args.body);
  if (fromBody.length > 0) {
    return fromBody;
  }
  const fromText = bodyText(args.text);
  if (fromText.length > 0) {
    return fromText;
  }
  return bodyText(args.content);
}

export function extractReaction(args: Record<string, unknown>): { messageId: string; emoji: string } | undefined {
  const messageId = readString(args["message-id"]) ?? readString(args.messageId);
  const emoji =
    readString(args.reactionType) ?? readString(args.emoji) ?? readString(args.reaction);
  if (messageId === undefined || emoji === undefined) {
    return undefined;
  }
  return { messageId, emoji };
}

export type GraphReaction = { reactionType: string };

export type GraphIdentity = {
  id: string;
  displayName?: string;
};

export type GraphMessageFrom = {
  id?: string;
  user?: GraphIdentity;
  application?: GraphIdentity;
};

export type GraphBody = {
  content: string;
  contentType?: string;
};

export type GraphChatMessage = {
  id: string;
  body?: GraphBody | string;
  from?: GraphMessageFrom;
  createdDateTime?: string;
  replyToId?: string;
  replies?: GraphChatMessage[];
  reactions?: GraphReaction[];
  teamId?: string;
  channelId?: string;
};

type StoredChannelMessage = GraphChatMessage;

const storedReactions: { messageId: string; reactionType: string }[] = [];
const storedChannelMessages: StoredChannelMessage[] = [];
let postSeq = 0;

function addStoredReaction(messageId: string, reactionType: string): void {
  const exists = storedReactions.some(
    (r) => r.messageId === messageId && r.reactionType === reactionType,
  );
  if (!exists) {
    storedReactions.push({ messageId, reactionType });
  }
}

function removeStoredReaction(messageId: string, reactionType: string): void {
  const idx = storedReactions.findIndex(
    (r) => r.messageId === messageId && r.reactionType === reactionType,
  );
  if (idx >= 0) {
    storedReactions.splice(idx, 1);
  }
}

function reactionsFor(messageId: string): GraphReaction[] {
  return storedReactions
    .filter((r) => r.messageId === messageId)
    .map((r) => ({ reactionType: r.reactionType }));
}

function graphShapedMessage(messageId: string): GraphChatMessage {
  return {
    id: messageId,
    reactions: reactionsFor(messageId),
  };
}

function listGraphShapedMessages(): GraphChatMessage[] {
  const ids: string[] = [];
  for (const r of storedReactions) {
    if (!ids.includes(r.messageId)) {
      ids.push(r.messageId);
    }
  }
  return ids.map((id) => graphShapedMessage(id));
}

function upsertStored(message: StoredChannelMessage): void {
  const idx = storedChannelMessages.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    storedChannelMessages[idx] = message;
    return;
  }
  storedChannelMessages.push(message);
}

function overlayReactions(message: GraphChatMessage): GraphChatMessage {
  const reactions = reactionsFor(message.id);
  if (reactions.length === 0 && message.reactions === undefined) {
    return message;
  }
  return { ...message, reactions };
}

function scopeMatch(message: StoredChannelMessage, teamId: string | undefined, channelId: string | undefined): boolean {
  if (teamId !== undefined && message.teamId !== undefined && message.teamId !== teamId) {
    return false;
  }
  if (channelId !== undefined && message.channelId !== undefined && message.channelId !== channelId) {
    return false;
  }
  return true;
}

function listStoredRoots(teamId: string | undefined, channelId: string | undefined): GraphChatMessage[] {
  const out: GraphChatMessage[] = [];
  for (const stored of storedChannelMessages) {
    if (stored.replyToId !== undefined) {
      continue;
    }
    if (!scopeMatch(stored, teamId, channelId)) {
      continue;
    }
    out.push(overlayReactions(stored));
  }
  return out;
}

function listStoredReplies(
  parentId: string,
  teamId: string | undefined,
  channelId: string | undefined,
): GraphChatMessage[] {
  const out: GraphChatMessage[] = [];
  for (const stored of storedChannelMessages) {
    if (stored.replyToId !== parentId) {
      continue;
    }
    if (!scopeMatch(stored, teamId, channelId)) {
      continue;
    }
    out.push(overlayReactions(stored));
  }
  return out;
}

function persistListed(messages: GraphChatMessage[], teamId: string | undefined, channelId: string | undefined): void {
  for (const message of messages) {
    const copy: StoredChannelMessage = { ...message };
    if (teamId !== undefined && copy.teamId === undefined) {
      copy.teamId = teamId;
    }
    if (channelId !== undefined && copy.channelId === undefined) {
      copy.channelId = channelId;
    }
    upsertStored(copy);
    if (message.replies !== undefined) {
      persistListed(message.replies, teamId, channelId);
    }
  }
}

function persistPostedChannelMessage(name: string, args: Record<string, unknown>, text: string): void {
  if (name !== TOOL_TEAMS_POST && name !== TOOL_TEAMS_REPLY) {
    return;
  }
  postSeq += 1;
  const botId = process.env.HARNESS_BOT_ID ?? "bot";
  const message: StoredChannelMessage = {
    id: `mcp-post-${postSeq}`,
    body: { content: text, contentType: "text" },
    from: { id: botId, application: { id: botId } },
    createdDateTime: new Date().toISOString(),
  };
  if (name === TOOL_TEAMS_REPLY) {
    const parent = readString(args["message-id"]);
    if (parent !== undefined && parent.length > 0) {
      message.replyToId = parent;
    }
  }
  const teamId = readString(args["team-id"]);
  if (teamId !== undefined && teamId.length > 0) {
    message.teamId = teamId;
  }
  const channelId = readString(args["channel-id"]);
  if (channelId !== undefined && channelId.length > 0) {
    message.channelId = channelId;
  }
  upsertStored(message);
}

function listChannelValue(args: Record<string, unknown>): GraphChatMessage[] {
  const teamId = readString(args["team-id"]);
  const channelId = readString(args["channel-id"]);
  const fromStore = listStoredRoots(teamId, channelId);
  const byId = new Map<string, GraphChatMessage>();
  for (const message of fromStore) {
    byId.set(message.id, message);
  }
  for (const reactionMsg of listGraphShapedMessages()) {
    const existing = byId.get(reactionMsg.id);
    if (existing !== undefined) {
      const merged: GraphChatMessage = { ...existing };
      if (reactionMsg.reactions !== undefined) {
        merged.reactions = reactionMsg.reactions;
      }
      byId.set(reactionMsg.id, merged);
    } else {
      byId.set(reactionMsg.id, reactionMsg);
    }
  }
  const value = [...byId.values()];
  persistListed(value, teamId, channelId);
  return value;
}

function listChannelRepliesValue(args: Record<string, unknown>): GraphChatMessage[] {
  const parentId = readString(args["message-id"]) ?? "";
  const teamId = readString(args["team-id"]);
  const channelId = readString(args["channel-id"]);
  const value = listStoredReplies(parentId, teamId, channelId);
  persistListed(value, teamId, channelId);
  return value;
}

/** Test helper: seed Graph-shaped channel messages for list / poller. */
export function seedChannelList(messages: GraphChatMessage[]): void {
  persistListed(messages, undefined, undefined);
}

export function resetChannelList(): void {
  storedChannelMessages.splice(0, storedChannelMessages.length);
  postSeq = 0;
}

export function listedChannelMessages(): GraphChatMessage[] {
  return storedChannelMessages.map((m) => ({ ...m }));
}

/**
 * In-process MCP tool implementation (no turn jsonl). Host poller and tests use this.
 */
export function applyTool(name: string, rawArgs: unknown, turnId?: TurnId, scope?: WriteScope): unknown {
  const args = isRecord(rawArgs) ? rawArgs : {};
  if (name === TOOL_DRAIN_INBOX) {
    if (turnId === undefined) {
      return { items: [] };
    }
    return { items: drainInbox(turnId) };
  }
  if (isPostTool(name)) {
    if (scope !== undefined) {
      const bound = bindWriteArgs(scope, name, args);
      process.stderr.write(
        `[mcp] bind original tool=${name} args=${JSON.stringify(args)} bound=${JSON.stringify(bound)}\n`,
      );
      if (!bound.ok) {
        return { ok: false, error: bound.error };
      }
      const text = extractPostText(bound.args);
      persistPostedChannelMessage(bound.tool, bound.args, text);
      return { ok: true, text, bound: { tool: bound.tool, args: bound.args } };
    }
    const text = extractPostText(args);
    persistPostedChannelMessage(name, args, text);
    return { ok: true, text };
  }
  if (isSetReactionTool(name)) {
    const reaction = extractReaction(args);
    if (reaction !== undefined) {
      addStoredReaction(reaction.messageId, reaction.emoji);
    }
    return { ok: true, reaction };
  }
  if (isUnsetReactionTool(name)) {
    const reaction = extractReaction(args);
    if (reaction !== undefined) {
      removeStoredReaction(reaction.messageId, reaction.emoji);
    }
    return { ok: true, reaction };
  }
  if (name === TOOL_CHAT_GET) {
    return graphShapedMessage(readString(args["message-id"]) ?? "");
  }
  if (name === TOOL_CHAT_LIST) {
    return { value: listGraphShapedMessages() };
  }
  if (name === TOOL_TEAMS_LIST) {
    return { value: listChannelValue(args) };
  }
  if (name === TOOL_TEAMS_LIST_REPLIES) {
    return { value: listChannelRepliesValue(args) };
  }
  if (TEAM_MCP_TOOL_DEFS.some((t) => t.name === name)) {
    return { ok: true };
  }
  return { ok: false, error: `unknown tool ${name}` };
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const ran = await runImplementedTool(name, args);
  return ran.result;
}

async function runImplementedTool(
  name: string,
  rawArgs: unknown,
  turnId?: TurnId,
  scope?: WriteScope,
): Promise<{ args: Record<string, unknown>; result: unknown }> {
  const args = isRecord(rawArgs) ? rawArgs : {};
  if (name !== TOOL_DRAIN_INBOX && isGraphConfigured()) {
    if (scope !== undefined && isPostTool(name)) {
      const bound = bindWriteArgs(scope, name, args);
      process.stderr.write(
        `[mcp] bind original tool=${name} args=${JSON.stringify(args)} bound=${JSON.stringify(bound)}\n`,
      );
      if (!bound.ok) {
        return { args, result: { ok: false, error: bound.error } };
      }
      return { args: bound.args, result: await executeGraphTool(bound.tool, bound.args) };
    }
    return { args, result: await executeGraphTool(name, args) };
  }
  const result = applyTool(name, rawArgs, turnId, scope);
  if (isRecord(result) && isRecord(result.bound) && isRecord(result.bound.args)) {
    return { args: result.bound.args, result };
  }
  return { args, result };
}

function seenReactionTools(): { set: string; unset: string } {
  if (process.env.CONVERSATION_TYPE === "channel") {
    return { set: TOOL_TEAMS_SET_REACTION, unset: TOOL_TEAMS_UNSET_REACTION };
  }
  return { set: TOOL_CHAT_SET_REACTION, unset: TOOL_CHAT_UNSET_REACTION };
}

function followupIds(items: InboxItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "followup") {
      ids.push(item.message.messageId);
    }
  }
  return ids;
}

async function walkSeenOnDrain(turnId: TurnId, items: InboxItem[]): Promise<void> {
  const ids = followupIds(items);
  if (ids.length === 0) {
    return;
  }
  const tools = seenReactionTools();
  const chatId = process.env.CONVERSATION_ID ?? "";
  const steps = seenWalk(readSeenMessageId(turnId), ids);
  let latest = readSeenMessageId(turnId);
  for (const step of steps) {
    if (step.unset !== undefined) {
      const args: Record<string, unknown> = {
        "message-id": step.unset,
        reactionType: SEEN_EMOJI,
        "chat-id": chatId,
      };
      const ran = await runImplementedTool(tools.unset, args, turnId);
      appendMcpCall(turnId, { tool: tools.unset, args: ran.args, result: ran.result, at: Date.now() });
      await notifyHost(tools.unset, ran.args, ran.result);
    }
    const args: Record<string, unknown> = {
      "message-id": step.set,
      reactionType: SEEN_EMOJI,
      "chat-id": chatId,
    };
    const ran = await runImplementedTool(tools.set, args, turnId);
    appendMcpCall(turnId, { tool: tools.set, args: ran.args, result: ran.result, at: Date.now() });
    await notifyHost(tools.set, ran.args, ran.result);
    latest = step.set;
  }
  if (latest !== undefined) {
    writeSeenMessageId(turnId, latest);
  }
}

export async function executeTool(
  turnId: TurnId,
  name: string,
  rawArgs: unknown,
  role: McpRole,
  scope?: WriteScope,
): Promise<unknown> {
  const args = isRecord(rawArgs) ? rawArgs : {};
  if (!toolAllowedOnRole(role, name)) {
    const result = { ok: false, error: "tool not on this server" };
    appendMcpCall(turnId, { tool: name, args, result, at: Date.now() });
    return result;
  }
  if (name === TOOL_DRAIN_INBOX) {
    const items = drainInbox(turnId);
    const result = { items };
    appendMcpCall(turnId, { tool: name, args, result, at: Date.now() });
    await notifyHost(name, args, result);
    await walkSeenOnDrain(turnId, items);
    return result;
  }
  const ran = await runImplementedTool(name, rawArgs, turnId, scope);
  appendMcpCall(turnId, { tool: name, args: ran.args, result: ran.result, at: Date.now() });
  await notifyHost(name, ran.args, ran.result);
  return ran.result;
}

async function notifyHost(tool: string, args: Record<string, unknown>, result: unknown): Promise<void> {
  const url = process.env.HOST_CALLBACK_URL;
  if (url === undefined || url.length === 0) {
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, args, result }),
    });
  } catch {
    // host may not be listening in some unit paths
  }
}

export function toolList(role: McpRole): unknown {
  return { tools: toolDefsForRole(role) };
}
