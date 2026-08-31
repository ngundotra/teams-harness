import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRuntime, type Runtime } from "../src/app.js";
import { ChannelWatcher } from "../src/channelWatch.js";
import {
  resetChannelList,
  seedChannelList,
  type GraphChatMessage,
} from "../src/mcp/runtime.js";
import { brandConversationKey } from "../src/types.js";
import { isolatedTurnsDir } from "./helpers.js";

const TEAM_ID = "19:team-1@thread.tacv2";
const CHANNEL_ID = "19:channel-1@thread.tacv2";
const BOT_ID = "28:bot-1";
const USER_ID = "29:user-1";

function graphMsg(over: {
  id: string;
  text: string;
  fromId?: string;
  replyToId?: string;
  createdDateTime?: string;
}): GraphChatMessage {
  const fromId = over.fromId ?? USER_ID;
  const message: GraphChatMessage = {
    id: over.id,
    body: { content: over.text, contentType: "text" },
    from: { id: fromId, user: { id: fromId } },
    createdDateTime: over.createdDateTime ?? "2026-08-30T14:00:00.000Z",
    teamId: TEAM_ID,
    channelId: CHANNEL_ID,
  };
  if (over.replyToId !== undefined) {
    message.replyToId = over.replyToId;
  }
  return message;
}

isolatedTurnsDir();
process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";

let runtime: Runtime;
let watcher: ChannelWatcher;

before(() => {
  resetChannelList();
  runtime = createRuntime();
  watcher = new ChannelWatcher({
    host: runtime.host,
    teamId: TEAM_ID,
    channelId: CHANNEL_ID,
    botId: BOT_ID,
  });
});

after(() => {
  watcher.stop();
  runtime.host.dispose();
  resetChannelList();
});

test("channel root from MCP list starts a turn", async () => {
  seedChannelList([graphMsg({ id: "cw-root-a", text: "channel ping", createdDateTime: "2026-08-30T14:00:01.000Z" })]);
  const results = await watcher.tick();
  assert.equal(results[0]?.kind, "started");
  assert.equal(runtime.store.getSpawnCount(), 1);
  const key = brandConversationKey(`${CHANNEL_ID};messageid=cw-root-a`);
  const running = runtime.store.getRunning(key);
  assert.ok(running);
  assert.equal(running?.startMessage.text, "channel ping");
});

test("same-thread reply enqueues on the running turn", async () => {
  const before = runtime.store.getSpawnCount();
  seedChannelList([
    graphMsg({
      id: "cw-reply-a",
      text: "and this follow-up",
      replyToId: "cw-root-a",
      createdDateTime: "2026-08-30T14:00:02.000Z",
    }),
  ]);
  const results = await watcher.tick();
  assert.equal(results[0]?.kind, "enqueued");
  assert.equal(runtime.store.getSpawnCount(), before);
  const key = brandConversationKey(`${CHANNEL_ID};messageid=cw-root-a`);
  const running = runtime.store.getRunning(key);
  assert.equal(running?.followups.length, 1);
  assert.equal(running?.followups[0]?.text, "and this follow-up");
});

test("other thread root starts a new turn", async () => {
  const before = runtime.store.getSpawnCount();
  seedChannelList([
    graphMsg({ id: "cw-root-b", text: "other thread", createdDateTime: "2026-08-30T14:00:03.000Z" }),
  ]);
  const results = await watcher.tick();
  assert.equal(results[0]?.kind, "started");
  assert.equal(runtime.store.getSpawnCount(), before + 1);
  const key = brandConversationKey(`${CHANNEL_ID};messageid=cw-root-b`);
  assert.ok(runtime.store.getRunning(key));
});

test("second tick with same ids does not spawn", async () => {
  const before = runtime.store.getSpawnCount();
  const results = await watcher.tick();
  assert.equal(results.length, 0);
  assert.equal(runtime.store.getSpawnCount(), before);
});

test("bot-authored message is skipped", async () => {
  const before = runtime.store.getSpawnCount();
  seedChannelList([
    graphMsg({
      id: "cw-bot-post",
      text: "Working on it…",
      fromId: BOT_ID,
      createdDateTime: "2026-08-30T14:00:04.000Z",
    }),
  ]);
  const results = await watcher.tick();
  assert.equal(results.length, 0);
  assert.equal(runtime.store.getSpawnCount(), before);
});
