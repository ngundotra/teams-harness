import { dispatchActivity } from "./dispatch.js";
import type { HarnessHost } from "./harnessHost.js";
import { callMcpTool, type GraphChatMessage } from "./mcp/runtime.js";
import { TOOL_TEAMS_LIST, TOOL_TEAMS_LIST_REPLIES } from "./mcp/tools.js";
import {
  type DispatchResult,
  isRecord,
  readString,
} from "./types.js";

export type ChannelMcpCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export type LastChannelInbound = {
  teamId: string;
  channelId: string;
  conversationId: string;
  serviceUrl: string;
};

export type ChannelWatchOptions = {
  host: HarnessHost;
  callMcp?: ChannelMcpCall;
  teamId?: string;
  channelId?: string;
  botId?: string;
  pollMs?: number;
  serviceUrl?: string;
};

const DEFAULT_POLL_MS = 2000;

function envNonEmpty(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  return raw;
}

function parsePollMs(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_POLL_MS;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_MS;
}

function graphFromId(from: unknown): string {
  if (!isRecord(from)) {
    return "unknown";
  }
  const flat = readString(from.id);
  if (flat !== undefined && flat.length > 0) {
    return flat;
  }
  const user = from.user;
  if (isRecord(user)) {
    const id = readString(user.id);
    if (id !== undefined && id.length > 0) {
      return id;
    }
  }
  const application = from.application;
  if (isRecord(application)) {
    const id = readString(application.id);
    if (id !== undefined && id.length > 0) {
      return id;
    }
  }
  return "unknown";
}

function graphText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (isRecord(body)) {
    return readString(body.content) ?? "";
  }
  return "";
}

function parseIdentity(value: unknown): { id: string; displayName?: string } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readString(value.id);
  if (id === undefined || id.length === 0) {
    return undefined;
  }
  const identity: { id: string; displayName?: string } = { id };
  const displayName = readString(value.displayName);
  if (displayName !== undefined) {
    identity.displayName = displayName;
  }
  return identity;
}

function parseGraphFrom(value: unknown): GraphChatMessage["from"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const from: NonNullable<GraphChatMessage["from"]> = {};
  const flat = readString(value.id);
  if (flat !== undefined && flat.length > 0) {
    from.id = flat;
  }
  const user = parseIdentity(value.user);
  if (user !== undefined) {
    from.user = user;
  }
  const application = parseIdentity(value.application);
  if (application !== undefined) {
    from.application = application;
  }
  if (from.id === undefined && from.user === undefined && from.application === undefined) {
    return undefined;
  }
  return from;
}

function parseGraphMessage(value: unknown): GraphChatMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readString(value.id);
  if (id === undefined || id.length === 0) {
    return undefined;
  }
  const message: GraphChatMessage = { id };
  if (value.body !== undefined) {
    if (typeof value.body === "string") {
      message.body = value.body;
    } else if (isRecord(value.body)) {
      const content = readString(value.body.content) ?? "";
      const body: { content: string; contentType?: string } = { content };
      const contentType = readString(value.body.contentType);
      if (contentType !== undefined) {
        body.contentType = contentType;
      }
      message.body = body;
    }
  }
  const from = parseGraphFrom(value.from);
  if (from !== undefined) {
    message.from = from;
  }
  const created = readString(value.createdDateTime);
  if (created !== undefined) {
    message.createdDateTime = created;
  }
  const replyToId = readString(value.replyToId);
  if (replyToId !== undefined && replyToId.length > 0) {
    message.replyToId = replyToId;
  }
  if (Array.isArray(value.replies)) {
    const replies: GraphChatMessage[] = [];
    for (const item of value.replies) {
      const parsed = parseGraphMessage(item);
      if (parsed !== undefined) {
        replies.push(parsed);
      }
    }
    message.replies = replies;
  }
  return message;
}

function parseListValue(raw: unknown): GraphChatMessage[] {
  if (isRecord(raw) && Array.isArray(raw.value)) {
    const out: GraphChatMessage[] = [];
    for (const item of raw.value) {
      const parsed = parseGraphMessage(item);
      if (parsed !== undefined) {
        out.push(parsed);
      }
    }
    return out;
  }
  if (isRecord(raw) && Array.isArray(raw.content)) {
    const first: unknown = raw.content[0];
    if (isRecord(first)) {
      const text = readString(first.text);
      if (text !== undefined && text.length > 0) {
        try {
          const inner: unknown = JSON.parse(text);
          return parseListValue(inner);
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function createdMs(message: GraphChatMessage): number {
  if (message.createdDateTime === undefined) {
    return 0;
  }
  const n = Date.parse(message.createdDateTime);
  return Number.isFinite(n) ? n : 0;
}

function sortMessages(messages: GraphChatMessage[]): GraphChatMessage[] {
  return [...messages].sort((a, b) => {
    const dt = createdMs(a) - createdMs(b);
    if (dt !== 0) {
      return dt;
    }
    return a.id.localeCompare(b.id);
  });
}

function threadConversationId(channelId: string, rootId: string): string {
  if (channelId.includes(";messageid=")) {
    return channelId;
  }
  return `${channelId};messageid=${rootId}`;
}

export class ChannelWatcher {
  readonly host: HarnessHost;
  private readonly callMcp: ChannelMcpCall;
  private readonly teamIdOpt: string | undefined;
  private readonly channelIdOpt: string | undefined;
  private readonly botId: string;
  private readonly pollMs: number;
  private readonly serviceUrlOpt: string | undefined;
  private readonly seen = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: ChannelWatchOptions) {
    this.host = opts.host;
    this.callMcp = opts.callMcp ?? callMcpTool;
    this.teamIdOpt = opts.teamId ?? envNonEmpty("HARNESS_TEAM_ID");
    this.channelIdOpt = opts.channelId ?? envNonEmpty("HARNESS_CHANNEL_ID");
    this.botId = opts.botId ?? envNonEmpty("HARNESS_BOT_ID") ?? "";
    this.pollMs = opts.pollMs ?? parsePollMs(envNonEmpty("HARNESS_CHANNEL_POLL_MS"));
    this.serviceUrlOpt = opts.serviceUrl ?? envNonEmpty("HARNESS_SERVICE_URL");
  }

  hasTarget(): boolean {
    return this.resolveTeamId() !== undefined && this.resolveChannelId() !== undefined;
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<DispatchResult[]> {
    if (this.ticking) {
      return [];
    }
    const teamId = this.resolveTeamId();
    const channelId = this.resolveChannelId();
    if (teamId === undefined || channelId === undefined) {
      return [];
    }
    this.ticking = true;
    try {
      const messages = await this.listUnseen(teamId, channelId);
      const results: DispatchResult[] = [];
      for (const message of messages) {
        const dispatched = this.dispatchListed(message, teamId, channelId);
        if (dispatched !== undefined) {
          results.push(dispatched);
        }
      }
      return results;
    } finally {
      this.ticking = false;
    }
  }

  private resolveTeamId(): string | undefined {
    return this.teamIdOpt ?? this.host.lastChannelInbound?.teamId;
  }

  private resolveChannelId(): string | undefined {
    return this.channelIdOpt ?? this.host.lastChannelInbound?.channelId;
  }

  private resolveServiceUrl(teamId: string, channelId: string): string {
    if (this.serviceUrlOpt !== undefined && this.serviceUrlOpt.length > 0) {
      return this.serviceUrlOpt;
    }
    const remembered = this.host.lastChannelInbound?.serviceUrl;
    if (remembered !== undefined && remembered.length > 0) {
      return remembered;
    }
    const byChannel = this.host.mcp.getRoute(channelId);
    if (byChannel !== undefined && byChannel.serviceUrl.length > 0) {
      return byChannel.serviceUrl;
    }
    const byTeam = this.host.mcp.getRoute(teamId);
    if (byTeam !== undefined && byTeam.serviceUrl.length > 0) {
      return byTeam.serviceUrl;
    }
    return "";
  }

  private async listUnseen(teamId: string, channelId: string): Promise<GraphChatMessage[]> {
    const listed = parseListValue(
      await this.callMcp(TOOL_TEAMS_LIST, { "team-id": teamId, "channel-id": channelId }),
    );
    const collected: GraphChatMessage[] = [];
    for (const root of listed) {
      collected.push(root);
      if (root.replies !== undefined && root.replies.length > 0) {
        for (const reply of root.replies) {
          const withParent: GraphChatMessage = { ...reply };
          if (withParent.replyToId === undefined) {
            withParent.replyToId = root.id;
          }
          collected.push(withParent);
        }
        continue;
      }
      const replies = parseListValue(
        await this.callMcp(TOOL_TEAMS_LIST_REPLIES, {
          "team-id": teamId,
          "channel-id": channelId,
          "message-id": root.id,
        }),
      );
      for (const reply of replies) {
        const withParent: GraphChatMessage = { ...reply };
        if (withParent.replyToId === undefined) {
          withParent.replyToId = root.id;
        }
        collected.push(withParent);
      }
    }
    return sortMessages(collected);
  }

  private dispatchListed(
    message: GraphChatMessage,
    teamId: string,
    channelId: string,
  ): DispatchResult | undefined {
    if (this.seen.has(message.id) || this.host.inboundMessageIds.has(message.id)) {
      this.seen.add(message.id);
      return undefined;
    }
    this.seen.add(message.id);
    const fromId = graphFromId(message.from);
    if (this.botId.length > 0 && fromId === this.botId) {
      return undefined;
    }
    const rootId = message.replyToId ?? message.id;
    const conversationId = threadConversationId(channelId, rootId);
    const activity: Record<string, unknown> = {
      type: "message",
      id: message.id,
      text: graphText(message.body),
      serviceUrl: this.resolveServiceUrl(teamId, channelId),
      from: { id: fromId },
      conversation: {
        id: conversationId,
        isGroup: true,
        conversationType: "channel",
      },
      channelData: {
        team: { id: teamId },
        channel: { id: channelId },
      },
    };
    if (message.replyToId !== undefined) {
      activity.replyToId = message.replyToId;
    }
    const results = dispatchActivity(this.host, activity);
    return results[0];
  }
}

export function createChannelWatcher(host: HarnessHost, opts?: Omit<ChannelWatchOptions, "host">): ChannelWatcher {
  const args: ChannelWatchOptions = { host };
  if (opts !== undefined) {
    if (opts.callMcp !== undefined) {
      args.callMcp = opts.callMcp;
    }
    if (opts.teamId !== undefined) {
      args.teamId = opts.teamId;
    }
    if (opts.channelId !== undefined) {
      args.channelId = opts.channelId;
    }
    if (opts.botId !== undefined) {
      args.botId = opts.botId;
    }
    if (opts.pollMs !== undefined) {
      args.pollMs = opts.pollMs;
    }
    if (opts.serviceUrl !== undefined) {
      args.serviceUrl = opts.serviceUrl;
    }
  }
  return new ChannelWatcher(args);
}
