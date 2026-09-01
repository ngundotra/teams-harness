/**
 * Minimal TOML parser for harness.toml (keys, strings, bools, ints,
 * arrays, inline tables, [tables]). Not a full TOML 1.1 implementation.
 */
export function parseToml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let table: Record<string, unknown> = root;
  const logical = joinMultiline(text.split(/\r?\n/));
  for (const item of logical) {
    const line = item.text;
    if (line.startsWith("[") && line.endsWith("]") && !line.includes("=")) {
      const name = line.slice(1, -1).trim();
      if (name.length === 0) {
        throw new Error(`toml: empty table name on line ${item.line}`);
      }
      table = ensureTable(root, name.split("."));
      continue;
    }
    const eq = splitKeyValue(line);
    if (eq === undefined) {
      throw new Error(`toml: expected key = value on line ${item.line}`);
    }
    const value = parseValue(eq.value);
    assign(table, eq.key, value);
  }
  return root;
}

function joinMultiline(lines: string[]): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let buf = "";
  let startLine = 1;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripComment(lines[i] ?? "");
    const piece = stripped.trim();
    if (piece.length === 0 && buf.length === 0) {
      continue;
    }
    if (buf.length === 0) {
      startLine = i + 1;
    }
    buf = buf.length === 0 ? piece : `${buf} ${piece}`;
    for (let c = 0; c < piece.length; c += 1) {
      const ch = piece[c];
      if (ch === '"' && piece[c - 1] !== "\\") {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (ch === "[" || ch === "{") {
        depth += 1;
      } else if (ch === "]" || ch === "}") {
        depth -= 1;
      }
    }
    if (depth <= 0 && !inString) {
      out.push({ text: buf, line: startLine });
      buf = "";
      depth = 0;
    }
  }
  if (buf.length > 0) {
    throw new Error("toml: unterminated value");
  }
  return out;
}

function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== "\\") {
      inString = !inString;
      continue;
    }
    if (ch === "#" && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitKeyValue(line: string): { key: string; value: string } | undefined {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== "\\") {
      inString = !inString;
      continue;
    }
    if (ch === "=" && !inString) {
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (key.length === 0) {
        return undefined;
      }
      return { key: unquoteKey(key), value };
    }
  }
  return undefined;
}

function unquoteKey(key: string): string {
  if (key.startsWith('"') && key.endsWith('"') && key.length >= 2) {
    return JSON.parse(key) as string;
  }
  return key;
}

function ensureTable(root: Record<string, unknown>, parts: string[]): Record<string, unknown> {
  let cur = root;
  for (const part of parts) {
    if (part.length === 0) {
      throw new Error("toml: empty table path segment");
    }
    const existing = cur[part];
    if (existing === undefined) {
      const next: Record<string, unknown> = {};
      cur[part] = next;
      cur = next;
      continue;
    }
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      throw new Error(`toml: cannot open table ${parts.join(".")}`);
    }
    cur = existing as Record<string, unknown>;
  }
  return cur;
}

function assign(table: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  if (parts.length === 1) {
    table[key] = value;
    return;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) {
    throw new Error("toml: empty key");
  }
  const parent = ensureTable(table, parts.slice(0, -1));
  parent[last] = value;
}

function parseValue(raw: string): unknown {
  if (raw.length === 0) {
    throw new Error("toml: missing value");
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw.startsWith('"')) {
    return parseBasicString(raw);
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith("[")) {
    return parseArray(raw);
  }
  if (raw.startsWith("{")) {
    return parseInlineTable(raw);
  }
  if (/^-?\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  if (/^-?\d+\.\d+$/.test(raw)) {
    return Number.parseFloat(raw);
  }
  throw new Error(`toml: unsupported value ${raw}`);
}

function parseBasicString(raw: string): string {
  if (!raw.endsWith('"') || raw.length < 2) {
    throw new Error("toml: unterminated string");
  }
  try {
    return JSON.parse(raw) as string;
  } catch {
    throw new Error("toml: invalid string");
  }
}

function parseArray(raw: string): unknown[] {
  if (!raw.endsWith("]")) {
    throw new Error("toml: unterminated array");
  }
  const inner = raw.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }
  const items: unknown[] = [];
  for (const item of splitTopLevel(inner, ",")) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    items.push(parseValue(trimmed));
  }
  return items;
}

function parseInlineTable(raw: string): Record<string, unknown> {
  if (!raw.endsWith("}")) {
    throw new Error("toml: unterminated inline table");
  }
  const inner = raw.slice(1, -1).trim();
  const out: Record<string, unknown> = {};
  if (inner.length === 0) {
    return out;
  }
  for (const item of splitTopLevel(inner, ",")) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const kv = splitKeyValue(trimmed);
    if (kv === undefined) {
      throw new Error(`toml: invalid inline table entry ${trimmed}`);
    }
    out[kv.key] = parseValue(kv.value);
  }
  return out;
}

function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== "\\") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "]" || ch === "}") {
      depth -= 1;
      continue;
    }
    if (ch === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}
