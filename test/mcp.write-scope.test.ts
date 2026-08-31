import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  applyTool,
  executeTool,
  listedChannelMessages,
  resetChannelList,
} from "../src/mcp/runtime.js";
import {
  TOOL_CHAT_POST,
  TOOL_TEAMS_POST,
  TOOL_TEAMS_REPLY,
  toolDefsForRole,
  type WriteScope,
} from "../src/mcp/tools.js";
import { brandTurnId, isRecord, readString } from "../src/types.js";
import { isolatedTurnsDir } from "./helpers.js";

const CHAT_SCOPE: WriteScope = { kind: "chat", conversationId: "bound-chat" };
const CHANNEL_SCOPE: WriteScope = {
  kind: "channel",
  teamId: "bound-team",
  channelId: "bound-channel",
  threadId: "bound-thread",
};

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), `expected object result, got ${JSON.stringify(value)}`);
  return value;
}

before(() => {
  isolatedTurnsDir();
  resetChannelList();
});

after(() => {
  resetChannelList();
});

test("toolDefsForRole write is only the three post tools; read has none", () => {
  const writeNames = toolDefsForRole("write").map((d) => d.name);
  const readNames = toolDefsForRole("read").map((d) => d.name);
  assert.deepEqual(writeNames, [TOOL_CHAT_POST, TOOL_TEAMS_POST, TOOL_TEAMS_REPLY]);
  assert.equal(writeNames.length, 3);
  assert.equal(readNames.includes(TOOL_CHAT_POST), false);
  assert.equal(readNames.includes(TOOL_TEAMS_POST), false);
  assert.equal(readNames.includes(TOOL_TEAMS_REPLY), false);
});

test("chat scope rewrites postMessage chat-id to the bound conversation", () => {
  const result = asRecord(
    applyTool(
      TOOL_CHAT_POST,
      { "chat-id": "other-chat", body: "hello-chat" },
      undefined,
      CHAT_SCOPE,
    ),
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, "hello-chat");
  assert.ok(isRecord(result.bound));
  const bound = result.bound;
  assert.equal(readString(bound.tool), TOOL_CHAT_POST);
  assert.ok(isRecord(bound.args));
  assert.equal(readString(bound.args["chat-id"]), "bound-chat");
  assert.equal(bound.args.body, "hello-chat");
});

test("chat scope refuses postChannelMessage", () => {
  const result = asRecord(
    applyTool(
      TOOL_TEAMS_POST,
      { "team-id": "t", "channel-id": "c", body: "nope" },
      undefined,
      CHAT_SCOPE,
    ),
  );
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
});

test("channel scope rewrites postChannelMessage to a reply on the bound thread", () => {
  resetChannelList();
  const result = asRecord(
    applyTool(
      TOOL_TEAMS_POST,
      { "team-id": "other-team", "channel-id": "other-channel", body: "channel-body" },
      undefined,
      CHANNEL_SCOPE,
    ),
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, "channel-body");
  assert.ok(isRecord(result.bound));
  const bound = result.bound;
  assert.equal(readString(bound.tool), TOOL_TEAMS_REPLY);
  assert.ok(isRecord(bound.args));
  assert.equal(readString(bound.args["team-id"]), "bound-team");
  assert.equal(readString(bound.args["channel-id"]), "bound-channel");
  assert.equal(readString(bound.args["message-id"]), "bound-thread");
  const stored = listedChannelMessages();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.replyToId, "bound-thread");
});

test("channel scope pins replyToChannelMessage to the bound threadId", () => {
  resetChannelList();
  const result = asRecord(
    applyTool(
      TOOL_TEAMS_REPLY,
      {
        "team-id": "other-team",
        "channel-id": "other-channel",
        "message-id": "wrong-thread",
        body: "reply-body",
      },
      undefined,
      CHANNEL_SCOPE,
    ),
  );
  assert.equal(result.ok, true);
  assert.ok(isRecord(result.bound));
  const bound = result.bound;
  assert.equal(readString(bound.tool), TOOL_TEAMS_REPLY);
  assert.ok(isRecord(bound.args));
  assert.equal(readString(bound.args["message-id"]), "bound-thread");
  assert.equal(readString(bound.args["team-id"]), "bound-team");
  assert.equal(readString(bound.args["channel-id"]), "bound-channel");
  const stored = listedChannelMessages();
  assert.equal(stored[0]?.replyToId, "bound-thread");
});

test("executeTool on read role refuses TOOL_CHAT_POST", async () => {
  const result = asRecord(
    await executeTool(
      brandTurnId("write-scope-read-refuse"),
      TOOL_CHAT_POST,
      { "chat-id": "c1", body: "should-not-post" },
      "read",
    ),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "tool not on this server");
});
