import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { appendInbox, mcpReadyRolePath, pendingInboxCount, readMcpCalls } from "./inbox.js";
import { extractPostText, writeScopeFromMessage } from "./mcp/runtime.js";
import { isPostTool } from "./mcp/tools.js";
import type { MockTeamsMcp } from "./mockMcp.js";
import { SEEN_EMOJI, readSeenMessageId, seenWalk, writeSeenMessageId } from "./seenCursor.js";
import { newTurnId, TurnStore, turnsRoot } from "./turnStore.js";
import {
  type InboundMessage,
  type InboundReaction,
  type TurnId,
  type TurnRunning,
  brandMessageId,
  isRecord,
  readString,
} from "./types.js";
import { AcpClient, authMethodId } from "./grok/acpClient.js";
import { grokConfigForMcp, teamsMcpServers } from "./grok/mcpSpec.js";
import { drainPrompt, followupPrompt, reactionPrompt, startPrompt } from "./grok/prompt.js";
import { GROK_ACP_ARGS, GROK_BIN, spawnGrok } from "./grok/spawn.js";

export type AckRecord = {
  conversationKey: string;
  text: string;
  at: number;
};

export class HarnessHost {
  readonly store: TurnStore;
  readonly mcp: MockTeamsMcp;
  readonly acks: AckRecord[] = [];
  readonly children = new Map<TurnId, ChildProcess>();
  readonly lastSpawnArgs: string[] = [];
  readonly inboundMessageIds = new Set<string>();
  lastChannelInbound: {
    teamId: string;
    channelId: string;
    conversationId: string;
    serviceUrl: string;
  } | undefined;
  lastSpawnFile = "";
  callbackUrl: string | undefined;
  private readonly jobs = new Map<TurnId, Promise<void>>();
  private disposed = false;
  private readonly pollTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly disposers: Array<() => void> = [];
  private readonly acpByTurn = new Map<TurnId, AcpClient>();
  private readonly sessionByTurn = new Map<TurnId, string>();
  private readonly injectWaits = new Map<TurnId, Promise<unknown>[]>();

  constructor(args: { store: TurnStore; mcp: MockTeamsMcp }) {
    this.store = args.store;
    this.mcp = args.mcp;
  }

  startTurn(message: InboundMessage): TurnRunning {
    this.inboundMessageIds.add(message.messageId);
    if (message.teamId !== undefined && message.channelId !== undefined) {
      this.lastChannelInbound = {
        teamId: message.teamId,
        channelId: message.channelId,
        conversationId: message.conversationId,
        serviceUrl: message.serviceUrl,
      };
    }
    const turnId = newTurnId(message.conversationKey);
    this.acks.push({
      conversationKey: message.conversationKey,
      text: "Working on it…",
      at: Date.now(),
    });
    this.mcp.rememberRoute(message.conversationId, message.serviceUrl, message.conversationId);
    if (message.channelId !== undefined) {
      this.mcp.rememberRoute(message.channelId, message.serviceUrl, message.conversationId);
    }
    if (message.teamId !== undefined) {
      this.mcp.rememberRoute(message.teamId, message.serviceUrl, message.conversationId);
    }
    void this.mcp.ackImmediate(message);

    const specArgs: Parameters<typeof teamsMcpServers>[0] = {
      turnId,
      turnsDir: turnsRoot(),
      conversationId: message.conversationId,
      serviceUrl: message.serviceUrl,
      conversationType: message.conversationType,
      writeScope: writeScopeFromMessage(message),
    };
    if (this.callbackUrl !== undefined) {
      specArgs.callbackUrl = this.callbackUrl;
    }
    const servers = teamsMcpServers(specArgs);
    const child = spawnGrok({
      ...process.env,
      HARNESS_JOB_MS: process.env.HARNESS_JOB_MS ?? "8000",
      TURN_ID: turnId,
      TURNS_DIR: turnsRoot(),
      CONVERSATION_ID: message.conversationId,
      SERVICE_URL: message.serviceUrl,
      CONVERSATION_TYPE: message.conversationType,
      GROK_CONFIG: grokConfigForMcp(servers.read, servers.write),
    });
    this.lastSpawnFile = child.spawnfile;
    this.lastSpawnArgs.splice(0, this.lastSpawnArgs.length, GROK_BIN, ...GROK_ACP_ARGS);
    const pid = child.pid ?? -1;
    this.store.incrementSpawn();

    const running: TurnRunning = {
      kind: "running",
      turnId,
      conversationKey: message.conversationKey,
      startMessage: message,
      followups: [],
      inboundReactions: [],
      setReactions: [],
      pid,
      startedAt: Date.now(),
    };
    this.store.put(running);
    this.children.set(turnId, child);
    void this.moveEyes(turnId, message);
    this.pollMcp(turnId);
    const job = this.runGrok(turnId, child, message, servers);
    this.jobs.set(turnId, job);
    void job.catch((err: unknown) => {
      const text = err instanceof Error ? err.message : "grok failed";
      process.stderr.write(`[host] ${text}\n`);
      this.store.markDone(turnId);
    });
    return running;
  }

  enqueueFollowup(turnId: TurnId, message: InboundMessage): void {
    this.inboundMessageIds.add(message.messageId);
    const current = this.store.getById(turnId);
    if (current === undefined || current.kind !== "running") {
      return;
    }
    current.followups.push(message);
    this.store.put(current);
    appendInbox(turnId, { kind: "followup", message });
    void this.moveEyes(turnId, message);
    this.inject(turnId, followupPrompt(message));
  }

  ferryReaction(turnId: TurnId, reaction: InboundReaction): void {
    const current = this.store.getById(turnId);
    if (current === undefined || current.kind !== "running") {
      return;
    }
    const stored = {
      messageId: reaction.messageId,
      emoji: reaction.emoji,
      action: reaction.action,
      fromId: reaction.fromId,
    };
    current.inboundReactions.push(stored);
    this.store.put(current);
    this.mcp.recordInbound(stored);
    appendInbox(turnId, { kind: "reaction", ...stored });
    this.inject(turnId, reactionPrompt(stored));
  }

  waitUntilDone(turnId: TurnId, timeoutMs: number): Promise<void> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = (): void => {
        const state = this.store.getById(turnId);
        if (state !== undefined && state.kind === "done") {
          this.mcp.hydrateFromCalls(readMcpCalls(turnId));
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`timeout waiting for turn ${turnId}`));
          return;
        }
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  dispose(): void {
    this.disposed = true;
    for (const fn of this.disposers) {
      fn();
    }
    this.disposers.length = 0;
    for (const timer of this.pollTimers) {
      clearTimeout(timer);
    }
    this.pollTimers.clear();
    for (const [turnId, child] of this.children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      this.store.markDone(turnId);
    }
    this.children.clear();
    this.acpByTurn.clear();
    this.sessionByTurn.clear();
    this.injectWaits.clear();
  }

  private pollMcp(turnId: TurnId): void {
    const tick = (): void => {
      if (this.disposed) {
        return;
      }
      this.mcp.hydrateFromCalls(readMcpCalls(turnId));
      const state = this.store.getById(turnId);
      if (state === undefined || state.kind !== "running") {
        return;
      }
      const timer = setTimeout(tick, 25);
      this.pollTimers.add(timer);
    };
    tick();
  }

  private async runGrok(
    turnId: TurnId,
    child: ChildProcess,
    message: InboundMessage,
    servers: ReturnType<typeof teamsMcpServers>,
  ): Promise<void> {
    const acp = new AcpClient(child);
    const init = await acp.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "teams-harness", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    process.stderr.write(`[host] initialize ok command=${servers.read.command}\n`);
    const methodId = authMethodId(init);
    if (methodId !== undefined) {
      await acp.request("authenticate", { methodId, _meta: { headless: true } });
    }
    const created = await acp.request("session/new", {
      cwd: process.cwd(),
      mcpServers: [servers.read, servers.write],
    });
    const sessionId = isRecord(created) ? readString(created.sessionId) : undefined;
    if (sessionId === undefined) {
      throw new Error("session/new did not return sessionId");
    }
    process.stderr.write(`[host] session/new ${sessionId} mcp=${servers.read.name}+${servers.write.name}\n`);
    await waitForMcpReady(turnId, 15000);
    const current = this.store.getById(turnId);
    if (current !== undefined && current.kind === "running") {
      current.grokSessionId = sessionId;
      this.store.put(current);
    }
    this.acpByTurn.set(turnId, acp);
    this.sessionByTurn.set(turnId, sessionId);

    await acp.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: startPrompt(message) }],
    });

    const waits = this.injectWaits.get(turnId) ?? [];
    if (waits.length > 0) {
      await Promise.allSettled(waits);
    }

    while (pendingInboxCount(turnId) > 0) {
      await acp.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: drainPrompt() }],
      });
    }

    this.mcp.hydrateFromCalls(readMcpCalls(turnId));
    const reply = lastPostText(readMcpCalls(turnId));
    this.store.markDone(turnId, reply);
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    this.children.delete(turnId);
    this.acpByTurn.delete(turnId);
    this.sessionByTurn.delete(turnId);
    this.injectWaits.delete(turnId);
  }

  private async moveEyes(turnId: TurnId, message: InboundMessage): Promise<void> {
    this.mcp.rememberInbound(message);
    const steps = seenWalk(readSeenMessageId(turnId), [message.messageId]);
    let latest = readSeenMessageId(turnId);
    for (const step of steps) {
      if (step.unset !== undefined) {
        const unsetId = brandMessageId(step.unset);
        this.mcp.recordUnset({ messageId: unsetId, emoji: SEEN_EMOJI });
        await this.mcp.fireUnsetReaction(
          this.mcp.harnessReactionArgs({
            conversationId: message.conversationId,
            serviceUrl: message.serviceUrl,
            messageId: unsetId,
            emoji: SEEN_EMOJI,
          }),
        );
      }
      const setId = brandMessageId(step.set);
      this.mcp.recordSet({ messageId: setId, emoji: SEEN_EMOJI });
      await this.mcp.fireSetReaction(
        this.mcp.harnessReactionArgs({
          conversationId: message.conversationId,
          serviceUrl: message.serviceUrl,
          messageId: setId,
          emoji: SEEN_EMOJI,
        }),
      );
      latest = step.set;
    }
    if (latest !== undefined) {
      writeSeenMessageId(turnId, latest);
    }
  }

  private inject(turnId: TurnId, text: string): void {
    const acp = this.acpByTurn.get(turnId);
    const sessionId = this.sessionByTurn.get(turnId);
    if (acp === undefined || sessionId === undefined) {
      return;
    }
    process.stderr.write(`[host] inject session/prompt ${sessionId}\n`);
    const pending = acp.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    const waits = this.injectWaits.get(turnId) ?? [];
    waits.push(pending);
    this.injectWaits.set(turnId, waits);
  }
}

async function waitForMcpReady(turnId: TurnId, timeoutMs: number): Promise<void> {
  const readPath = mcpReadyRolePath(turnId, "read");
  const writePath = mcpReadyRolePath(turnId, "write");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(readPath) && existsSync(writePath)) {
      await new Promise((resolve) => {
        setTimeout(resolve, 750);
      });
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  process.stderr.write(`[host] mcp-ready timed out for ${turnId}\n`);
}

function lastPostText(calls: unknown[]): string | undefined {
  let text: string | undefined;
  for (const raw of calls) {
    if (!isRecord(raw)) {
      continue;
    }
    const tool = readString(raw.tool);
    if (tool === undefined || !isPostTool(tool)) {
      continue;
    }
    if (!isRecord(raw.args)) {
      continue;
    }
    text = extractPostText(raw.args);
  }
  return text;
}
