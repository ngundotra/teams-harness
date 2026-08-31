import { spawn, type ChildProcess } from "node:child_process";
import { attachJsonRpcReader, writeContentLength, type JsonRpcId } from "./stdio.js";
import { isRecord } from "../types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class McpStdioClient {
  private readonly child: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();

  constructor(child: ChildProcess) {
    this.child = child;
    if (this.child.stdout === null) {
      throw new Error("MCP child missing stdout");
    }
    attachJsonRpcReader(this.child.stdout, (value) => {
      this.onMessage(value);
    });
  }

  static launch(command: string, args: string[], env: NodeJS.ProcessEnv): McpStdioClient {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      process.stderr.write(`[mcp] ${chunk}`);
    });
    return new McpStdioClient(child);
  }

  async initialize(): Promise<unknown> {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "teams-harness-grok", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
    return result;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.child.stdin === null) {
        reject(new Error("MCP stdin closed"));
        return;
      }
      writeContentLength(this.child.stdin, { jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    if (this.child.stdin === null) {
      return;
    }
    writeContentLength(this.child.stdin, { jsonrpc: "2.0", method, params });
  }

  private onMessage(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }
    const id = value.id;
    if (typeof id !== "string" && typeof id !== "number") {
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(id);
    if (value.error !== undefined) {
      const err = isRecord(value.error) ? JSON.stringify(value.error) : "mcp error";
      pending.reject(new Error(err));
      return;
    }
    pending.resolve(value.result);
  }
}
