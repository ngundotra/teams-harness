export const MCP_TEAMS_READ_SERVER = "teams-read";
export const MCP_TEAMS_WRITE_SERVER = "teams-post";

export const TOOL_CHAT_POST = "mcp_graph_chat_postMessage";
export const TOOL_CHAT_LIST = "mcp_graph_chat_listChatMessages";
export const TOOL_CHAT_GET = "mcp_graph_chat_getChatMessage";
export const TOOL_TEAMS_POST = "mcp_graph_teams_postChannelMessage";
export const TOOL_TEAMS_REPLY = "mcp_graph_teams_replyToChannelMessage";
export const TOOL_TEAMS_LIST = "mcp_graph_teams_listChannelMessages";
export const TOOL_TEAMS_LIST_REPLIES = "mcp_graph_teams_listChannelMessageReplies";
export const TOOL_CHAT_SET_REACTION = "mcp_graph_chat_setReaction";
export const TOOL_CHAT_UNSET_REACTION = "mcp_graph_chat_unsetReaction";
export const TOOL_TEAMS_SET_REACTION = "mcp_graph_teams_setReaction";
export const TOOL_TEAMS_UNSET_REACTION = "mcp_graph_teams_unsetReaction";
export const TOOL_DRAIN_INBOX = "harness_drainInbox";

export const SET_REACTION_TOOLS = [TOOL_CHAT_SET_REACTION, TOOL_TEAMS_SET_REACTION] as const;
export const POST_TOOLS = [TOOL_CHAT_POST, TOOL_TEAMS_POST, TOOL_TEAMS_REPLY] as const;

export const WRITE_TOOLS = POST_TOOLS;
export const READ_TOOLS = [
  TOOL_CHAT_LIST,
  TOOL_CHAT_GET,
  TOOL_TEAMS_LIST,
  TOOL_TEAMS_LIST_REPLIES,
  TOOL_CHAT_SET_REACTION,
  TOOL_CHAT_UNSET_REACTION,
  TOOL_TEAMS_SET_REACTION,
  TOOL_TEAMS_UNSET_REACTION,
  TOOL_DRAIN_INBOX,
] as const;

export type McpRole = "read" | "write";

export type WriteScope =
  | { kind: "chat"; conversationId: string }
  | { kind: "channel"; teamId: string; channelId: string; threadId: string };

export type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
};

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

function obj(properties: Record<string, Record<string, unknown>>, required: string[]): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const str = { type: "string" };
const body = {
  description: "Message body (plain text). Official parameter name is body.",
  anyOf: [{ type: "string" }, { type: "object", properties: { content: { type: "string" } } }],
};

export const TEAM_MCP_TOOL_DEFS: McpToolDef[] = [
  {
    name: TOOL_CHAT_POST,
    description: "Post a plain-text message in a chat. Official Work IQ tool.",
    inputSchema: obj({ "chat-id": str, body }, ["chat-id", "body"]),
  },
  {
    name: TOOL_CHAT_LIST,
    description: "List messages in a chat. Official Work IQ tool.",
    inputSchema: obj({ "chat-id": str }, ["chat-id"]),
  },
  {
    name: TOOL_CHAT_GET,
    description: "Get a chat message by id. Official Work IQ tool.",
    inputSchema: obj({ "chat-id": str, "message-id": str }, ["chat-id", "message-id"]),
  },
  {
    name: TOOL_TEAMS_POST,
    description: "Post a plain-text message to a channel. Official Work IQ tool.",
    inputSchema: obj({ "team-id": str, "channel-id": str, body }, ["team-id", "channel-id", "body"]),
  },
  {
    name: TOOL_TEAMS_REPLY,
    description: "Reply to a channel message. Official Work IQ tool.",
    inputSchema: obj(
      { "team-id": str, "channel-id": str, "message-id": str, body },
      ["team-id", "channel-id", "message-id", "body"],
    ),
  },
  {
    name: TOOL_TEAMS_LIST,
    description: "List messages in a channel. Official Work IQ tool.",
    inputSchema: obj({ "team-id": str, "channel-id": str }, ["team-id", "channel-id"]),
  },
  {
    name: TOOL_TEAMS_LIST_REPLIES,
    description: "List replies to a channel message. Added in this MCP wrapper (list payload is roots only).",
    inputSchema: obj(
      { "team-id": str, "channel-id": str, "message-id": str },
      ["team-id", "channel-id", "message-id"],
    ),
  },
  {
    name: TOOL_CHAT_SET_REACTION,
    description: "Set a reaction on a chat message. Added in this MCP wrapper (missing from published Work IQ).",
    inputSchema: obj(
      { "chat-id": str, "message-id": str, reactionType: str },
      ["chat-id", "message-id", "reactionType"],
    ),
  },
  {
    name: TOOL_CHAT_UNSET_REACTION,
    description: "Unset a reaction on a chat message. Added in this MCP wrapper.",
    inputSchema: obj(
      { "chat-id": str, "message-id": str, reactionType: str },
      ["chat-id", "message-id", "reactionType"],
    ),
  },
  {
    name: TOOL_TEAMS_SET_REACTION,
    description: "Set a reaction on a channel message. Added in this MCP wrapper.",
    inputSchema: obj(
      { "team-id": str, "channel-id": str, "message-id": str, reactionType: str },
      ["team-id", "channel-id", "message-id", "reactionType"],
    ),
  },
  {
    name: TOOL_TEAMS_UNSET_REACTION,
    description: "Unset a reaction on a channel message. Added in this MCP wrapper.",
    inputSchema: obj(
      { "team-id": str, "channel-id": str, "message-id": str, reactionType: str },
      ["team-id", "channel-id", "message-id", "reactionType"],
    ),
  },
  {
    name: TOOL_DRAIN_INBOX,
    description: "Pull queued follow-up messages and inbound reactions for the in-flight harness turn.",
    inputSchema: obj({}, []),
  },
];

export function isSetReactionTool(name: string): boolean {
  return name === TOOL_CHAT_SET_REACTION || name === TOOL_TEAMS_SET_REACTION;
}

export function isUnsetReactionTool(name: string): boolean {
  return name === TOOL_CHAT_UNSET_REACTION || name === TOOL_TEAMS_UNSET_REACTION;
}

export function isPostTool(name: string): boolean {
  return name === TOOL_CHAT_POST || name === TOOL_TEAMS_POST || name === TOOL_TEAMS_REPLY;
}

export function isReadTool(name: string): boolean {
  return (
    name === TOOL_CHAT_LIST ||
    name === TOOL_CHAT_GET ||
    name === TOOL_TEAMS_LIST ||
    name === TOOL_TEAMS_LIST_REPLIES ||
    name === TOOL_CHAT_SET_REACTION ||
    name === TOOL_CHAT_UNSET_REACTION ||
    name === TOOL_TEAMS_SET_REACTION ||
    name === TOOL_TEAMS_UNSET_REACTION ||
    name === TOOL_DRAIN_INBOX
  );
}

export function parseMcpRole(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): McpRole {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--role=read") {
      return "read";
    }
    if (arg === "--role=write") {
      return "write";
    }
    if (arg.startsWith("--role=")) {
      const value = arg.slice("--role=".length);
      if (value === "read" || value === "write") {
        return value;
      }
      throw new Error(`invalid --role=${value}`);
    }
    if (arg === "--role") {
      const next = argv[i + 1];
      if (next === "read" || next === "write") {
        return next;
      }
      throw new Error(`invalid --role ${next ?? ""}`);
    }
  }
  const fromEnv = env.MCP_ROLE;
  if (fromEnv === "read" || fromEnv === "write") {
    return fromEnv;
  }
  throw new Error("MCP role required (--role=read|write or MCP_ROLE)");
}

export function serverNameForRole(role: McpRole): string {
  switch (role) {
    case "read":
      return MCP_TEAMS_READ_SERVER;
    case "write":
      return MCP_TEAMS_WRITE_SERVER;
    default: {
      const _exhaustive: never = role;
      throw new Error(`unknown MCP role ${_exhaustive}`);
    }
  }
}

export function toolDefsForRole(role: McpRole): McpToolDef[] {
  switch (role) {
    case "read":
      return TEAM_MCP_TOOL_DEFS.filter((def) => isReadTool(def.name));
    case "write":
      return TEAM_MCP_TOOL_DEFS.filter((def) => isPostTool(def.name));
    default: {
      const _exhaustive: never = role;
      throw new Error(`unknown MCP role ${_exhaustive}`);
    }
  }
}

export function toolAllowedOnRole(role: McpRole, name: string): boolean {
  switch (role) {
    case "read":
      return isReadTool(name);
    case "write":
      return isPostTool(name);
    default: {
      const _exhaustive: never = role;
      throw new Error(`unknown MCP role ${_exhaustive}`);
    }
  }
}
