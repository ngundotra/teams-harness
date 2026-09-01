import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeployConfig, ReadPolicy } from "../deployConfig.js";
import { conversationTypeFromSurface, surfaceEnvVars, type Surface } from "../surface.js";
import {
  MCP_TEAMS_READ_SERVER,
  MCP_TEAMS_WRITE_SERVER,
  serverNameForRole,
  writeScopeFromSurface,
  type McpRole,
  type WriteScope,
} from "../mcp/tools.js";
import type { AcpEnvVar, AcpMcpServerStdio, TurnId } from "../types.js";

function mcpServerEntry(): { command: string; args: string[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const js = join(here, "..", "mcpServerMain.js");
  const ts = join(here, "..", "mcpServerMain.ts");
  if (existsSync(js)) {
    return { command: process.execPath, args: [js, "--stdio"] };
  }
  const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
  const tsx = existsSync(tsxBin) ? tsxBin : "tsx";
  return { command: process.execPath, args: [tsx, ts, "--stdio"] };
}

function inheritedEnv(): AcpEnvVar[] {
  const names = ["PATH", "HOME", "USER", "TMPDIR", "LANG", "NODE_PATH", "GRAPH_TOKEN", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_TENANT_ID"];
  const out: AcpEnvVar[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) {
      out.push({ name, value });
    }
  }
  return out;
}

function readPolicyEnv(policy: ReadPolicy, readRecentThreads: boolean): AcpEnvVar[] {
  const env: AcpEnvVar[] = [
    { name: "READ_POLICY", value: policy.kind },
    { name: "FEATURES_READ_RECENT_THREADS", value: readRecentThreads ? "true" : "false" },
  ];
  if (policy.kind === "allowlist") {
    env.push({ name: "READ_CHANNELS", value: JSON.stringify(policy.channels) });
  }
  return env;
}

function commonEnv(args: {
  turnId: TurnId;
  turnsDir: string;
  callbackUrl?: string;
  conversationId: string;
  serviceUrl: string;
  conversationType: string;
  surface?: Surface;
  readPolicy?: ReadPolicy;
  readRecentThreads?: boolean;
}): AcpEnvVar[] {
  const env: AcpEnvVar[] = [
    ...inheritedEnv(),
    { name: "TURN_ID", value: args.turnId },
    { name: "TURNS_DIR", value: args.turnsDir },
    { name: "CONVERSATION_ID", value: args.conversationId },
    { name: "SERVICE_URL", value: args.serviceUrl },
    {
      name: "CONVERSATION_TYPE",
      value: args.surface !== undefined ? conversationTypeFromSurface(args.surface) : args.conversationType,
    },
  ];
  if (args.callbackUrl !== undefined && args.callbackUrl.length > 0) {
    env.push({ name: "HOST_CALLBACK_URL", value: args.callbackUrl });
  }
  if (args.surface !== undefined) {
    env.push(...surfaceEnvVars(args.surface));
  }
  if (args.readPolicy !== undefined) {
    env.push(...readPolicyEnv(args.readPolicy, args.readRecentThreads === true));
  }
  return env;
}

function writeScopeEnv(scope: WriteScope, conversationId: string): AcpEnvVar[] {
  switch (scope.kind) {
    case "chat":
      return [
        { name: "WRITE_KIND", value: "chat" },
        { name: "WRITE_CONVERSATION_ID", value: scope.conversationId },
      ];
    case "channel":
      return [
        { name: "WRITE_KIND", value: "channel" },
        { name: "WRITE_CONVERSATION_ID", value: conversationId },
        { name: "WRITE_TEAM_ID", value: scope.teamId },
        { name: "WRITE_CHANNEL_ID", value: scope.channelId },
        { name: "WRITE_THREAD_ID", value: scope.threadId },
      ];
    default: {
      const _exhaustive: never = scope;
      throw new Error(`unknown write scope ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function stdioSpec(args: {
  role: McpRole;
  env: AcpEnvVar[];
}): AcpMcpServerStdio {
  const launched = mcpServerEntry();
  return {
    type: "stdio",
    name: serverNameForRole(args.role),
    command: launched.command,
    args: [...launched.args, `--role=${args.role}`],
    env: args.env,
  };
}

export function teamsMcpServers(args: {
  turnId: TurnId;
  turnsDir: string;
  callbackUrl?: string;
  conversationId: string;
  serviceUrl: string;
  conversationType: string;
  writeScope?: WriteScope;
  surface?: Surface;
  deploy?: DeployConfig;
  readPolicy?: ReadPolicy;
  readRecentThreads?: boolean;
}): { read: AcpMcpServerStdio; write: AcpMcpServerStdio } {
  const surface = args.surface;
  const writeScope = args.writeScope ?? (surface !== undefined ? writeScopeFromSurface(surface) : undefined);
  if (writeScope === undefined) {
    throw new Error("teamsMcpServers requires surface or writeScope");
  }
  const readPolicy = args.readPolicy ?? args.deploy?.readPolicy;
  const readRecentThreads = args.readRecentThreads ?? args.deploy?.features.readRecentThreads ?? false;
  const shared = commonEnv({
    turnId: args.turnId,
    turnsDir: args.turnsDir,
    conversationId: args.conversationId,
    serviceUrl: args.serviceUrl,
    conversationType: args.conversationType,
    ...(args.callbackUrl !== undefined ? { callbackUrl: args.callbackUrl } : {}),
    ...(surface !== undefined ? { surface } : {}),
    ...(readPolicy !== undefined ? { readPolicy, readRecentThreads } : {}),
  });
  const read = stdioSpec({ role: "read", env: shared });
  const write = stdioSpec({
    role: "write",
    env: [...shared, ...writeScopeEnv(writeScope, args.conversationId)],
  });
  return { read, write };
}

/** Grok config.json/GROK_CONFIG form. Omit env so the MCP child inherits grok's process env. */
export function grokConfigForMcp(read: AcpMcpServerStdio, write: AcpMcpServerStdio): string {
  return JSON.stringify({
    mcp_servers: {
      [MCP_TEAMS_READ_SERVER]: {
        command: read.command,
        args: read.args,
      },
      [MCP_TEAMS_WRITE_SERVER]: {
        command: write.command,
        args: write.args,
      },
    },
  });
}
