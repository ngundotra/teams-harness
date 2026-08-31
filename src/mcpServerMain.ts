import { writeFileSync, writeSync } from "node:fs";
import { attachJsonRpcReader, encodeNdjson, parseJsonRpc, type JsonRpcId } from "./mcp/stdio.js";
import { executeTool, toolList, turnIdFromEnv, writeScopeFromEnv } from "./mcp/runtime.js";
import { ensureTurnDir, mcpReadyPath, mcpReadyRolePath } from "./inbox.js";
import { parseMcpRole, serverNameForRole, type McpRole, type WriteScope } from "./mcp/tools.js";
import { isRecord, readString } from "./types.js";

function ok(id: JsonRpcId | undefined, result: unknown): void {
  if (id === undefined) {
    return;
  }
  writeSync(1, encodeNdjson({ jsonrpc: "2.0", id, result }));
}

function fail(id: JsonRpcId | undefined, message: string): void {
  if (id === undefined) {
    return;
  }
  writeSync(1, encodeNdjson({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message },
  }));
}

function writeScopeForRole(role: McpRole): WriteScope | undefined {
  switch (role) {
    case "read":
      return undefined;
    case "write": {
      const scope = writeScopeFromEnv();
      if (scope === undefined) {
        throw new Error("WRITE_KIND is required for --role=write");
      }
      return scope;
    }
    default: {
      const _exhaustive: never = role;
      throw new Error(`unknown MCP role ${_exhaustive}`);
    }
  }
}

async function main(): Promise<void> {
  const role = parseMcpRole(process.argv, process.env);
  const turnId = turnIdFromEnv();
  const scope = writeScopeForRole(role);
  attachJsonRpcReader(process.stdin, (value) => {
    const msg = parseJsonRpc(value);
    if (msg === undefined) {
      return;
    }
    void handle(turnId, role, scope, msg.method, msg.id, msg.params);
  });
}

async function handle(
  turnId: ReturnType<typeof turnIdFromEnv>,
  role: McpRole,
  scope: WriteScope | undefined,
  method: string,
  id: JsonRpcId | undefined,
  params: unknown,
): Promise<void> {
  try {
    process.stderr.write(`[mcp] role=${role} method=${method}\n`);
    if (method === "initialize") {
      ensureTurnDir(turnId);
      const requested = isRecord(params) ? readString(params.protocolVersion) : undefined;
      const protocolVersion = requested ?? "2025-11-25";
      process.stderr.write("[mcp] initialize protocolVersion=" + protocolVersion + "\n");
      ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: serverNameForRole(role), version: "0.1.0" },
      });
      return;
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return;
    }
    if (method === "tools/list") {
      writeFileSync(mcpReadyPath(turnId), "tools/list\n");
      writeFileSync(mcpReadyRolePath(turnId, role), "tools/list\n");
      process.stderr.write(`[mcp] tools/list role=${role}\n`);
      ok(id, toolList(role));
      return;
    }
    if (method === "tools/call") {
      if (!isRecord(params)) {
        fail(id, "tools/call missing params");
        return;
      }
      const name = readString(params.name);
      if (name === undefined) {
        fail(id, "tools/call missing name");
        return;
      }
      const result = await executeTool(turnId, name, params.arguments, role, scope);
      ok(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false,
      });
      return;
    }
    if (method === "ping") {
      ok(id, {});
      return;
    }
    fail(id, `method not found: ${method}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "mcp error";
    fail(id, message);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "mcp server failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
