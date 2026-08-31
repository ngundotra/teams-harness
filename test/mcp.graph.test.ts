import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { teamsMcpServers } from "../src/grok/mcpSpec.js";
import { executeGraphTool, isGraphConfigured, resetGraphTokenCache } from "../src/mcp/graph.js";
import { applyTool, executeTool } from "../src/mcp/runtime.js";
import {
  TOOL_CHAT_GET,
  TOOL_CHAT_LIST,
  TOOL_CHAT_POST,
  TOOL_CHAT_SET_REACTION,
  TOOL_CHAT_UNSET_REACTION,
  TOOL_TEAMS_LIST,
  TOOL_TEAMS_LIST_REPLIES,
  TOOL_TEAMS_POST,
  TOOL_TEAMS_REPLY,
  TOOL_TEAMS_SET_REACTION,
  TOOL_TEAMS_UNSET_REACTION,
} from "../src/mcp/tools.js";
import { brandTurnId, isRecord } from "../src/types.js";
import { isolatedTurnsDir } from "./helpers.js";

const GRAPH_HOST = "graph.microsoft.com";
const TOKEN = "test-graph-token";

type FetchCall = {
  url: string;
  method: string;
  authorization: string | undefined;
  body: unknown;
};

const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(name: string): void {
  savedEnv[name] = process.env[name];
}

function restoreEnv(): void {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function unsetGraphEnv(): void {
  delete process.env.GRAPH_TOKEN;
  delete process.env.GRAPH_CLIENT_ID;
  delete process.env.GRAPH_CLIENT_SECRET;
  delete process.env.GRAPH_TENANT_ID;
  delete process.env.HOST_CALLBACK_URL;
}

function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), `expected object, got ${JSON.stringify(value)}`);
  return value;
}

function installFetch(handler?: (url: string, init: RequestInit | undefined) => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    let parsed: unknown;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        parsed = JSON.parse(init.body) as unknown;
      } catch {
        parsed = init.body;
      }
    }
    fetchCalls.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? undefined,
      body: parsed,
    });
    if (handler !== undefined) {
      return handler(url, init);
    }
    if (url.includes("/setReaction") || url.includes("/unsetReaction")) {
      return jsonResponse(204, undefined);
    }
    if (url.includes("/messages")) {
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse(201, { id: "graph-msg-1", body: { contentType: "text", content: "ok" } });
      }
      if (url.includes("/replies")) {
        return jsonResponse(200, { value: [{ id: "reply-1" }] });
      }
      if ((init?.method ?? "GET") === "GET" && /\/messages\/[^/]+$/.test(url)) {
        return jsonResponse(200, { id: "msg-1", body: { contentType: "text", content: "hi" } });
      }
      return jsonResponse(200, { value: [{ id: "msg-1" }] });
    }
    return jsonResponse(404, { error: "unexpected" });
  }) as typeof fetch;
}

before(() => {
  isolatedTurnsDir();
  saveEnv("GRAPH_TOKEN");
  saveEnv("GRAPH_CLIENT_ID");
  saveEnv("GRAPH_CLIENT_SECRET");
  saveEnv("GRAPH_TENANT_ID");
  saveEnv("HOST_CALLBACK_URL");
  unsetGraphEnv();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchCalls.length = 0;
  resetGraphTokenCache();
  unsetGraphEnv();
});

after(() => {
  restoreEnv();
  globalThis.fetch = originalFetch;
});

test("isGraphConfigured is false when GRAPH_TOKEN and client creds are unset", () => {
  unsetGraphEnv();
  assert.equal(isGraphConfigured(), false);
});

test("executeTool with GRAPH_TOKEN posts chat message to Graph with Bearer", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  installFetch();
  const result = asRecord(
    await executeTool(
      brandTurnId("graph-chat-post"),
      TOOL_CHAT_POST,
      { "chat-id": "19:chat@thread.v2", body: "hello-graph" },
      "write",
    ),
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, "hello-graph");
  assert.equal(fetchCalls.length, 1);
  const call = fetchCalls[0];
  assert.ok(call);
  assert.equal(call.method, "POST");
  assert.equal(
    call.url,
    "https://graph.microsoft.com/v1.0/chats/19%3Achat%40thread.v2/messages",
  );
  assert.equal(call.authorization, `Bearer ${TOKEN}`);
  assert.ok(isRecord(call.body));
  assert.ok(isRecord(call.body.body));
  assert.equal(call.body.body.contentType, "text");
  assert.equal(call.body.body.content, "hello-graph");
});

test("executeTool with GRAPH_TOKEN lists chat messages via Graph GET", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  installFetch();
  const result = asRecord(
    await executeTool(
      brandTurnId("graph-chat-list"),
      TOOL_CHAT_LIST,
      { "chat-id": "chat-1" },
      "read",
    ),
  );
  assert.ok(Array.isArray(result.value));
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.method, "GET");
  assert.equal(fetchCalls[0]?.url, "https://graph.microsoft.com/v1.0/chats/chat-1/messages");
  assert.equal(fetchCalls[0]?.authorization, `Bearer ${TOKEN}`);
});

test("executeTool with GRAPH_TOKEN gets a chat message via Graph", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  installFetch();
  await executeTool(
    brandTurnId("graph-chat-get"),
    TOOL_CHAT_GET,
    { "chat-id": "chat-1", "message-id": "msg-9" },
    "read",
  );
  assert.equal(fetchCalls[0]?.method, "GET");
  assert.equal(
    fetchCalls[0]?.url,
    "https://graph.microsoft.com/v1.0/chats/chat-1/messages/msg-9",
  );
  assert.equal(fetchCalls[0]?.authorization, `Bearer ${TOKEN}`);
});

test("executeTool with GRAPH_TOKEN set/unset chat reaction hits Graph", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  installFetch();
  await executeTool(
    brandTurnId("graph-chat-set"),
    TOOL_CHAT_SET_REACTION,
    { "chat-id": "chat-1", "message-id": "msg-1", reactionType: "eyes" },
    "read",
  );
  await executeTool(
    brandTurnId("graph-chat-unset"),
    TOOL_CHAT_UNSET_REACTION,
    { "chat-id": "chat-1", "message-id": "msg-1", reactionType: "eyes" },
    "read",
  );
  assert.equal(fetchCalls.length, 2);
  assert.equal(
    fetchCalls[0]?.url,
    "https://graph.microsoft.com/v1.0/chats/chat-1/messages/msg-1/setReaction",
  );
  assert.deepEqual(fetchCalls[0]?.body, { reactionType: "eyes" });
  assert.equal(fetchCalls[0]?.authorization, `Bearer ${TOKEN}`);
  assert.equal(
    fetchCalls[1]?.url,
    "https://graph.microsoft.com/v1.0/chats/chat-1/messages/msg-1/unsetReaction",
  );
  assert.deepEqual(fetchCalls[1]?.body, { reactionType: "eyes" });
});

test("executeTool with GRAPH_TOKEN posts and replies on a channel via Graph", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  installFetch();
  await executeTool(
    brandTurnId("graph-teams-post"),
    TOOL_TEAMS_POST,
    { "team-id": "team-1", "channel-id": "channel-1", body: "channel-hi" },
    "write",
  );
  await executeTool(
    brandTurnId("graph-teams-reply"),
    TOOL_TEAMS_REPLY,
    { "team-id": "team-1", "channel-id": "channel-1", "message-id": "root-1", body: "reply-hi" },
    "write",
  );
  assert.equal(
    fetchCalls[0]?.url,
    "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages",
  );
  assert.equal(fetchCalls[0]?.method, "POST");
  assert.equal(fetchCalls[0]?.authorization, `Bearer ${TOKEN}`);
  assert.equal(
    fetchCalls[1]?.url,
    "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/root-1/replies",
  );
});

test("executeTool with GRAPH_TOKEN lists channel messages and replies via Graph", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  installFetch();
  await executeTool(
    brandTurnId("graph-teams-list"),
    TOOL_TEAMS_LIST,
    { "team-id": "team-1", "channel-id": "channel-1" },
    "read",
  );
  await executeTool(
    brandTurnId("graph-teams-replies"),
    TOOL_TEAMS_LIST_REPLIES,
    { "team-id": "team-1", "channel-id": "channel-1", "message-id": "root-1" },
    "read",
  );
  assert.equal(
    fetchCalls[0]?.url,
    "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages",
  );
  assert.equal(fetchCalls[0]?.method, "GET");
  assert.equal(
    fetchCalls[1]?.url,
    "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/root-1/replies",
  );
});

test("executeTool with GRAPH_TOKEN set/unset channel reaction hits Graph", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  installFetch();
  await executeTool(
    brandTurnId("graph-teams-set"),
    TOOL_TEAMS_SET_REACTION,
    { "team-id": "team-1", "channel-id": "channel-1", "message-id": "msg-1", reactionType: "like" },
    "read",
  );
  await executeTool(
    brandTurnId("graph-teams-unset"),
    TOOL_TEAMS_UNSET_REACTION,
    { "team-id": "team-1", "channel-id": "channel-1", "message-id": "msg-1", reactionType: "like" },
    "read",
  );
  assert.equal(
    fetchCalls[0]?.url,
    "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/msg-1/setReaction",
  );
  assert.equal(
    fetchCalls[1]?.url,
    "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/msg-1/unsetReaction",
  );
  assert.equal(fetchCalls[0]?.authorization, `Bearer ${TOKEN}`);
});

test("executeTool without token uses mock path and never calls graph.microsoft.com", async () => {
  unsetGraphEnv();
  installFetch();
  const result = asRecord(
    await executeTool(
      brandTurnId("graph-absent-post"),
      TOOL_CHAT_POST,
      { "chat-id": "chat-1", body: "playground-only" },
      "write",
    ),
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, "playground-only");
  assert.equal(result.graph, undefined);
  assert.equal(
    fetchCalls.some((c) => c.url.includes(GRAPH_HOST)),
    false,
  );
  const listed = asRecord(
    await executeTool(brandTurnId("graph-absent-list"), TOOL_CHAT_LIST, { "chat-id": "chat-1" }, "read"),
  );
  assert.ok(Array.isArray(listed.value));
  assert.equal(
    fetchCalls.some((c) => c.url.includes(GRAPH_HOST)),
    false,
  );
});

test("applyTool without token stays on the mock playground path", () => {
  unsetGraphEnv();
  installFetch();
  const result = asRecord(applyTool(TOOL_CHAT_POST, { "chat-id": "chat-1", body: "mock-apply" }));
  assert.equal(result.ok, true);
  assert.equal(result.text, "mock-apply");
  assert.equal(
    fetchCalls.some((c) => c.url.includes(GRAPH_HOST)),
    false,
  );
});

test("client credentials fetch a token then call Graph with Bearer", async () => {
  unsetGraphEnv();
  process.env.GRAPH_CLIENT_ID = "client-id";
  process.env.GRAPH_CLIENT_SECRET = "client-secret";
  process.env.GRAPH_TENANT_ID = "tenant-id";
  installFetch((url) => {
    if (url.includes("login.microsoftonline.com")) {
      assert.match(url, /login\.microsoftonline\.com\/tenant-id\/oauth2\/v2\.0\/token/);
      return jsonResponse(200, { access_token: "cc-token", expires_in: 3600 });
    }
    return jsonResponse(201, { id: "from-cc" });
  });
  const result = asRecord(
    await executeGraphTool(TOOL_CHAT_POST, { "chat-id": "chat-cc", body: "via-cc" }),
  );
  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 2);
  assert.match(fetchCalls[0]?.url ?? "", /login\.microsoftonline\.com\/tenant-id\/oauth2\/v2\.0\/token/);
  assert.equal(fetchCalls[1]?.authorization, "Bearer cc-token");
  assert.ok((fetchCalls[1]?.url ?? "").includes(GRAPH_HOST));
});

test("executeTool still notifyHost after a Graph call when a callback URL is set", async () => {
  process.env.GRAPH_TOKEN = TOKEN;
  const callbacks: string[] = [];
  installFetch((url) => {
    if (url.includes("127.0.0.1:9/callback")) {
      callbacks.push(url);
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(201, { id: "graph-msg-cb" });
  });
  process.env.HOST_CALLBACK_URL = "http://127.0.0.1:9/callback";
  await executeTool(
    brandTurnId("graph-notify"),
    TOOL_CHAT_POST,
    { "chat-id": "chat-1", body: "mirror-me" },
    "write",
  );
  assert.ok(fetchCalls.some((c) => c.url.includes(GRAPH_HOST)));
  assert.ok(fetchCalls.some((c) => c.url.includes("/callback")));
  assert.equal(callbacks.length, 1);
});

test("teamsMcpServers forwards GRAPH_TOKEN to MCP children", () => {
  process.env.GRAPH_TOKEN = TOKEN;
  const servers = teamsMcpServers({
    turnId: brandTurnId("graph-spec"),
    turnsDir: "/tmp/turns-graph-spec",
    conversationId: "chat-1",
    serviceUrl: "http://localhost",
    conversationType: "personal",
    writeScope: { kind: "chat", conversationId: "chat-1" },
  });
  assert.ok(servers.read.env.some((e) => e.name === "GRAPH_TOKEN" && e.value === TOKEN));
  assert.ok(servers.write.env.some((e) => e.name === "GRAPH_TOKEN" && e.value === TOKEN));
});

test("GRAPH_TOKEN unset means teamsMcpServers does not inject a token", () => {
  unsetGraphEnv();
  const servers = teamsMcpServers({
    turnId: brandTurnId("graph-spec-empty"),
    turnsDir: "/tmp/turns-graph-spec",
    conversationId: "chat-1",
    serviceUrl: "http://localhost",
    conversationType: "personal",
    writeScope: { kind: "chat", conversationId: "chat-1" },
  });
  assert.equal(
    servers.read.env.some((e) => e.name === "GRAPH_TOKEN"),
    false,
  );
});
