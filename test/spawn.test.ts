import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROK_ACP_ARGS, GROK_BIN, pathWithLocalGrok } from "../src/grok/spawn.js";
import { startPrompt } from "../src/grok/prompt.js";
import { teamsMcpServers } from "../src/grok/mcpSpec.js";
import { brandConversationKey, brandMessageId, brandTurnId, type InboundMessage } from "../src/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walkTs(path));
    } else if (name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

test("GROK_ACP_ARGS is the official grok agent stdio argv", () => {
  assert.equal(GROK_BIN, "grok");
  assert.deepEqual([...GROK_ACP_ARGS], ["--no-auto-update", "--disallowed-tools", "search_tool,Agent,run_terminal_command", "agent", "--always-approve", "stdio"]);
});

test("host spawn path is grok + GROK_ACP_ARGS, never tsx harnessWorker", () => {
  const spawnSrc = readFileSync(join(root, "src/grok/spawn.ts"), "utf8");
  const hostSrc = readFileSync(join(root, "src/harnessHost.ts"), "utf8");
  assert.match(spawnSrc, /spawn\(GROK_BIN,\s*\[\.\.\.GROK_ACP_ARGS\]/);
  assert.match(hostSrc, /spawnGrok\(/);
  assert.match(hostSrc, /GROK_BIN,\s*\.\.\.GROK_ACP_ARGS/);
  assert.equal(spawnSrc.includes("harnessWorker"), false);
  assert.equal(hostSrc.includes("harnessWorker"), false);
  assert.equal(hostSrc.includes("tsx"), false);
});

test("pathWithLocalGrok prepends real grok dirs and never the repo shim", () => {
  const spawnSrc = readFileSync(join(root, "src/grok/spawn.ts"), "utf8");
  assert.equal(spawnSrc.includes("test/shim"), false);
  assert.equal(spawnSrc.includes("fakeGrok"), false);
  assert.equal(spawnSrc.includes("GROK_USE_SHIM"), false);
  assert.equal(existsSync(join(root, "bin/grok")), false);
  assert.equal(existsSync(join(root, "test/shim/fakeGrok.ts")), false);

  const built = pathWithLocalGrok({ HOME: homedir(), PATH: "/usr/bin" });
  const grokHome = join(homedir(), ".grok", "bin");
  const localBin = join(homedir(), ".local", "bin");
  const first = built.split(":")[0];
  if (existsSync(join(grokHome, "grok"))) {
    assert.equal(first, grokHome);
  } else if (existsSync(join(localBin, "grok"))) {
    assert.equal(first, localBin);
  }
  assert.equal(built.includes(`${root}/bin`), false);
  assert.equal(built.includes("/test/shim"), false);
});

test("startPrompt does not tell grok to sleep", () => {
  const message: InboundMessage = {
    kind: "message",
    messageId: brandMessageId("m1"),
    text: "hi",
    conversationKey: brandConversationKey("c1"),
    conversationId: "c1",
    serviceUrl: "",
    fromId: "u1",
    conversationType: "personal",
    surface: { kind: "dm", chatId: "c1" },
  };
  const text = startPrompt(message);
  assert.match(text, /injected as extra prompts/);
  assert.match(text, /Do not sleep/);
  assert.match(text, /"kind":"dm"/);
  assert.match(text, /"chat-id":"c1"/);
  assert.equal(/Work for \d+ ms|seconds have elapsed|sleep \d+/i.test(text), false);
});

test("harness worker path source does not import graph", () => {
  const files = [
    ...walkTs(join(root, "src/grok")),
    ...walkTs(join(root, "src/mcp")),
    join(root, "src/harnessHost.ts"),
    join(root, "src/mcpServerMain.ts"),
    join(root, "src/mockMcp.ts"),
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes("@microsoft/microsoft-graph-client"), false, file);
    const graphBackend = file.endsWith("/mcp/graph.ts");
    if (!graphBackend) {
      assert.equal(src.includes("graph.microsoft.com"), false, file);
    }
    assert.equal(src.includes("api.reactions"), false, file);
    assert.equal(src.includes("harnessWorker"), false, file);
  }
});

test("teamsMcpServers splits teams-read / teams-post and pins write env", () => {
  const servers = teamsMcpServers({
    turnId: brandTurnId("t-spec"),
    turnsDir: "/tmp/turns-spec",
    conversationId: "19:channel-1@thread.tacv2;messageid=root-1",
    serviceUrl: "http://localhost",
    conversationType: "channel",
    writeScope: {
      kind: "channel",
      teamId: "team-1",
      channelId: "channel-1",
      threadId: "root-1",
    },
  });
  assert.equal(servers.read.name, "teams-read");
  assert.equal(servers.write.name, "teams-post");
  assert.ok(servers.write.args.includes("--role=write"));
  assert.ok(servers.read.args.includes("--role=read"));
  assert.ok(servers.write.env.some((e) => e.name === "WRITE_THREAD_ID" && e.value === "root-1"));
  assert.equal(
    servers.read.env.some((e) => e.name === "WRITE_THREAD_ID"),
    false,
  );
});
