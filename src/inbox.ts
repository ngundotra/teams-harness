import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonLine } from "./jsonl.js";
import { turnsRoot } from "./turnStore.js";
import {
  type InboxItem,
  type TurnId,
  brandMessageId,
  isRecord,
  readString,
} from "./types.js";
import { parseInboundMessage } from "./inboundParse.js";

export function turnDir(turnId: TurnId): string {
  return join(turnsRoot(), turnId);
}

export function inboxPath(turnId: TurnId): string {
  return join(turnDir(turnId), "inbox.jsonl");
}

export function cursorPath(turnId: TurnId): string {
  return join(turnDir(turnId), "inbox.cursor");
}

export function mcpReadyPath(turnId: TurnId): string {
  return join(turnDir(turnId), "mcp-ready");
}

export function mcpReadyRolePath(turnId: TurnId, role: "read" | "write"): string {
  return join(turnDir(turnId), `mcp-ready-${role}`);
}

export function mcpCallsPath(turnId: TurnId): string {
  return join(turnDir(turnId), "mcp-calls.jsonl");
}

export function ensureTurnDir(turnId: TurnId): string {
  const dir = turnDir(turnId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function appendInbox(turnId: TurnId, item: InboxItem): void {
  ensureTurnDir(turnId);
  appendFileSync(inboxPath(turnId), `${JSON.stringify(item)}\n`, "utf8");
}

export function readCursor(turnId: TurnId): number {
  const path = cursorPath(turnId);
  if (!existsSync(path)) {
    return 0;
  }
  const raw = readFileSync(path, "utf8").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function writeCursor(turnId: TurnId, value: number): void {
  ensureTurnDir(turnId);
  writeFileSync(cursorPath(turnId), `${value}\n`, "utf8");
}

export function parseInboxItem(value: unknown): InboxItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = readString(value.kind);
  if (kind === "followup") {
    return { kind: "followup", message: parseInboundMessage(value.message) };
  }
  if (kind === "reaction") {
    const messageId = readString(value.messageId);
    const emoji = readString(value.emoji);
    const action = readString(value.action);
    const fromId = readString(value.fromId);
    if (messageId === undefined || emoji === undefined || fromId === undefined) {
      return undefined;
    }
    if (action !== "add" && action !== "remove") {
      return undefined;
    }
    return {
      kind: "reaction",
      messageId: brandMessageId(messageId),
      emoji,
      action,
      fromId,
    };
  }
  return undefined;
}

export function readInboxLines(turnId: TurnId): InboxItem[] {
  const path = inboxPath(turnId);
  if (!existsSync(path)) {
    return [];
  }
  const items: InboxItem[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const raw = parseJsonLine(line);
    if (raw === undefined) {
      continue;
    }
    const item = parseInboxItem(raw);
    if (item !== undefined) {
      items.push(item);
    }
  }
  return items;
}

export function pendingInboxCount(turnId: TurnId): number {
  const items = readInboxLines(turnId);
  const cursor = readCursor(turnId);
  return Math.max(0, items.length - cursor);
}

export function drainInbox(turnId: TurnId): InboxItem[] {
  const items = readInboxLines(turnId);
  const cursor = readCursor(turnId);
  const next = items.slice(cursor);
  writeCursor(turnId, items.length);
  return next;
}

export function appendMcpCall(turnId: TurnId, record: unknown): void {
  ensureTurnDir(turnId);
  appendFileSync(mcpCallsPath(turnId), `${JSON.stringify(record)}\n`, "utf8");
}

export function readMcpCalls(turnId: TurnId): unknown[] {
  const path = mcpCallsPath(turnId);
  if (!existsSync(path)) {
    return [];
  }
  const out: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const raw = parseJsonLine(line);
    if (raw !== undefined) {
      out.push(raw);
    }
  }
  return out;
}
