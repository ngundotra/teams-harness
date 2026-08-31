import { isRecord } from "./types.js";

export function parseJsonLine(line: string): unknown {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(trimmed);
  return parsed;
}

export function parseJsonObject(line: string): Record<string, unknown> | undefined {
  const parsed = parseJsonLine(line);
  if (!isRecord(parsed)) {
    return undefined;
  }
  return parsed;
}
