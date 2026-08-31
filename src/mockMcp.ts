import { extractPostText, extractReaction } from "./mcp/runtime.js";
import { isPostTool, isSetReactionTool, isUnsetReactionTool } from "./mcp/tools.js";
import {
  type MessageId,
  type SetReaction,
  type StoredReaction,
  brandMessageId,
  isRecord,
  readString,
} from "./types.js";

export type SentMessage = {
  conversationId: string;
  serviceUrl: string;
  text: string;
  replyToId?: MessageId;
  messageId: MessageId;
};

export type RememberedInbound = {
  text: string;
  replyToId?: MessageId;
  conversationType?: string;
};

export type OutboundReactionArgs = {
  conversationId: string;
  serviceUrl: string;
  messageId: MessageId;
  emoji: string;
  text?: string;
  replyToId?: MessageId;
};

export type OutboundApply = {
  sendMessage(args: SentMessage): Promise<void>;
  setReaction(args: OutboundReactionArgs): Promise<void>;
  unsetReaction?(args: OutboundReactionArgs): Promise<void>;
  ack?(args: { conversationId: string; serviceUrl: string; text: string }): Promise<void>;
};

/**
 * Host-side record of mock Work IQ MCP calls. The grok process talks to the
 * MCP stdio server; this object is hydrated from mcp-calls.jsonl / callback.
 */
export class MockTeamsMcp {
  readonly sent: SentMessage[] = [];
  readonly setReactions: SetReaction[] = [];
  readonly unsetReactions: SetReaction[] = [];
  readonly inboundByMessage = new Map<string, StoredReaction[]>();
  readonly toolsInvoked: string[] = [];
  private outbound: OutboundApply | undefined;
  private seq = 0;
  private hydrated = 0;
  /** conversationId / chat-id / channel-id / team-id → connector route */
  private readonly routes = new Map<string, { serviceUrl: string; conversationId: string }>();
  private readonly inboundTexts = new Map<string, RememberedInbound>();
  private readonly postedReactKeys = new Set<string>();

  attachOutbound(outbound: OutboundApply): void {
    this.outbound = outbound;
  }

  rememberRoute(key: string, serviceUrl: string, conversationId: string): void {
    if (key.length === 0 || serviceUrl.length === 0 || conversationId.length === 0) {
      return;
    }
    this.routes.set(key, { serviceUrl, conversationId });
  }

  rememberInbound(message: {
    messageId: string;
    text: string;
    replyToId?: MessageId;
    conversationType?: string;
  }): void {
    const rec: RememberedInbound = { text: message.text };
    if (message.replyToId !== undefined) {
      rec.replyToId = message.replyToId;
    }
    if (message.conversationType !== undefined) {
      rec.conversationType = message.conversationType;
    }
    this.inboundTexts.set(message.messageId, rec);
  }

  recordSet(rec: SetReaction): void {
    if (!this.setReactions.some((r) => r.messageId === rec.messageId && r.emoji === rec.emoji)) {
      this.setReactions.push(rec);
    }
  }

  recordUnset(rec: SetReaction): void {
    if (!this.unsetReactions.some((r) => r.messageId === rec.messageId && r.emoji === rec.emoji)) {
      this.unsetReactions.push(rec);
    }
  }

  async fireSetReaction(args: OutboundReactionArgs): Promise<void> {
    const key = `${args.messageId}\0${args.emoji}`;
    if (this.postedReactKeys.has(key)) {
      return;
    }
    this.postedReactKeys.add(key);
    if (this.outbound !== undefined) {
      await this.outbound.setReaction(args);
    }
  }

  async fireUnsetReaction(args: OutboundReactionArgs): Promise<void> {
    const key = `${args.messageId}\0${args.emoji}`;
    this.postedReactKeys.delete(key);
    if (this.outbound?.unsetReaction !== undefined) {
      await this.outbound.unsetReaction(args);
    }
  }

  getRoute(key: string): { serviceUrl: string; conversationId: string } | undefined {
    return this.routes.get(key);
  }

  recordInbound(reaction: StoredReaction): void {
    const list = this.inboundByMessage.get(reaction.messageId) ?? [];
    list.push(reaction);
    this.inboundByMessage.set(reaction.messageId, list);
  }

  async ackImmediate(args: {
    conversationId: string;
    serviceUrl: string;
    channelId?: string;
    teamId?: string;
  }): Promise<void> {
    this.rememberRoute(args.conversationId, args.serviceUrl, args.conversationId);
    if (args.channelId !== undefined) {
      this.rememberRoute(args.channelId, args.serviceUrl, args.conversationId);
    }
    if (args.teamId !== undefined) {
      this.rememberRoute(args.teamId, args.serviceUrl, args.conversationId);
    }
    if (this.outbound?.ack !== undefined) {
      await this.outbound.ack({
        conversationId: args.conversationId,
        serviceUrl: args.serviceUrl,
        text: "Working on it…",
      });
    }
  }

  hydrateFromCalls(calls: unknown[]): void {
    const unread = calls.slice(this.hydrated);
    this.hydrated += unread.length;
    for (const raw of unread) {
      this.applyCall(raw);
    }
  }

  applyCall(raw: unknown): void {
    if (!isRecord(raw)) {
      return;
    }
    const tool = readString(raw.tool);
    if (tool === undefined) {
      return;
    }
    this.toolsInvoked.push(tool);
    const rawArgs = isRecord(raw.args) ? raw.args : {};
    const result = isRecord(raw.result) ? raw.result : {};
    const bound = isRecord(result.bound) ? result.bound : {};
    const boundArgs = isRecord(bound.args) ? bound.args : {};
    const args: Record<string, unknown> = { ...rawArgs, ...boundArgs };
    if (isUnsetReactionTool(tool)) {
      const reaction = extractReaction(args);
      if (reaction !== undefined) {
        const rec = { messageId: brandMessageId(reaction.messageId), emoji: reaction.emoji };
        if (!this.unsetReactions.some((r) => r.messageId === rec.messageId && r.emoji === rec.emoji)) {
          this.unsetReactions.push(rec);
        }
      }
      return;
    }
    if (isSetReactionTool(tool)) {
      const reaction = extractReaction(args);
      if (reaction !== undefined) {
        const rec = { messageId: brandMessageId(reaction.messageId), emoji: reaction.emoji };
        if (!this.setReactions.some((r) => r.messageId === rec.messageId && r.emoji === rec.emoji)) {
          this.setReactions.push(rec);
        }
      }
      return;
    }
    if (isPostTool(tool)) {
      const text = extractPostText(args);
      const already = this.sent.some((s) => s.text === text);
      if (already) {
        return;
      }
      this.seq += 1;
      const graphId = conversationIdFromArgs(args);
      const route = this.lookupRoute(args, graphId);
      const sent: SentMessage = {
        conversationId: route?.conversationId ?? graphId,
        serviceUrl: route?.serviceUrl ?? "",
        text,
        messageId: brandMessageId(`mcp-msg-${this.seq}`),
      };
      this.sent.push(sent);
    }
  }

  async applyFromCallback(raw: unknown): Promise<void> {
    this.applyCall(raw);
    if (!isRecord(raw) || this.outbound === undefined) {
      return;
    }
    const tool = readString(raw.tool);
    const args = isRecord(raw.args) ? raw.args : {};
    if (tool !== undefined && isSetReactionTool(tool)) {
      const reaction = extractReaction(args);
      if (reaction !== undefined) {
        await this.fireSetReaction(this.outboundReaction(args, reaction));
      }
    }
    if (tool !== undefined && isUnsetReactionTool(tool)) {
      const reaction = extractReaction(args);
      if (reaction !== undefined) {
        await this.fireUnsetReaction(this.outboundReaction(args, reaction));
      }
    }
    if (tool !== undefined && isPostTool(tool)) {
      const last = this.sent[this.sent.length - 1];
      if (last !== undefined) {
        await this.outbound.sendMessage(last);
      }
    }
  }

  private outboundReaction(
    args: Record<string, unknown>,
    reaction: { messageId: string; emoji: string },
  ): OutboundReactionArgs {
    const graphId = conversationIdFromArgs(args);
    const route = this.lookupRoute(args, graphId);
    const remembered = this.inboundTexts.get(reaction.messageId);
    const payload: OutboundReactionArgs = {
      conversationId: route?.conversationId ?? graphId,
      serviceUrl: route?.serviceUrl ?? "",
      messageId: brandMessageId(reaction.messageId),
      emoji: reaction.emoji,
    };
    if (remembered !== undefined) {
      payload.text = remembered.text;
      if (remembered.conversationType === "channel") {
        payload.replyToId = remembered.replyToId ?? brandMessageId(reaction.messageId);
      } else if (remembered.replyToId !== undefined) {
        payload.replyToId = remembered.replyToId;
      }
    }
    return payload;
  }

  harnessReactionArgs(args: {
    conversationId: string;
    serviceUrl: string;
    messageId: MessageId;
    emoji: string;
  }): OutboundReactionArgs {
    return this.outboundReaction(
      { "chat-id": args.conversationId },
      { messageId: args.messageId, emoji: args.emoji },
    );
  }

  private lookupRoute(
    args: Record<string, unknown>,
    conversationId: string,
  ): { serviceUrl: string; conversationId: string } | undefined {
    for (const key of [
      readString(args["chat-id"]),
      readString(args["channel-id"]),
      readString(args["team-id"]),
      conversationId,
    ]) {
      if (key === undefined || key.length === 0) {
        continue;
      }
      const route = this.routes.get(key);
      if (route !== undefined) {
        return route;
      }
    }
    return undefined;
  }
}

function conversationIdFromArgs(args: Record<string, unknown>): string {
  return readString(args["chat-id"]) ?? readString(args["channel-id"]) ?? readString(args["team-id"]) ?? "";
}
