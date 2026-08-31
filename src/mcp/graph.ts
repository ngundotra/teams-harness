import { isRecord, readNumber, readString } from "../types.js";
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
} from "./tools.js";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

export type GraphClientCredentials = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

export type GraphDeps = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  nowMs?: () => number;
};

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | undefined;

export function resetGraphTokenCache(): void {
  cachedToken = undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

export function graphTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return nonEmpty(env.GRAPH_TOKEN);
}

export function graphClientCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GraphClientCredentials | undefined {
  const clientId = nonEmpty(env.GRAPH_CLIENT_ID);
  const clientSecret = nonEmpty(env.GRAPH_CLIENT_SECRET);
  const tenantId = nonEmpty(env.GRAPH_TENANT_ID);
  if (clientId === undefined || clientSecret === undefined || tenantId === undefined) {
    return undefined;
  }
  return { clientId, clientSecret, tenantId };
}

export function isGraphConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return graphTokenFromEnv(env) !== undefined || graphClientCredentialsFromEnv(env) !== undefined;
}

function resolveFetch(deps?: GraphDeps): typeof fetch {
  return deps?.fetchImpl ?? globalThis.fetch;
}

function resolveEnv(deps?: GraphDeps): NodeJS.ProcessEnv {
  return deps?.env ?? process.env;
}

function resolveNow(deps?: GraphDeps): number {
  return deps?.nowMs !== undefined ? deps.nowMs() : Date.now();
}

function tokenUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

async function fetchClientCredentialsToken(
  creds: GraphClientCredentials,
  deps?: GraphDeps,
): Promise<string> {
  const now = resolveNow(deps);
  if (cachedToken !== undefined && cachedToken.expiresAtMs > now + 30_000) {
    return cachedToken.accessToken;
  }
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });
  const res = await resolveFetch(deps)(tokenUrl(creds.tenantId), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`graph token ${res.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("graph token: invalid json");
  }
  if (!isRecord(parsed)) {
    throw new Error("graph token: unexpected body");
  }
  const accessToken = readString(parsed.access_token);
  if (accessToken === undefined || accessToken.length === 0) {
    throw new Error("graph token: missing access_token");
  }
  const expiresIn = readNumber(parsed.expires_in) ?? 3600;
  cachedToken = {
    accessToken,
    expiresAtMs: now + expiresIn * 1000,
  };
  return accessToken;
}

export async function resolveGraphAccessToken(deps?: GraphDeps): Promise<string> {
  const env = resolveEnv(deps);
  const staticToken = graphTokenFromEnv(env);
  if (staticToken !== undefined) {
    return staticToken;
  }
  const creds = graphClientCredentialsFromEnv(env);
  if (creds === undefined) {
    throw new Error("graph is not configured");
  }
  return fetchClientCredentialsToken(creds, deps);
}

function argString(args: Record<string, unknown>, key: string): string | undefined {
  return nonEmpty(readString(args[key]));
}

function bodyText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (isRecord(body)) {
    return readString(body.content) ?? JSON.stringify(body);
  }
  return "";
}

function reactionType(args: Record<string, unknown>): string | undefined {
  return nonEmpty(readString(args.reactionType)) ?? nonEmpty(readString(args.emoji));
}

function messageBody(args: Record<string, unknown>): { body: { contentType: "text"; content: string } } {
  return { body: { contentType: "text", content: bodyText(args.body) } };
}

function reactionBody(args: Record<string, unknown>): { reactionType: string } | undefined {
  const type = reactionType(args);
  if (type === undefined) {
    return undefined;
  }
  return { reactionType: type };
}

type GraphCall =
  | { method: "GET"; path: string }
  | { method: "POST"; path: string; body?: unknown };

function missing(field: string): { ok: false; error: string } {
  return { ok: false, error: `${field} required` };
}

export function graphCallForTool(name: string, args: Record<string, unknown>): GraphCall | { ok: false; error: string } {
  switch (name) {
    case TOOL_CHAT_POST: {
      const chatId = argString(args, "chat-id");
      if (chatId === undefined) {
        return missing("chat-id");
      }
      return { method: "POST", path: `/chats/${encodeURIComponent(chatId)}/messages`, body: messageBody(args) };
    }
    case TOOL_CHAT_LIST: {
      const chatId = argString(args, "chat-id");
      if (chatId === undefined) {
        return missing("chat-id");
      }
      return { method: "GET", path: `/chats/${encodeURIComponent(chatId)}/messages` };
    }
    case TOOL_CHAT_GET: {
      const chatId = argString(args, "chat-id");
      const messageId = argString(args, "message-id");
      if (chatId === undefined) {
        return missing("chat-id");
      }
      if (messageId === undefined) {
        return missing("message-id");
      }
      return {
        method: "GET",
        path: `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
      };
    }
    case TOOL_CHAT_SET_REACTION:
    case TOOL_CHAT_UNSET_REACTION: {
      const chatId = argString(args, "chat-id");
      const messageId = argString(args, "message-id");
      const body = reactionBody(args);
      if (chatId === undefined) {
        return missing("chat-id");
      }
      if (messageId === undefined) {
        return missing("message-id");
      }
      if (body === undefined) {
        return missing("reactionType");
      }
      const action = name === TOOL_CHAT_SET_REACTION ? "setReaction" : "unsetReaction";
      return {
        method: "POST",
        path: `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/${action}`,
        body,
      };
    }
    case TOOL_TEAMS_POST: {
      const teamId = argString(args, "team-id");
      const channelId = argString(args, "channel-id");
      if (teamId === undefined) {
        return missing("team-id");
      }
      if (channelId === undefined) {
        return missing("channel-id");
      }
      return {
        method: "POST",
        path: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
        body: messageBody(args),
      };
    }
    case TOOL_TEAMS_REPLY: {
      const teamId = argString(args, "team-id");
      const channelId = argString(args, "channel-id");
      const messageId = argString(args, "message-id");
      if (teamId === undefined) {
        return missing("team-id");
      }
      if (channelId === undefined) {
        return missing("channel-id");
      }
      if (messageId === undefined) {
        return missing("message-id");
      }
      return {
        method: "POST",
        path: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/replies`,
        body: messageBody(args),
      };
    }
    case TOOL_TEAMS_LIST: {
      const teamId = argString(args, "team-id");
      const channelId = argString(args, "channel-id");
      if (teamId === undefined) {
        return missing("team-id");
      }
      if (channelId === undefined) {
        return missing("channel-id");
      }
      return {
        method: "GET",
        path: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
      };
    }
    case TOOL_TEAMS_LIST_REPLIES: {
      const teamId = argString(args, "team-id");
      const channelId = argString(args, "channel-id");
      const messageId = argString(args, "message-id");
      if (teamId === undefined) {
        return missing("team-id");
      }
      if (channelId === undefined) {
        return missing("channel-id");
      }
      if (messageId === undefined) {
        return missing("message-id");
      }
      return {
        method: "GET",
        path: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/replies`,
      };
    }
    case TOOL_TEAMS_SET_REACTION:
    case TOOL_TEAMS_UNSET_REACTION: {
      const teamId = argString(args, "team-id");
      const channelId = argString(args, "channel-id");
      const messageId = argString(args, "message-id");
      const body = reactionBody(args);
      if (teamId === undefined) {
        return missing("team-id");
      }
      if (channelId === undefined) {
        return missing("channel-id");
      }
      if (messageId === undefined) {
        return missing("message-id");
      }
      if (body === undefined) {
        return missing("reactionType");
      }
      const action = name === TOOL_TEAMS_SET_REACTION ? "setReaction" : "unsetReaction";
      return {
        method: "POST",
        path: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/${action}`,
        body,
      };
    }
    default:
      return { ok: false, error: `unknown graph tool ${name}` };
  }
}

export type GraphHttpResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string; body: unknown };

export async function graphRequest(call: GraphCall, deps?: GraphDeps): Promise<GraphHttpResult> {
  const token = await resolveGraphAccessToken(deps);
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  if (call.method === "POST" && call.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const init: RequestInit = {
    method: call.method,
    headers,
  };
  if (call.method === "POST" && call.body !== undefined) {
    init.body = JSON.stringify(call.body);
  }
  const res = await resolveFetch(deps)(`${GRAPH_BASE}${call.path}`, init);
  const rawText = await res.text();
  let parsed: unknown = rawText;
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      parsed = rawText;
    }
  } else {
    parsed = undefined;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `graph ${res.status}`, body: parsed };
  }
  return { ok: true, status: res.status, body: parsed };
}

function toolResultFromHttp(name: string, args: Record<string, unknown>, http: GraphHttpResult): unknown {
  if (!http.ok) {
    return { ok: false, error: http.error, status: http.status, body: http.body };
  }
  if (
    name === TOOL_CHAT_SET_REACTION ||
    name === TOOL_CHAT_UNSET_REACTION ||
    name === TOOL_TEAMS_SET_REACTION ||
    name === TOOL_TEAMS_UNSET_REACTION
  ) {
    const type = reactionType(args);
    const reaction =
      type !== undefined && argString(args, "message-id") !== undefined
        ? { messageId: argString(args, "message-id") ?? "", emoji: type }
        : undefined;
    return { ok: true, reaction, graph: http.body };
  }
  if (name === TOOL_CHAT_POST || name === TOOL_TEAMS_POST || name === TOOL_TEAMS_REPLY) {
    return { ok: true, text: bodyText(args.body), graph: http.body };
  }
  if (http.body === undefined) {
    return { value: [] };
  }
  return http.body;
}

function isGraphCall(value: GraphCall | { ok: false; error: string }): value is GraphCall {
  return !("ok" in value);
}

export async function executeGraphTool(
  name: string,
  args: Record<string, unknown>,
  deps?: GraphDeps,
): Promise<unknown> {
  const call = graphCallForTool(name, args);
  if (!isGraphCall(call)) {
    return call;
  }
  try {
    const http = await graphRequest(call, deps);
    return toolResultFromHttp(name, args, http);
  } catch (err) {
    const message = err instanceof Error ? err.message : "graph request failed";
    return { ok: false, error: message };
  }
}
