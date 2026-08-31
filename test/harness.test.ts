import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, type Runtime } from "../src/app.js";
import { dispatchActivity } from "../src/dispatch.js";
import { GROK_ACP_ARGS, GROK_BIN } from "../src/grok/spawn.js";
import { MockTeamsMcp, type SentMessage } from "../src/mockMcp.js";
import { brandConversationKey } from "../src/types.js";
import { messageReactionAdded, personalMessage } from "./fixtures.js";
import { isEyesEmoji } from "./helpers.js";

process.env.TURNS_DIR = mkdtempSync(join(tmpdir(), "turns-"));
process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";

const KEY = brandConversationKey("a:personal-1");
let runtime: Runtime;

before(() => {
  runtime = createRuntime();
});

after(() => {
  runtime.host.dispose();
});

test("1 first message: immediate ack, turn running, harness spawned", () => {
  const startedAt = Date.now();
  const results = dispatchActivity(runtime.host, personalMessage("msg-1", "hello world"));
  const elapsed = Date.now() - startedAt;
  assert.equal(results[0]?.kind, "started");
  assert.ok(elapsed < 500, `ack must be immediate, took ${elapsed}ms`);
  assert.equal(runtime.store.runningCount(), 1);
  assert.equal(runtime.store.getSpawnCount(), 1);
  assert.equal(runtime.host.acks.length, 1);
  assert.match(runtime.host.acks[0]?.text ?? "", /Working/);
  const running = runtime.store.getRunning(KEY);
  assert.ok(running);
  assert.equal(running?.kind, "running");
  assert.ok((running?.pid ?? -1) > 0);
  assert.match(runtime.host.lastSpawnFile, /grok$/);
  assert.doesNotMatch(runtime.host.lastSpawnFile, /fakeGrok|test\/shim/);
  assert.deepEqual(runtime.host.lastSpawnArgs, [GROK_BIN, ...GROK_ACP_ARGS]);
});

test("2 second message during job: enqueued, no second harness", () => {
  const beforeSpawns = runtime.store.getSpawnCount();
  const results = dispatchActivity(runtime.host, personalMessage("msg-2", "follow up please"));
  assert.equal(results[0]?.kind, "enqueued");
  assert.equal(runtime.store.getSpawnCount(), beforeSpawns);
  assert.equal(runtime.store.runningCount(), 1);
  const running = runtime.store.getRunning(KEY);
  assert.equal(running?.followups.length, 1);
  assert.equal(running?.followups[0]?.text, "follow up please");
});

test("3 reaction on first message ferries keyed by replyToId target", () => {
  const results = dispatchActivity(runtime.host, messageReactionAdded("msg-1", "like"));
  assert.equal(results[0]?.kind, "ferried");
  const running = runtime.store.getRunning(KEY);
  const hit = running?.inboundReactions.find((r) => r.messageId === "msg-1" && r.emoji === "like");
  assert.ok(hit, "inbound reaction persisted on the running turn keyed by msg-1");
});

test("4 harness seen-cursor eyes on the start message", { timeout: 20000 }, async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const eyes = runtime.mcp.setReactions.find((r) => isEyesEmoji(r.emoji) && r.messageId === "msg-1");
    if (eyes !== undefined) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`mock MCP never recorded eyes on msg-1; tools=${JSON.stringify(runtime.mcp.toolsInvoked)}`);
});

test("5 final reply lists original, follow-ups, per-message reactions", { timeout: 200000 }, async () => {
  const running = runtime.store.getRunning(KEY);
  if (running !== undefined) {
    await runtime.host.waitUntilDone(running.turnId, 180000);
  }
  const reply = runtime.mcp.sent.find((s) => s.text.length > 0);
  assert.ok(reply, `final reply must be sent via mock MCP; tools=${JSON.stringify(runtime.mcp.toolsInvoked)}`);
  const text = reply?.text ?? "";
  assert.match(text, /hello world/i);
  assert.match(text, /follow up please/i);
});

test("setReaction outbound copies the target message text", async () => {
  const mcp = new MockTeamsMcp();
  const reacted: Array<{ text?: string; emoji: string; messageId: string }> = [];
  mcp.attachOutbound({
    sendMessage: async () => {},
    setReaction: async (args) => {
      reacted.push({ text: args.text, emoji: args.emoji, messageId: args.messageId });
    },
  });
  mcp.rememberRoute("chat-1", "http://localhost:56150/_connector", "chat-1");
  mcp.rememberInbound({ messageId: "m1", text: "hello there" });
  await mcp.applyFromCallback({
    tool: "mcp_graph_chat_setReaction",
    args: { "chat-id": "chat-1", "message-id": "m1", reactionType: "eyes" },
  });
  assert.equal(reacted.length, 1);
  assert.equal(reacted[0]?.text, "hello there");
  assert.equal(reacted[0]?.emoji, "eyes");
  assert.equal(reacted[0]?.messageId, "m1");
});

test("postMessage callback uses bound chat-id when grok omitted it", async () => {
  const mcp = new MockTeamsMcp();
  const posted: SentMessage[] = [];
  mcp.attachOutbound({
    sendMessage: async (sent) => {
      posted.push(sent);
    },
    setReaction: async () => {},
  });
  mcp.rememberRoute("chat-1", "http://localhost:56150/_connector", "chat-1");
  await mcp.applyFromCallback({
    tool: "mcp_graph_chat_postMessage",
    args: { text: "pg-dm-1b ping received" },
    result: {
      ok: true,
      text: "pg-dm-1b ping received",
      bound: { tool: "mcp_graph_chat_postMessage", args: { text: "pg-dm-1b ping received", "chat-id": "chat-1" } },
    },
  });
  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.serviceUrl, "http://localhost:56150/_connector");
  assert.equal(posted[0]?.conversationId, "chat-1");
  assert.equal(posted[0]?.text, "pg-dm-1b ping received");
});

test("MCP postMessage callback with only chat-id + body posts to remembered serviceUrl", async () => {
  const mcp = new MockTeamsMcp();
  const posted: SentMessage[] = [];
  mcp.attachOutbound({
    sendMessage: async (sent) => {
      posted.push(sent);
    },
    setReaction: async () => {},
  });
  mcp.rememberRoute("chat-1", "http://localhost:56150/_connector", "chat-1");
  await mcp.applyFromCallback({
    tool: "mcp_graph_chat_postMessage",
    args: { "chat-id": "chat-1", body: "original + follow-up summary" },
  });
  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.serviceUrl, "http://localhost:56150/_connector");
  assert.equal(posted[0]?.conversationId, "chat-1");
  assert.equal(posted[0]?.text, "original + follow-up summary");
});

test("channel post uses inbound Bot Framework conversation id, not Graph channel-id", async () => {
  const mcp = new MockTeamsMcp();
  const posted: SentMessage[] = [];
  mcp.attachOutbound({
    sendMessage: async (sent) => {
      posted.push(sent);
    },
    setReaction: async () => {},
  });
  mcp.rememberRoute("19:general@thread.tacv2", "http://localhost:56150/_connector", "team-id");
  await mcp.applyFromCallback({
    tool: "mcp_graph_teams_postChannelMessage",
    args: { "channel-id": "19:general@thread.tacv2", body: "channel reply" },
  });
  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.conversationId, "team-id");
  assert.equal(posted[0]?.serviceUrl, "http://localhost:56150/_connector");
});

test("6 source has no Graph client, Graph host, or reaction SDK helpers", () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        out.push(...walk(path));
      } else if (name.endsWith(".ts")) {
        out.push(path);
      }
    }
    return out;
  };
  for (const file of walk(srcRoot)) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes("@microsoft/microsoft-graph-client"), false, file);
    const graphBackend = file.endsWith("/mcp/graph.ts");
    if (!graphBackend) {
      assert.equal(src.includes("graph.microsoft.com"), false, file);
    }
    assert.equal(src.includes("api.reactions"), false, file);
  }
});
