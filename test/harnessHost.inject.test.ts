import assert from "node:assert/strict";
import { test } from "node:test";
import { watchInject } from "../src/harnessHost.js";
import { drainPrompt, followupPrompt, startPrompt } from "../src/grok/prompt.js";
import { brandConversationKey, brandMessageId, type InboundMessage } from "../src/types.js";

function sampleMessage(): InboundMessage {
  return {
    kind: "message",
    messageId: brandMessageId("m1"),
    text: "star this",
    conversationKey: brandConversationKey("c1"),
    conversationId: "c1",
    serviceUrl: "",
    fromId: "u1",
    conversationType: "personal",
    surface: { kind: "dm", chatId: "c1" },
  };
}

function collectUnhandled(): { reasons: unknown[]; stop: () => void } {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  return {
    reasons,
    stop: () => {
      process.off("unhandledRejection", onUnhandled);
    },
  };
}

test("inject rejection is handled (no unhandledRejection)", async () => {
  const { reasons, stop } = collectUnhandled();
  try {
    const injectWaits = new Map<string, Promise<unknown>[]>();
    const pending = new Promise<unknown>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("session/prompt timed out"));
      }, 15);
    });
    const watched = watchInject(pending);
    const waits = injectWaits.get("t1") ?? [];
    waits.push(watched);
    injectWaits.set("t1", waits);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });
    assert.equal(reasons.length, 0, `unhandledRejection: ${String(reasons[0])}`);
    const settled = await Promise.allSettled(waits);
    assert.equal(settled[0]?.status, "fulfilled");
    assert.equal(await watched, undefined);
  } finally {
    stop();
  }
});

test("watchInject keeps a later allSettled from seeing a rejected inject", async () => {
  const { reasons, stop } = collectUnhandled();
  try {
    const watched = watchInject(Promise.reject(new Error("session/prompt timed out")));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(reasons.length, 0);
    const settled = await Promise.allSettled([watched]);
    assert.equal(settled[0]?.status, "fulfilled");
  } finally {
    stop();
  }
});

test("start followup and drain prompts forbid fs/read_text_file and .cursor/skills", () => {
  const start = startPrompt(sampleMessage());
  const follow = followupPrompt(sampleMessage());
  const drain = drainPrompt();
  for (const text of [start, follow, drain]) {
    assert.match(text, /fs\/read_text_file/);
    assert.match(text, /\.cursor\/skills/);
    assert.match(text, /non-MCP exploration/);
    assert.match(text, /Do not call search_tool/);
    assert.match(text, /Do not spawn subagents/);
    assert.match(text, /Do not run a shell/);
  }
});
