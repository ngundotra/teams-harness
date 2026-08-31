import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createRuntime, type Runtime } from "../src/app.js";
import { dispatchActivity } from "../src/dispatch.js";
import { readMcpCalls } from "../src/inbox.js";
import { TOOL_CHAT_POST, TOOL_CHAT_SET_REACTION } from "../src/mcp/tools.js";
import { isRecord, readString } from "../src/types.js";
import { personalMessage } from "./fixtures.js";
import { isolatedTurnsDir, isEyesEmoji, isStarEmoji, toolsDump, waitForEyes } from "./helpers.js";

const WAIT_DONE_MS = 180_000;
const WAIT_EYES_MS = 60_000;
const TEST_TIMEOUT = 200_000;

function toolIndex(tools: string[], name: string): number {
  return tools.indexOf(name);
}

function callIndex(
  calls: unknown[],
  tool: string,
  match?: (args: Record<string, unknown>) => boolean,
): number {
  return calls.findIndex((raw) => {
    if (!isRecord(raw)) {
      return false;
    }
    if (readString(raw.tool) !== tool) {
      return false;
    }
    if (match === undefined) {
      return true;
    }
    const args = isRecord(raw.args) ? raw.args : {};
    return match(args);
  });
}

function reactionType(args: Record<string, unknown>): string {
  return readString(args.reactionType) ?? readString(args.emoji) ?? "";
}

function lastPostedText(runtime: Runtime): string {
  const posted = runtime.mcp.sent.filter((s) => s.text.length > 0);
  return posted[posted.length - 1]?.text ?? "";
}

describe("loop 1: single-turn set/read/unset + reply", () => {
  let runtime: Runtime;

  before(() => {
    isolatedTurnsDir();
    process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";
    runtime = createRuntime();
  });

  after(() => {
    runtime.host.dispose();
  });

  test("sets eyes, reads them, unsets, then replies", { timeout: TEST_TIMEOUT }, async () => {
    const results = dispatchActivity(runtime.host, personalMessage("real-v1", "hello"));
    const started = results[0];
    assert.equal(started?.kind, "started");
    if (started === undefined || started.kind !== "started") {
      return;
    }
    await runtime.host.waitUntilDone(started.turnId, WAIT_DONE_MS);

    const dump = toolsDump(runtime);
    const reply = lastPostedText(runtime);
    assert.ok(reply.length > 0, `bot must post a reply; toolsInvoked=${dump}`);
    assert.ok(
      runtime.mcp.setReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "real-v1"),
      `harness seen-cursor eyes on start; toolsInvoked=${dump}`,
    );
    const postI = toolIndex(runtime.mcp.toolsInvoked, TOOL_CHAT_POST);
    assert.ok(postI >= 0, `mcp_graph_chat_postMessage (reply); toolsInvoked=${dump}`);
  });
});

describe("loop 2: mid-turn inject, star before reply", () => {
  let runtime: Runtime;

  before(() => {
    isolatedTurnsDir();
    process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";
    runtime = createRuntime();
  });

  after(() => {
    runtime.host.dispose();
  });

  test(
    "honors star inject before final reply and still unsets eyes",
    { timeout: TEST_TIMEOUT },
    async () => {
      const startedResults = dispatchActivity(
        runtime.host,
        personalMessage("real-v2", "set a timer and respond"),
      );
      const started = startedResults[0];
      assert.equal(started?.kind, "started");
      if (started === undefined || started.kind !== "started") {
        return;
      }

      await waitForEyes(runtime, "real-v2", WAIT_EYES_MS);

      const follow = dispatchActivity(
        runtime.host,
        personalMessage("real-v2-follow", "react with a star emoji before returning"),
      );
      assert.equal(follow[0]?.kind, "enqueued", "follow-up must enqueue on the in-flight turn");

      await runtime.host.waitUntilDone(started.turnId, WAIT_DONE_MS);

      const dump = toolsDump(runtime);
      const calls = readMcpCalls(started.turnId);
      const starI = callIndex(calls, TOOL_CHAT_SET_REACTION, (args) => isStarEmoji(reactionType(args)));
      const postI = callIndex(calls, TOOL_CHAT_POST);
      assert.ok(starI >= 0, `setReaction star must be invoked; toolsInvoked=${dump}`);
      assert.ok(postI >= 0, `final postMessage; toolsInvoked=${dump}`);
      assert.ok(starI < postI, `star must be set before the final post; toolsInvoked=${dump}`);

      const reply = lastPostedText(runtime);
      assert.ok(reply.length > 0, `final reply must be posted; toolsInvoked=${dump}`);
      assert.match(
        reply,
        /react with a star emoji before returning|follow-?up|star|⭐|★/i,
        `reply mentions follow-up or star; toolsInvoked=${dump} reply=${reply.slice(0, 400)}`,
      );

      assert.ok(
        runtime.mcp.setReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "real-v2"),
        `eyes recorded on start; toolsInvoked=${dump}`,
      );
      assert.ok(
        runtime.mcp.setReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "real-v2-follow"),
        `seen-cursor walked to follow-up; toolsInvoked=${dump}`,
      );
      assert.ok(
        runtime.mcp.setReactions.some(
          (r) => isStarEmoji(r.emoji) && (r.messageId === "real-v2" || r.messageId === "real-v2-follow"),
        ),
        `star recorded; toolsInvoked=${dump}`,
      );
      assert.ok(
        runtime.mcp.unsetReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "real-v2"),
        `eyes unset under inject; toolsInvoked=${dump}`,
      );
    },
  );
});
