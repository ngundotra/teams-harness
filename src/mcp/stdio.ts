import { Readable, Writable } from "node:stream";
import { isRecord, readNumber, readString } from "../types.js";

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export function encodeContentLength(obj: unknown): Buffer {
  const json = JSON.stringify(obj);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")]);
}

export function encodeNdjson(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

export function writeContentLength(stream: Writable, obj: unknown): void {
  stream.write(encodeContentLength(obj));
}

export function writeNdjson(stream: Writable, obj: unknown): void {
  stream.write(encodeNdjson(obj));
}

export function parseJsonRpc(value: unknown): JsonRpcRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const method = readString(value.method);
  if (method === undefined) {
    return undefined;
  }
  const msg: JsonRpcRequest = { jsonrpc: "2.0", method };
  if (value.id !== undefined && (typeof value.id === "string" || typeof value.id === "number")) {
    msg.id = value.id;
  }
  if (value.params !== undefined) {
    msg.params = value.params;
  }
  return msg;
}

/**
 * Dual reader: official MCP Content-Length framing, plus NDJSON fallback.
 */
export function attachJsonRpcReader(
  stream: Readable,
  onMessage: (value: unknown) => void,
): void {
  let buf = Buffer.alloc(0);
  stream.on("data", (chunk: Buffer | string) => {
    const next = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    buf = Buffer.concat([buf, next]);
    buf = Buffer.from(drain(buf, onMessage));
  });
}

function drain(buf: Buffer, onMessage: (value: unknown) => void): Buffer {
  while (buf.length > 0) {
    const asText = buf.toString("utf8");
    const clMatch = /^(?:[^\r\n]*\r\n)*Content-Length:\s*(\d+)\r\n\r\n/i.exec(asText);
    if (clMatch !== null && clMatch[1] !== undefined && clMatch.index === 0) {
      const n = Number.parseInt(clMatch[1], 10);
      const headerBytes = Buffer.byteLength(clMatch[0], "utf8");
      if (buf.length < headerBytes + n) {
        return buf;
      }
      const body = buf.subarray(headerBytes, headerBytes + n).toString("utf8");
      buf = buf.subarray(headerBytes + n);
      const parsed: unknown = JSON.parse(body);
      onMessage(parsed);
      continue;
    }
    const nl = buf.indexOf(0x0a);
    if (nl === -1) {
      return buf;
    }
    const line = buf.subarray(0, nl).toString("utf8").replace(/\r$/, "");
    buf = buf.subarray(nl + 1);
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.toLowerCase().startsWith("content-length:")) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      onMessage(parsed);
    } catch {
      // ignore non-json chatter
    }
  }
  return buf;
}

export function readId(value: unknown): JsonRpcId | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

export function readStopReason(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return readString(value.stopReason);
}

export function readSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return readString(value.sessionId);
}

export { readNumber };
