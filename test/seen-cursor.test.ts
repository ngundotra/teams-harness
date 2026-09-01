import assert from "node:assert/strict";
import { before, test } from "node:test";
import { appendInbox, readMcpCalls } from "../src/inbox.js";
import { executeTool } from "../src/mcp/runtime.js";
import {
  TOOL_CHAT_SET_REACTION,
  TOOL_CHAT_UNSET_REACTION,
  TOOL_DRAIN_INBOX,
} from "../src/mcp/tools.js";
import { MockTeamsMcp, threadReplyToId } from "../src/mockMcp.js";
import { reactionCopyText, readSeenMessageId, seenWalk, writeSeenMessageId } from "../src/seenCursor.js";
import {
  type InboundMessage,
  brandConversationKey,
  brandMessageId,
  brandTurnId,
  isRecord,
  readString,
} from "../src/types.js";
import { isolatedTurnsDir } from "./helpers.js";

function followup(id: string, text: string): InboundMessage {
  return {
    kind: "message",
    messageId: brandMessageId(id),
    text,
    conversationKey: brandConversationKey("a:personal-1"),
    conversationId: "a:personal-1",
    serviceUrl: "http://127.0.0.1:9",
    fromId: "user-1",
    conversationType: "personal",
    surface: { kind: "dm", chatId: "a:personal-1" },
  };
}

before(() => {
  isolatedTurnsDir();
});

test("seenWalk moves forward and skips already-seen items in the batch", () => {
  assert.deepEqual(seenWalk(undefined, ["a", "b"]), [{ set: "a" }, { unset: "a", set: "b" }]);
  assert.deepEqual(seenWalk("start", ["a", "b"]), [
    { unset: "start", set: "a" },
    { unset: "a", set: "b" },
  ]);
  assert.deepEqual(seenWalk("a", ["a", "b"]), [{ unset: "a", set: "b" }]);
  assert.deepEqual(seenWalk("b", ["a", "b"]), []);
  assert.deepEqual(seenWalk("a", ["a"]), []);
});

test("reactionCopyText prefixes the target copy with the emoji", () => {
  assert.equal(reactionCopyText({ emoji: "eyes", text: "hello there" }), "👀 hello there");
  assert.equal(reactionCopyText({ emoji: "star", text: "star this" }), "⭐ star this");
  assert.equal(reactionCopyText({ emoji: "eyes" }), "👀");
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

test("setReaction outbound accepts grok camelCase messageId and reaction", async () => {
  const mcp = new MockTeamsMcp();
  const reacted: Array<{ text?: string; emoji: string }> = [];
  mcp.attachOutbound({
    sendMessage: async () => {},
    setReaction: async (args) => {
      reacted.push({ text: args.text, emoji: args.emoji });
    },
  });
  mcp.rememberRoute("chat-1", "http://localhost:56150/_connector", "chat-1");
  mcp.rememberInbound({ messageId: "m2", text: "pg-dm-3 star this", conversationId: "chat-1" });
  await mcp.applyFromCallback({
    tool: "mcp_graph_chat_setReaction",
    args: { messageId: "m2", reaction: "star" },
  });
  assert.equal(reacted.length, 1);
  assert.equal(reacted[0]?.emoji, "star");
  assert.equal(reacted[0]?.text, "pg-dm-3 star this");
});

test("drain walks eyes onto each new follow-up and unsets the previous", async () => {
  const turnId = brandTurnId("seen-drain-1");
  writeSeenMessageId(turnId, "start");
  appendInbox(turnId, { kind: "followup", message: followup("f1", "one") });
  appendInbox(turnId, { kind: "followup", message: followup("f2", "two") });
  await executeTool(turnId, TOOL_DRAIN_INBOX, {}, "read");
  assert.equal(readSeenMessageId(turnId), "f2");
  const tools = readMcpCalls(turnId)
    .map((raw) => (isRecord(raw) ? readString(raw.tool) : undefined))
    .filter((name): name is string => name !== undefined);
  assert.ok(tools.includes(TOOL_DRAIN_INBOX));
  assert.ok(tools.includes(TOOL_CHAT_UNSET_REACTION));
  assert.ok(tools.includes(TOOL_CHAT_SET_REACTION));
  const setIds = readMcpCalls(turnId)
    .filter((raw) => isRecord(raw) && readString(raw.tool) === TOOL_CHAT_SET_REACTION)
    .map((raw) => (isRecord(raw) && isRecord(raw.args) ? readString(raw.args["message-id"]) : undefined));
  assert.deepEqual(setIds, ["f1", "f2"]);
});

test("drain does not rewind eyes when the batch was already seen", async () => {
  const turnId = brandTurnId("seen-drain-2");
  appendInbox(turnId, { kind: "followup", message: followup("x1", "one") });
  appendInbox(turnId, { kind: "followup", message: followup("x2", "two") });
  writeSeenMessageId(turnId, "x2");
  await executeTool(turnId, TOOL_DRAIN_INBOX, {}, "read");
  assert.equal(readSeenMessageId(turnId), "x2");
  const setIds = readMcpCalls(turnId)
    .filter((raw) => isRecord(raw) && readString(raw.tool) === TOOL_CHAT_SET_REACTION)
    .map((raw) => (isRecord(raw) && isRecord(raw.args) ? readString(raw.args["message-id"]) : undefined));
  assert.deepEqual(setIds, []);
});

import { extractPostText } from "../src/mcp/runtime.js";

test("extractPostText accepts text when body is missing", () => {
  assert.equal(extractPostText({ body: "from-body" }), "from-body");
  assert.equal(extractPostText({ text: "from-text" }), "from-text");
  assert.equal(extractPostText({ body: "from-body", text: "from-text" }), "from-body");
  assert.equal(extractPostText({ content: "from-content" }), "from-content");
  assert.equal(extractPostText({}), "");
});

test("same post text still delivers to a second conversation", async () => {
  const mcp = new MockTeamsMcp();
  const sent: string[] = [];
  mcp.attachOutbound({
    sendMessage: async (msg) => {
      sent.push(`${msg.conversationId}:${msg.text}`);
    },
    setReaction: async () => {},
  });
  mcp.rememberRoute("chat-a", "http://localhost:56150/_connector", "chat-a");
  mcp.rememberRoute("chat-b", "http://localhost:56150/_connector", "chat-b");
  await mcp.applyFromCallback({
    tool: "mcp_graph_chat_postMessage",
    args: { "chat-id": "chat-a", text: "same body" },
  });
  await mcp.applyFromCallback({
    tool: "mcp_graph_chat_postMessage",
    args: { "chat-id": "chat-b", text: "same body" },
  });
  assert.deepEqual(sent, ["chat-a:same body", "chat-b:same body"]);
});

test("poll hydrate then callback still delivers the post", async () => {
  const mcp = new MockTeamsMcp();
  const sent: string[] = [];
  mcp.attachOutbound({
    sendMessage: async (msg) => {
      sent.push(msg.text);
    },
    setReaction: async () => {},
  });
  mcp.rememberRoute("team-id", "http://localhost:56150/_connector", "team-id;messageid=42");
  const call = {
    tool: "mcp_graph_teams_postChannelMessage",
    args: { "team-id": "team-id", "channel-id": "team-id", text: "original text: pg-ch-1e ping" },
  };
  mcp.hydrateFromCalls([call]);
  await mcp.applyFromCallback(call);
  assert.deepEqual(sent, ["original text: pg-ch-1e ping"]);
  assert.equal(mcp.sent[0]?.replyToId, "42");
});

test("threadReplyToId reads playground messageid suffix", () => {
  assert.equal(threadReplyToId("team-id;messageid=1788137303458"), "1788137303458");
  assert.equal(threadReplyToId("90a446ed-97f6-4708-bee1-29f8bb6a24c7"), undefined);
});
