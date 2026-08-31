import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { attachJsonRpcReader, writeNdjson, type JsonRpcId } from "../mcp/stdio.js";
import { isRecord, readNumber, readString } from "../types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type Term = {
  child: ChildProcess;
  output: string;
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  byteLimit: number;
};

function acpTimeoutMs(): number {
  const raw = process.env.HARNESS_ACP_TIMEOUT_MS;
  if (raw !== undefined && raw.length > 0) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return 120_000;
}

function jsonRpcId(value: unknown): JsonRpcId | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

function isSecretPath(path: string): boolean {
  const n = path.replace(/\\/g, "/").toLowerCase();
  return n.endsWith("/auth.json") || n.includes("/.grok/auth") || n.endsWith("auth.json");
}

export class AcpClient {
  private readonly child: ChildProcess;
  private nextId = 1;
  private termSeq = 0;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private readonly terminals = new Map<string, Term>();
  agentText = "";

  constructor(child: ChildProcess) {
    this.child = child;
    if (this.child.stdout === null) {
      throw new Error("grok child missing stdout");
    }
    attachJsonRpcReader(this.child.stdout, (value) => {
      this.onMessage(value);
    });
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      process.stderr.write(`[grok] ${chunk}`);
    });
    this.child.on("exit", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("grok exited"));
      }
      this.pending.clear();
      for (const term of this.terminals.values()) {
        if (!term.child.killed) {
          term.child.kill("SIGTERM");
        }
      }
      this.terminals.clear();
    });
  }

  request(method: string, params: unknown, timeoutMs = acpTimeoutMs()): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      if (this.child.stdin === null) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("grok stdin closed"));
        return;
      }
      writeNdjson(this.child.stdin, { jsonrpc: "2.0", id, method, params });
    });
  }

  private reply(id: JsonRpcId, result: unknown): void {
    if (this.child.stdin === null) {
      return;
    }
    writeNdjson(this.child.stdin, { jsonrpc: "2.0", id, result });
  }

  private replyError(id: JsonRpcId, message: string, code = -32000): void {
    if (this.child.stdin === null) {
      return;
    }
    writeNdjson(this.child.stdin, { jsonrpc: "2.0", id, error: { code, message } });
  }

  private onMessage(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }
    const method = readString(value.method);
    if (method !== undefined) {
      if (method !== "session/update") {
        process.stderr.write(`[acp] <- ${method}\n`);
      }
      this.onAgentRequest(method, jsonRpcId(value.id), value.params);
      return;
    }
    const id = jsonRpcId(value.id);
    if (id === undefined) {
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(id);
    if (value.error !== undefined) {
      const err = isRecord(value.error) ? JSON.stringify(value.error) : "acp error";
      pending.reject(new Error(err));
      return;
    }
    pending.resolve(value.result ?? {});
  }

  private onAgentRequest(method: string, id: JsonRpcId | undefined, params: unknown): void {
    if (method === "session/update") {
      this.onSessionUpdate(params);
      return;
    }
    if (id === undefined) {
      return;
    }
    try {
      if (method === "session/request_permission") {
        this.reply(id, { outcome: { outcome: "selected", optionId: permissionOptionId(params) } });
        return;
      }
      if (method === "fs/read_text_file") {
        this.reply(id, { content: this.readTextFile(params) });
        return;
      }
      if (method === "fs/write_text_file") {
        this.writeTextFile(params);
        this.reply(id, null);
        return;
      }
      if (method === "terminal/create") {
        this.reply(id, { terminalId: this.createTerminal(params) });
        return;
      }
      if (method === "terminal/output") {
        this.reply(id, this.terminalOutput(params));
        return;
      }
      if (method === "terminal/wait_for_exit") {
        void this.waitForExit(id, params);
        return;
      }
      if (method === "terminal/kill") {
        this.killTerminal(params, false);
        this.reply(id, {});
        return;
      }
      if (method === "terminal/release") {
        this.killTerminal(params, true);
        this.reply(id, {});
        return;
      }
      if (method === "elicitation/create") {
        this.reply(id, { action: "cancel" });
        return;
      }
      if (method.startsWith("_") || method.startsWith("x.ai/")) {
        this.reply(id, {});
        return;
      }
      this.replyError(id, `method not found: ${method}`, -32601);
    } catch (err) {
      const message = err instanceof Error ? err.message : "acp client error";
      this.replyError(id, message);
    }
  }

  private readTextFile(params: unknown): string {
    if (!isRecord(params)) {
      throw new Error("fs/read_text_file missing params");
    }
    const path = readString(params.path);
    if (path === undefined) {
      throw new Error("fs/read_text_file missing path");
    }
    if (isSecretPath(path)) {
      throw new Error("refused");
    }
    let text = readFileSync(path, "utf8");
    const line = readNumber(params.line);
    const limit = readNumber(params.limit);
    if (line !== undefined || limit !== undefined) {
      const lines = text.split("\n");
      const start = Math.max(0, (line ?? 1) - 1);
      const end = limit !== undefined ? start + limit : lines.length;
      text = lines.slice(start, end).join("\n");
    }
    return text;
  }

  private writeTextFile(params: unknown): void {
    if (!isRecord(params)) {
      throw new Error("fs/write_text_file missing params");
    }
    const path = readString(params.path);
    const content = readString(params.content) ?? "";
    if (path === undefined) {
      throw new Error("fs/write_text_file missing path");
    }
    if (isSecretPath(path)) {
      throw new Error("refused");
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  private createTerminal(params: unknown): string {
    if (!isRecord(params)) {
      throw new Error("terminal/create missing params");
    }
    const command = readString(params.command);
    if (command === undefined || command.length === 0) {
      throw new Error("terminal/create missing command");
    }
    const args = Array.isArray(params.args)
      ? params.args.filter((a): a is string => typeof a === "string")
      : [];
    const cwd = readString(params.cwd) ?? process.cwd();
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (Array.isArray(params.env)) {
      for (const item of params.env) {
        if (isRecord(item)) {
          const name = readString(item.name);
          const value = readString(item.value);
          if (name !== undefined && value !== undefined) {
            env[name] = value;
          }
        }
      }
    }
    const byteLimit = readNumber(params.outputByteLimit) ?? 1_048_576;
    const child =
      args.length === 0
        ? spawn("/bin/bash", ["-lc", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
        : spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", (err) => {
      process.stderr.write(`[acp] terminal spawn error: ${err.message}\n`);
    });
    this.termSeq += 1;
    const terminalId = `term_${this.termSeq}`;
    const term: Term = {
      child,
      output: "",
      truncated: false,
      exitCode: null,
      signal: null,
      byteLimit,
    };
    const append = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      term.output += text;
      if (term.output.length > byteLimit) {
        term.output = term.output.slice(term.output.length - byteLimit);
        term.truncated = true;
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("close", (code, signal) => {
      term.exitCode = code;
      term.signal = signal;
    });
    this.terminals.set(terminalId, term);
    process.stderr.write(`[acp] terminal ${terminalId} ${command} ${args.join(" ")}\n`);
    return terminalId;
  }

  private getTerm(params: unknown): Term {
    if (!isRecord(params)) {
      throw new Error("terminal missing params");
    }
    const terminalId = readString(params.terminalId);
    if (terminalId === undefined) {
      throw new Error("terminal missing terminalId");
    }
    const term = this.terminals.get(terminalId);
    if (term === undefined) {
      throw new Error(`unknown terminal ${terminalId}`);
    }
    return term;
  }

  private terminalOutput(params: unknown): unknown {
    const term = this.getTerm(params);
    const result: Record<string, unknown> = {
      output: term.output,
      truncated: term.truncated,
    };
    if (term.exitCode !== null || term.signal !== null) {
      result.exitStatus = { exitCode: term.exitCode, signal: term.signal };
    }
    return result;
  }

  private async waitForExit(id: JsonRpcId, params: unknown): Promise<void> {
    try {
      const term = this.getTerm(params);
      if (term.exitCode === null && term.signal === null) {
        await new Promise<void>((resolve) => {
          term.child.once("close", () => {
            resolve();
          });
        });
      }
      this.reply(id, { exitCode: term.exitCode, signal: term.signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : "terminal wait failed";
      this.replyError(id, message);
    }
  }

  private killTerminal(params: unknown, release: boolean): void {
    if (!isRecord(params)) {
      throw new Error("terminal missing params");
    }
    const terminalId = readString(params.terminalId);
    if (terminalId === undefined) {
      throw new Error("terminal missing terminalId");
    }
    const term = this.terminals.get(terminalId);
    if (term === undefined) {
      return;
    }
    if (!term.child.killed) {
      term.child.kill("SIGTERM");
    }
    if (release) {
      this.terminals.delete(terminalId);
    }
  }

  private onSessionUpdate(params: unknown): void {
    if (!isRecord(params)) {
      return;
    }
    const update = params.update;
    if (!isRecord(update)) {
      return;
    }
    const kind = readString(update.sessionUpdate);
    if (kind === "tool_call" || kind === "tool_call_update") {
      const title = readString(update.title) ?? readString(update.toolCallId) ?? "";
      process.stderr.write(`[acp] ${kind} ${title}\n`);
    }
    if (kind !== "agent_message_chunk") {
      return;
    }
    const content = update.content;
    if (!isRecord(content)) {
      return;
    }
    const text = readString(content.text);
    if (text !== undefined) {
      this.agentText += text;
    }
  }
}

function permissionOptionId(params: unknown): string {
  if (!isRecord(params) || !Array.isArray(params.options)) {
    return "allow-once";
  }
  const ids: string[] = [];
  for (const item of params.options) {
    if (isRecord(item)) {
      const id = readString(item.optionId) ?? readString(item.id);
      if (id !== undefined) {
        ids.push(id);
      }
    }
  }
  const prefer = ["allow_always", "allow-always", "allow-once", "allow_once"];
  for (const id of prefer) {
    if (ids.includes(id)) {
      return id;
    }
  }
  return ids[0] ?? "allow-once";
}

export function authMethodId(init: unknown): string | undefined {
  if (!isRecord(init)) {
    return "cached_token";
  }
  const methods = init.authMethods;
  const ids = new Set<string>();
  if (Array.isArray(methods)) {
    for (const item of methods) {
      if (isRecord(item)) {
        const id = readString(item.id);
        if (id !== undefined) {
          ids.add(id);
        }
      }
    }
  }
  if (ids.size === 0) {
    return undefined;
  }
  if (process.env.XAI_API_KEY !== undefined && process.env.XAI_API_KEY.length > 0 && ids.has("xai.api_key")) {
    return "xai.api_key";
  }
  if (ids.has("cached_token")) {
    return "cached_token";
  }
  const first = [...ids][0];
  return first;
}
