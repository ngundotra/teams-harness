import { brandConversationKey, type ConversationKey } from "./types.js";

/** One turn lives on exactly one surface. Thread is not a flag on a channel turn. */
export type Surface =
  | { kind: "dm"; chatId: string }
  | { kind: "group"; chatId: string }
  | { kind: "thread"; teamId: string; channelId: string; threadId: string };

export function conversationKeyFromSurface(surface: Surface): ConversationKey {
  switch (surface.kind) {
    case "dm":
    case "group":
      return brandConversationKey(surface.chatId);
    case "thread":
      return brandConversationKey(threadConversationId(surface.channelId, surface.threadId));
    default: {
      const _exhaustive: never = surface;
      throw new Error(`unknown surface ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Bot Framework / Graph conversationType derived from Surface. */
export function conversationTypeFromSurface(surface: Surface): string {
  switch (surface.kind) {
    case "dm":
      return "personal";
    case "group":
      return "groupChat";
    case "thread":
      return "channel";
    default: {
      const _exhaustive: never = surface;
      throw new Error(`unknown surface ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function threadConversationId(channelId: string, threadId: string): string {
  if (channelId.includes(";messageid=")) {
    return channelId;
  }
  return `${channelId};messageid=${threadId}`;
}

export function messageIdSuffix(conversationId: string): string | undefined {
  const marker = ";messageid=";
  const i = conversationId.indexOf(marker);
  if (i < 0) {
    return undefined;
  }
  const id = conversationId.slice(i + marker.length);
  return id.length > 0 ? id : undefined;
}

export function channelIdFromConversationId(conversationId: string): string {
  const marker = ";messageid=";
  const i = conversationId.indexOf(marker);
  return i >= 0 ? conversationId.slice(0, i) : conversationId;
}

export type SurfaceFields = {
  conversationId: string;
  conversationType: string;
  isGroup?: boolean | undefined;
  messageId?: string | undefined;
  replyToId?: string | undefined;
  threadHint?: string | undefined;
  teamId?: string | undefined;
  channelId?: string | undefined;
};

/**
 * Derive the turn surface. A new channel root post opens a thread surface
 * whose threadId is that post id. Replies use the root (messageid / replyToId / hint).
 */
export function surfaceFromFields(fields: SurfaceFields): Surface {
  const teamId = emptyToUndef(fields.teamId);
  const channelId =
    emptyToUndef(fields.channelId) ??
    (fields.conversationType === "channel"
      ? channelIdFromConversationId(fields.conversationId)
      : undefined);
  const isChannel = fields.conversationType === "channel" || (teamId !== undefined && channelId !== undefined);
  if (isChannel) {
    if (teamId === undefined || channelId === undefined) {
      throw new Error("thread surface requires teamId and channelId");
    }
    const threadId = threadIdFromFields(fields);
    return { kind: "thread", teamId, channelId, threadId };
  }
  if (fields.conversationType === "groupChat" || fields.isGroup === true) {
    return { kind: "group", chatId: fields.conversationId };
  }
  return { kind: "dm", chatId: fields.conversationId };
}

function threadIdFromFields(fields: SurfaceFields): string {
  const fromConv = messageIdSuffix(fields.conversationId);
  if (fromConv !== undefined) {
    return fromConv;
  }
  const hint = emptyToUndef(fields.threadHint);
  if (hint !== undefined) {
    return hint;
  }
  const reply = emptyToUndef(fields.replyToId);
  if (reply !== undefined) {
    return reply;
  }
  const messageId = emptyToUndef(fields.messageId);
  if (messageId !== undefined) {
    return messageId;
  }
  throw new Error("thread surface requires a thread id");
}

export function parseSurface(value: unknown): Surface | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  const kind = typeof rec.kind === "string" ? rec.kind : undefined;
  if (kind === "dm" || kind === "group") {
    const chatId = typeof rec.chatId === "string" ? rec.chatId : undefined;
    if (chatId === undefined || chatId.length === 0) {
      return undefined;
    }
    return { kind, chatId };
  }
  if (kind === "thread") {
    const teamId = typeof rec.teamId === "string" ? rec.teamId : undefined;
    const channelId = typeof rec.channelId === "string" ? rec.channelId : undefined;
    const threadId = typeof rec.threadId === "string" ? rec.threadId : undefined;
    if (
      teamId === undefined ||
      teamId.length === 0 ||
      channelId === undefined ||
      channelId.length === 0 ||
      threadId === undefined ||
      threadId.length === 0
    ) {
      return undefined;
    }
    return { kind: "thread", teamId, channelId, threadId };
  }
  return undefined;
}

export function surfacePromptFields(surface: Surface): {
  "chat-id"?: string;
  "team-id"?: string;
  "channel-id"?: string;
  "thread-id"?: string;
} {
  switch (surface.kind) {
    case "dm":
    case "group":
      return { "chat-id": surface.chatId };
    case "thread":
      return {
        "team-id": surface.teamId,
        "channel-id": surface.channelId,
        "thread-id": surface.threadId,
      };
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

export function surfaceEnvVars(surface: Surface): Array<{ name: string; value: string }> {
  const env: Array<{ name: string; value: string }> = [
    { name: "SURFACE_KIND", value: surface.kind },
    { name: "CONVERSATION_TYPE", value: conversationTypeFromSurface(surface) },
  ];
  switch (surface.kind) {
    case "dm":
    case "group":
      env.push({ name: "SURFACE_CHAT_ID", value: surface.chatId });
      break;
    case "thread":
      env.push(
        { name: "SURFACE_TEAM_ID", value: surface.teamId },
        { name: "SURFACE_CHANNEL_ID", value: surface.channelId },
        { name: "SURFACE_THREAD_ID", value: surface.threadId },
      );
      break;
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
  return env;
}

function emptyToUndef(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}
