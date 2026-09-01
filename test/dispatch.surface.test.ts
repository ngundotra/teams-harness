import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime, type Runtime } from "../src/app.js";
import { dispatchActivity } from "../src/dispatch.js";
import { parseActivity } from "../src/parseActivity.js";
import {
  TOOL_TEAMS_LIST,
  TOOL_TEAMS_LIST_RECENT,
  TOOL_TEAMS_LIST_REPLIES,
  readToolNames,
  toolDefsForRead,
} from "../src/mcp/tools.js";
import { conversationKeyFromSurface } from "../src/surface.js";
import { teamMessage } from "./fixtures.js";
import { isolatedTurnsDir } from "./helpers.js";

isolatedTurnsDir();
process.env.HARNESS_JOB_MS = process.env.HARNESS_JOB_MS ?? "15000";

function parsedMessage(body: Record<string, unknown>) {
  const parsed = parseActivity(body);
  assert.equal(parsed.kind, "ok");
  if (parsed.kind !== "ok" || parsed.event.kind !== "message") {
    throw new Error("expected message");
  }
  return parsed.event;
}

test("channel root post opens a thread surface keyed by that post id", () => {
  const root = parsedMessage(teamMessage("root-post-1", "new thread"));
  assert.equal(root.surface.kind, "thread");
  if (root.surface.kind !== "thread") {
    return;
  }
  assert.equal(root.surface.threadId, "root-post-1");
  assert.equal(root.surface.teamId, "19:team-1@thread.tacv2");
  assert.equal(root.surface.channelId, "19:channel-1@thread.tacv2");
  assert.equal(root.conversationKey, conversationKeyFromSurface(root.surface));
  assert.equal(root.conversationKey, "19:channel-1@thread.tacv2;messageid=root-post-1");
});

test("reply in a thread uses the parent thread surface key", () => {
  const root = parsedMessage(teamMessage("root-post-2", "start"));
  const reply = parsedMessage(teamMessage("reply-2", "follow", "root-post-2"));
  assert.equal(root.surface.kind, "thread");
  assert.equal(reply.surface.kind, "thread");
  if (root.surface.kind !== "thread" || reply.surface.kind !== "thread") {
    return;
  }
  assert.equal(reply.surface.threadId, "root-post-2");
  assert.equal(reply.conversationKey, root.conversationKey);
});

test("two channel thread roots are two turns; a reply joins the parent", () => {
  const runtime: Runtime = createRuntime();
  try {
    const first = dispatchActivity(runtime.host, teamMessage("disp-a", "work a"));
    assert.equal(first[0]?.kind, "started");
    if (first[0] === undefined || first[0].kind !== "started") {
      return;
    }

    const second = dispatchActivity(runtime.host, teamMessage("disp-b", "work b"));
    assert.equal(second[0]?.kind, "started", "other thread root must start a new turn");
    if (second[0] === undefined || second[0].kind !== "started") {
      return;
    }
    assert.notEqual(second[0].turnId, first[0].turnId);

    const follow = dispatchActivity(runtime.host, teamMessage("disp-a2", "follow a", "disp-a"));
    assert.equal(follow[0]?.kind, "enqueued", "reply joins the parent thread turn");
    if (follow[0] !== undefined && follow[0].kind === "enqueued") {
      assert.equal(follow[0].turnId, first[0].turnId);
    }

    assert.equal(runtime.store.getSpawnCount(), 2, "two thread roots spawn two turns");
  } finally {
    runtime.host.dispose();
  }
});

test("thread-only MCP defs omit channel-wide list and the recent-threads tool", () => {
  const ctx = {
    surface: {
      kind: "thread" as const,
      teamId: "team-1",
      channelId: "channel-1",
      threadId: "thread-1",
    },
    readPolicy: { kind: "thread-only" as const },
    readRecentThreads: true,
  };
  const names = readToolNames(ctx);
  assert.equal(names.includes(TOOL_TEAMS_LIST), false);
  assert.equal(names.includes(TOOL_TEAMS_LIST_RECENT), false);
  assert.equal(names.includes(TOOL_TEAMS_LIST_REPLIES), true);
  assert.equal(
    toolDefsForRead(ctx).some((d) => d.name === TOOL_TEAMS_LIST),
    false,
  );
});

test("recent-threads tool is absent when the feature is off", () => {
  const off = readToolNames({
    surface: {
      kind: "thread",
      teamId: "team-1",
      channelId: "channel-1",
      threadId: "thread-1",
    },
    readPolicy: { kind: "surface" },
    readRecentThreads: false,
  });
  assert.equal(off.includes(TOOL_TEAMS_LIST_RECENT), false);
  assert.equal(off.includes(TOOL_TEAMS_LIST), true);

  const on = readToolNames({
    surface: {
      kind: "thread",
      teamId: "team-1",
      channelId: "channel-1",
      threadId: "thread-1",
    },
    readPolicy: { kind: "surface" },
    readRecentThreads: true,
  });
  assert.equal(on.includes(TOOL_TEAMS_LIST_RECENT), true);
});
