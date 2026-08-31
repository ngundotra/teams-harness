import {
  type ConversationKey,
  type InboundEvent,
  type InboundMessage,
  type InboundReaction,
  type MessageId,
  brandConversationKey,
  brandMessageId,
  isRecord,
  readString,
} from "./types.js";

export type ParseOk = { kind: "ok"; event: InboundEvent };
export type ParseErr = { kind: "error"; message: string };
export type ParseResult = ParseOk | ParseErr;

function conversationKeyOf(
  conversationId: string,
  threadHint: string | undefined,
): ConversationKey {
  if (threadHint !== undefined && threadHint.length > 0 && !conversationId.includes(";messageid=")) {
    return brandConversationKey(`${conversationId};thread=${threadHint}`);
  }
  return brandConversationKey(conversationId);
}

function readConversation(value: unknown): { id: string; conversationType: string } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readString(value.id);
  if (id === undefined || id.length === 0) {
    return undefined;
  }
  const conversationType = readString(value.conversationType) ?? "personal";
  return { id, conversationType };
}

function readFromId(value: unknown): string {
  if (!isRecord(value)) {
    return "unknown";
  }
  return readString(value.id) ?? "unknown";
}

function readReplyToId(value: unknown): MessageId | undefined {
  const raw = readString(value);
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  return brandMessageId(raw);
}

function readThreadHint(activity: Record<string, unknown>): string | undefined {
  const conversation = activity.conversation;
  if (isRecord(conversation)) {
    const threadId = readString(conversation.threadId);
    if (threadId !== undefined && threadId.length > 0) {
      return threadId;
    }
  }
  const channelData = activity.channelData;
  if (isRecord(channelData)) {
    const thread = channelData.thread;
    if (isRecord(thread)) {
      const id = readString(thread.id);
      if (id !== undefined && id.length > 0) {
        return id;
      }
    }
  }
  return undefined;
}

function readTeamChannel(activity: Record<string, unknown>): { teamId?: string; channelId?: string } {
  const channelData = activity.channelData;
  if (!isRecord(channelData)) {
    return {};
  }
  const out: { teamId?: string; channelId?: string } = {};
  const team = channelData.team;
  if (isRecord(team)) {
    const teamId = readString(team.id);
    if (teamId !== undefined && teamId.length > 0) {
      out.teamId = teamId;
    }
  }
  const channel = channelData.channel;
  if (isRecord(channel)) {
    const channelId = readString(channel.id);
    if (channelId !== undefined && channelId.length > 0) {
      out.channelId = channelId;
    }
  }
  return out;
}

function parseMessage(activity: Record<string, unknown>): ParseResult {
  const conversation = readConversation(activity.conversation);
  if (conversation === undefined) {
    return { kind: "error", message: "message activity missing conversation.id" };
  }
  const id = readString(activity.id);
  if (id === undefined || id.length === 0) {
    return { kind: "error", message: "message activity missing id" };
  }
  const text = readString(activity.text) ?? "";
  const serviceUrl = readString(activity.serviceUrl) ?? "";
  const replyToId = readReplyToId(activity.replyToId);
  const ids = readTeamChannel(activity);
  const event: InboundMessage = {
    kind: "message",
    messageId: brandMessageId(id),
    text,
    conversationKey: conversationKeyOf(conversation.id, readThreadHint(activity)),
    conversationId: conversation.id,
    serviceUrl,
    fromId: readFromId(activity.from),
    conversationType: conversation.conversationType,
  };
  if (replyToId !== undefined) {
    event.replyToId = replyToId;
  }
  if (ids.teamId !== undefined) {
    event.teamId = ids.teamId;
  }
  if (ids.channelId !== undefined) {
    event.channelId = ids.channelId;
  }
  return { kind: "ok", event };
}

function reactionsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const emojis: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const emoji = readString(item.type);
    if (emoji !== undefined && emoji.length > 0) {
      emojis.push(emoji);
    }
  }
  return emojis;
}

function buildReactionEvents(body: Record<string, unknown>): InboundReaction[] {
  const conversation = readConversation(body.conversation);
  if (conversation === undefined) {
    return [];
  }
  const target = readReplyToId(body.replyToId);
  if (target === undefined) {
    return [];
  }
  const fromId = readFromId(body.from);
  const serviceUrl = readString(body.serviceUrl) ?? "";
  const key = conversationKeyOf(conversation.id, readThreadHint(body));
  const out: InboundReaction[] = [];
  for (const emoji of reactionsFrom(body.reactionsAdded)) {
    out.push({
      kind: "reaction",
      messageId: target,
      emoji,
      action: "add",
      fromId,
      conversationKey: key,
      conversationId: conversation.id,
      serviceUrl,
    });
  }
  for (const emoji of reactionsFrom(body.reactionsRemoved)) {
    out.push({
      kind: "reaction",
      messageId: target,
      emoji,
      action: "remove",
      fromId,
      conversationKey: key,
      conversationId: conversation.id,
      serviceUrl,
    });
  }
  return out;
}

function parseReaction(activity: Record<string, unknown>): ParseResult {
  if (readConversation(activity.conversation) === undefined) {
    return { kind: "error", message: "messageReaction missing conversation.id" };
  }
  if (readReplyToId(activity.replyToId) === undefined) {
    return { kind: "error", message: "messageReaction missing replyToId (target message)" };
  }
  const events = buildReactionEvents(activity);
  const first = events[0];
  if (first === undefined) {
    return { kind: "error", message: "messageReaction has no reactionsAdded or reactionsRemoved" };
  }
  return { kind: "ok", event: first };
}

export function parseReactionAll(body: unknown): InboundReaction[] {
  if (!isRecord(body)) {
    return [];
  }
  if (readString(body.type) !== "messageReaction") {
    return [];
  }
  return buildReactionEvents(body);
}

const IGNORED_TYPES = new Set([
  "conversationUpdate",
  "installationUpdate",
  "invoke",
  "typing",
  "event",
]);

export function parseActivity(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return { kind: "error", message: "activity is not an object" };
  }
  const type = readString(body.type);
  if (type === undefined) {
    return { kind: "error", message: "activity missing type" };
  }
  if (type === "message") {
    return parseMessage(body);
  }
  if (type === "messageReaction") {
    return parseReaction(body);
  }
  if (IGNORED_TYPES.has(type)) {
    return {
      kind: "ok",
      event: { kind: "ignored", type, reason: `activity type ${type} does not start a turn` },
    };
  }
  return {
    kind: "ok",
    event: { kind: "ignored", type, reason: `unhandled activity type ${type}` },
  };
}
