import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createHttpServer, createRuntime, listen, type Runtime } from "../src/app.js";
import { brandConversationKey, isRecord, readString } from "../src/types.js";
import {
  groupMessage,
  installationUpdate,
  membersAdded,
  messageReactionAdded,
  personalMessage,
  teamMessage,
} from "./fixtures.js";
import { isEyesEmoji } from "./helpers.js";

process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";
process.env.TURNS_DIR = mkdtempSync(join(tmpdir(), "turns-http-"));

const KEY = brandConversationKey("a:personal-1");
let runtime: Runtime;
let server: Server;
let base = "";

before(async () => {
  runtime = createRuntime();
  server = createHttpServer(runtime);
  const port = await listen(server, 0);
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  runtime.host.dispose();
  server.close();
});

function firstResultKind(json: Record<string, unknown>): string {
  const results = json.results;
  if (!Array.isArray(results)) {
    return "";
  }
  const first: unknown = results[0];
  if (!isRecord(first)) {
    return "";
  }
  return readString(first.kind) ?? "";
}

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown>; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await res.json();
  const ms = Date.now() - t0;
  if (!isRecord(parsed)) {
    return { status: res.status, json: {}, ms };
  }
  return { status: res.status, json: parsed, ms };
}

test("http 1: first message immediate ack, turn running, harness spawned", async () => {
  const { status, json, ms } = await post(personalMessage("http-msg-1", "ping"));
  assert.equal(status, 200);
  assert.ok(ms < 500, `HTTP ack must return before the job, took ${ms}ms`);
  assert.equal(json.ack, "Working on it…");
  assert.equal(json.harnessSpawns, 1);
  assert.equal(json.runningTurns, 1);
  assert.equal(firstResultKind(json), "started");
});

test("http 2: follow-up during job enqueues, no second harness", async () => {
  const { status, json } = await post(personalMessage("http-msg-2", "and also this"));
  assert.equal(status, 200);
  assert.equal(json.harnessSpawns, 1);
  assert.equal(json.runningTurns, 1);
  assert.equal(firstResultKind(json), "enqueued");
});

test("http 3: reaction activity ferries to harness keyed by target message id", async () => {
  const { status, json } = await post(messageReactionAdded("http-msg-1", "like"));
  assert.equal(status, 200);
  assert.equal(firstResultKind(json), "ferried");
  const running = runtime.store.getRunning(KEY);
  assert.ok(running);
  const hit = running?.inboundReactions.find(
    (r) => r.messageId === "http-msg-1" && r.emoji === "like",
  );
  assert.ok(hit, "turn must persist inbound reaction keyed by http-msg-1");
});

test("http 4: harness react call recorded on mock MCP", { timeout: 200000 }, async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const eyes = runtime.mcp.setReactions.find(
      (r) => r.messageId === "http-msg-1" && isEyesEmoji(r.emoji),
    );
    if (eyes !== undefined) {
      assert.ok(
        runtime.mcp.toolsInvoked.some((n) => n === "mcp_graph_chat_setReaction" || n === "mcp_graph_teams_setReaction"),
        `setReaction must be recorded under a Work IQ MCP name; tools=${JSON.stringify(runtime.mcp.toolsInvoked)}`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`case 4: mock MCP did not record eyes on http-msg-1; tools=${JSON.stringify(runtime.mcp.toolsInvoked)}`);
});

test("http 5: final reply includes follow-ups and per-message reactions", { timeout: 200000 }, async () => {
  const running = runtime.store.getRunning(KEY);
  if (running !== undefined) {
    await runtime.host.waitUntilDone(running.turnId, 180000);
  }
  const reply = runtime.mcp.sent.find((s) => s.text.length > 0);
  assert.ok(reply, `case 5: final reply sent; tools=${JSON.stringify(runtime.mcp.toolsInvoked)}`);
  const text = reply?.text ?? "";
  assert.match(text, /ping/i);
  assert.match(text, /and also this/i);
});

test("reaction with no running turn is dropped", async () => {
  const { json } = await post(
    messageReactionAdded("ghost", "like", {
      id: "a:empty-conv",
      conversationType: "personal",
    }),
  );
  assert.equal(firstResultKind(json), "dropped");
});

test("personal / group / team scopes plus install, members added, thread reply", async () => {
  const install = await post(installationUpdate());
  assert.equal(install.status, 200);
  assert.equal(firstResultKind(install.json), "ignored");
  const members = await post(membersAdded());
  assert.equal(members.status, 200);
  assert.equal(firstResultKind(members.json), "ignored");
  const group = await post(groupMessage("g1", "group hi"));
  assert.equal(firstResultKind(group.json), "started");
  const team = await post(teamMessage("t1", "team hi"));
  assert.equal(firstResultKind(team.json), "started");
  const thread = await post(teamMessage("t2", "thread hi", "t1"));
  assert.equal(firstResultKind(thread.json), "enqueued");
});
