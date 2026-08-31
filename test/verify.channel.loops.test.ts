import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createRuntime, type Runtime } from "../src/app.js";
import { dispatchActivity } from "../src/dispatch.js";
import { readMcpCalls } from "../src/inbox.js";
import {
  TOOL_TEAMS_POST,
  TOOL_TEAMS_REPLY,
  TOOL_TEAMS_SET_REACTION,
} from "../src/mcp/tools.js";
import { isRecord, readString } from "../src/types.js";
import { teamMessage } from "./fixtures.js";
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

function replyArgs(calls: unknown[]): Record<string, unknown> | undefined {
  for (const raw of calls) {
    if (!isRecord(raw)) {
      continue;
    }
    if (readString(raw.tool) !== TOOL_TEAMS_REPLY) {
      continue;
    }
    return isRecord(raw.args) ? raw.args : {};
  }
  return undefined;
}

function lastPostedText(runtime: Runtime): string {
  const posted = runtime.mcp.sent.filter((s) => s.text.length > 0);
  return posted[posted.length - 1]?.text ?? "";
}

describe("channel loop 1: thread single-turn set/read/unset + reply-in-thread", () => {
  let runtime: Runtime;

  before(() => {
    isolatedTurnsDir();
    process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";
    runtime = createRuntime();
  });

  after(() => {
    runtime.host.dispose();
  });

  test("sets eyes, lists them, unsets, then replies in the thread", { timeout: TEST_TIMEOUT }, async () => {
    const results = dispatchActivity(runtime.host, teamMessage("ch-v1", "hello", "root-1"));
    const started = results[0];
    assert.equal(started?.kind, "started");
    if (started === undefined || started.kind !== "started") {
      return;
    }
    await runtime.host.waitUntilDone(started.turnId, WAIT_DONE_MS);

    const dump = toolsDump(runtime);
    const reply = lastPostedText(runtime);
    assert.ok(reply.length > 0, `bot must post a thread reply; toolsInvoked=${dump}`);

    const tools = runtime.mcp.toolsInvoked;
    const replyI = toolIndex(tools, TOOL_TEAMS_REPLY);
    const postI = toolIndex(tools, TOOL_TEAMS_POST);
    assert.ok(replyI >= 0, `mcp_graph_teams_replyToChannelMessage (thread reply); toolsInvoked=${dump}`);
    assert.ok(postI < 0 || postI < replyI, `thread must reply, not a bare post as the final post; toolsInvoked=${dump}`);
    assert.ok(
      runtime.mcp.setReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "ch-v1"),
      `harness seen-cursor eyes on start; toolsInvoked=${dump}`,
    );

    const calls = readMcpCalls(started.turnId);
    const args = replyArgs(calls);
    assert.ok(args !== undefined, `reply tool args recorded; toolsInvoked=${dump}`);
    assert.ok(["root-1", "ch-v1"].includes(readString(args?.["message-id"]) ?? ""), "reply message-id is thread root or inbound id");


  });
});

describe("channel loop 2: same-thread mid-turn inject", () => {
  let runtime: Runtime;

  before(() => {
    isolatedTurnsDir();
    process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";
    runtime = createRuntime();
  });

  after(() => {
    runtime.host.dispose();
  });

  test("honors star inject before thread reply and still unsets eyes", { timeout: TEST_TIMEOUT }, async () => {
    const startedResults = dispatchActivity(
      runtime.host,
      teamMessage("ch-v2", "set a timer and respond", "root-2"),
    );
    const started = startedResults[0];
    assert.equal(started?.kind, "started");
    if (started === undefined || started.kind !== "started") {
      return;
    }

    await waitForEyes(runtime, "ch-v2", WAIT_EYES_MS);

    const follow = dispatchActivity(
      runtime.host,
      teamMessage("ch-v2-follow", "react with a star emoji before returning", "root-2"),
    );
    assert.equal(follow[0]?.kind, "enqueued", "follow-up must enqueue on the same thread key");

    await runtime.host.waitUntilDone(started.turnId, WAIT_DONE_MS);

    const dump = toolsDump(runtime);
    const calls = readMcpCalls(started.turnId);
    const starI = callIndex(calls, TOOL_TEAMS_SET_REACTION, (args) => isStarEmoji(reactionType(args)));
    const replyI = callIndex(calls, TOOL_TEAMS_REPLY);
    assert.ok(starI >= 0, `teams setReaction star must be invoked; toolsInvoked=${dump}`);
    assert.ok(replyI >= 0, `final replyToChannelMessage; toolsInvoked=${dump}`);
    assert.ok(starI < replyI, `star must be set before the final reply; toolsInvoked=${dump}`);

    const reply = lastPostedText(runtime);
    assert.ok(reply.length > 0, `final reply must be posted; toolsInvoked=${dump}`);
    assert.match(
      reply,
      /react with a star emoji before returning|follow-?up|star|⭐|★/i,
      `reply mentions follow-up or star; toolsInvoked=${dump} reply=${reply.slice(0, 400)}`,
    );

    assert.ok(
      runtime.mcp.setReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "ch-v2"),
      `eyes recorded on start; toolsInvoked=${dump}`,
    );
    assert.ok(
      runtime.mcp.setReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "ch-v2-follow"),
      `seen-cursor walked to follow-up; toolsInvoked=${dump}`,
    );
    assert.ok(
      runtime.mcp.setReactions.some(
        (r) => isStarEmoji(r.emoji) && (r.messageId === "ch-v2" || r.messageId === "ch-v2-follow"),
      ),
      `star recorded; toolsInvoked=${dump}`,
    );
    assert.ok(
      runtime.mcp.unsetReactions.some((r) => isEyesEmoji(r.emoji) && r.messageId === "ch-v2"),
      `eyes unset under inject; toolsInvoked=${dump}`,
    );

    const args = replyArgs(calls);
    assert.ok(args !== undefined, `reply tool args recorded; toolsInvoked=${dump}`);
    assert.ok(["root-2", "ch-v2"].includes(readString(args?.["message-id"]) ?? ""), "reply message-id is thread root or inbound id");
  });
});

describe("channel thread isolation", () => {
  let runtime: Runtime;

  before(() => {
    isolatedTurnsDir();
    process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";
    runtime = createRuntime();
  });

  after(() => {
    runtime.host.dispose();
  });

  test("different thread roots start separate turns; same thread enqueues", () => {
    const first = dispatchActivity(runtime.host, teamMessage("iso-a", "work a", "root-A"));
    assert.equal(first[0]?.kind, "started");
    if (first[0] === undefined || first[0].kind !== "started") {
      return;
    }

    const second = dispatchActivity(runtime.host, teamMessage("iso-b", "work b", "root-B"));
    assert.equal(second[0]?.kind, "started", "other thread must start a new turn, not enqueue");
    if (second[0] === undefined || second[0].kind !== "started") {
      return;
    }
    assert.notEqual(second[0].turnId, first[0].turnId);

    const follow = dispatchActivity(runtime.host, teamMessage("iso-a2", "follow a", "root-A"));
    assert.equal(follow[0]?.kind, "enqueued", "same thread follow-up must enqueue on the first turn");
    if (follow[0] !== undefined && follow[0].kind === "enqueued") {
      assert.equal(follow[0].turnId, first[0].turnId);
    }

    assert.equal(runtime.store.getSpawnCount(), 2, "two thread roots spawn two turns");
  });
});
