import type { Surface } from "./surface.js";

export type { Surface } from "./surface.js";

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TurnId = Brand<string, "TurnId">;
export type MessageId = Brand<string, "MessageId">;
export type ConversationKey = Brand<string, "ConversationKey">;

export function brandTurnId(value: string): TurnId {
  if (value.length === 0) {
    throw new Error("turn id must be non-empty");
  }
  return value as TurnId;
}

export function brandMessageId(value: string): MessageId {
  if (value.length === 0) {
    throw new Error("message id must be non-empty");
  }
  return value as MessageId;
}

export function brandConversationKey(value: string): ConversationKey {
  if (value.length === 0) {
    throw new Error("conversation key must be non-empty");
  }
  return value as ConversationKey;
}

export type InboundMessage = {
  kind: "message";
  messageId: MessageId;
  text: string;
  conversationKey: ConversationKey;
  conversationId: string;
  serviceUrl: string;
  fromId: string;
  conversationType: string;
  surface: Surface;
  replyToId?: MessageId;
  teamId?: string;
  channelId?: string;
};

export type InboundReaction = {
  kind: "reaction";
  messageId: MessageId;
  emoji: string;
  action: "add" | "remove";
  fromId: string;
  conversationKey: ConversationKey;
  conversationId: string;
  serviceUrl: string;
};

export type InboundIgnored = {
  kind: "ignored";
  type: string;
  reason: string;
};

export type InboundEvent = InboundMessage | InboundReaction | InboundIgnored;


export type InboxFollowup = { kind: "followup"; message: InboundMessage };
export type InboxReaction = {
  kind: "reaction";
  messageId: MessageId;
  emoji: string;
  action: "add" | "remove";
  fromId: string;
};
export type InboxItem = InboxFollowup | InboxReaction;

export type StoredReaction = {
  messageId: MessageId;
  emoji: string;
  action: "add" | "remove";
  fromId: string;
};

export type SetReaction = {
  messageId: MessageId;
  emoji: string;
};

export type TurnRunning = {
  kind: "running";
  turnId: TurnId;
  conversationKey: ConversationKey;
  startMessage: InboundMessage;
  followups: InboundMessage[];
  inboundReactions: StoredReaction[];
  setReactions: SetReaction[];
  pid: number;
  startedAt: number;
  grokSessionId?: string;
};

export type TurnDone = {
  kind: "done";
  turnId: TurnId;
  conversationKey: ConversationKey;
  startMessage: InboundMessage;
  followups: InboundMessage[];
  inboundReactions: StoredReaction[];
  setReactions: SetReaction[];
  finalReply?: string;
};

export type TurnState = TurnRunning | TurnDone;

export type DispatchResult =
  | { kind: "started"; turnId: TurnId }
  | { kind: "enqueued"; turnId: TurnId }
  | { kind: "ferried"; turnId: TurnId }
  | { kind: "dropped"; reason: string }
  | { kind: "ignored"; reason: string };

export type AcpEnvVar = { name: string; value: string };

/** ACP v1 stdio MCP server item. Grok tagged McpServer needs type. */
export type AcpMcpServerStdio = {
  type: "stdio";
  name: string;
  command: string;
  args: string[];
  env: AcpEnvVar[];
};

export type McpCallRecord = {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  at: number;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
