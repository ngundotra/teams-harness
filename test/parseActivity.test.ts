import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseActivity, parseReactionAll } from "../src/parseActivity.js";
import { teamMessage } from "./fixtures.js";
import { messageActivity, reactionActivity } from "./helpers.js";

describe("parseActivity", () => {
  it("parses a message activity", () => {
    const parsed = parseActivity(messageActivity({ id: "m1", text: "hello" }));
    assert.equal(parsed.kind, "ok");
    if (parsed.kind !== "ok") {
      return;
    }
    assert.equal(parsed.event.kind, "message");
    if (parsed.event.kind !== "message") {
      return;
    }
    assert.equal(parsed.event.messageId, "m1");
    assert.equal(parsed.event.text, "hello");
  });

  it("keys messageReaction by replyToId", () => {
    const parsed = parseActivity(reactionActivity({ replyToId: "target-9", emoji: "like" }));
    assert.equal(parsed.kind, "ok");
    if (parsed.kind !== "ok" || parsed.event.kind !== "reaction") {
      return;
    }
    assert.equal(parsed.event.messageId, "target-9");
    assert.equal(parsed.event.action, "add");
    assert.equal(parsed.event.emoji, "like");
  });

  it("returns all added and removed reactions", () => {
    const all = parseReactionAll({
      type: "messageReaction",
      replyToId: "m1",
      conversation: { id: "c1" },
      from: { id: "u" },
      reactionsAdded: [{ type: "like" }],
      reactionsRemoved: [{ type: "heart" }],
    });
    assert.equal(all.length, 2);
    assert.equal(all[0]?.action, "add");
    assert.equal(all[1]?.action, "remove");
  });

  it("keys a new channel root as its own thread surface", () => {
    const parsed = parseActivity(teamMessage("root-9", "hello channel"));
    assert.equal(parsed.kind, "ok");
    if (parsed.kind !== "ok" || parsed.event.kind !== "message") {
      return;
    }
    assert.equal(parsed.event.surface.kind, "thread");
    if (parsed.event.surface.kind !== "thread") {
      return;
    }
    assert.equal(parsed.event.surface.threadId, "root-9");
    assert.equal(parsed.event.conversationKey, "19:channel-1@thread.tacv2;messageid=root-9");
  });

  it("ignores conversationUpdate", () => {
    const parsed = parseActivity({ type: "conversationUpdate", conversation: { id: "c" } });
    assert.equal(parsed.kind, "ok");
    if (parsed.kind !== "ok") {
      return;
    }
    assert.equal(parsed.event.kind, "ignored");
  });

  it("personal activity is a dm surface", () => {
    const parsed = parseActivity(messageActivity({ id: "m1", text: "hello" }));
    assert.equal(parsed.kind, "ok");
    if (parsed.kind !== "ok" || parsed.event.kind !== "message") {
      return;
    }
    assert.deepEqual(parsed.event.surface, { kind: "dm", chatId: "conv-1" });
    assert.equal(parsed.event.conversationKey, "conv-1");
  });
});
