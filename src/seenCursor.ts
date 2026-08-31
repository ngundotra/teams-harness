import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureTurnDir, turnDir } from "./inbox.js";
import type { TurnId } from "./types.js";

export const SEEN_EMOJI = "eyes";

export type SeenStep = {
  unset?: string;
  set: string;
};

export function seenPath(turnId: TurnId): string {
  return join(turnDir(turnId), "seen.messageId");
}

export function readSeenMessageId(turnId: TurnId): string | undefined {
  const path = seenPath(turnId);
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = readFileSync(path, "utf8").trim();
  return raw.length > 0 ? raw : undefined;
}

export function writeSeenMessageId(turnId: TurnId, messageId: string): void {
  ensureTurnDir(turnId);
  writeFileSync(seenPath(turnId), `${messageId}\n`, "utf8");
}

/**
 * Walk the seen-cursor forward over `ids` (inbox order).
 * If `prev` is already in `ids`, skip until that item, then continue.
 * If `prev` is not in `ids`, treat it as the current eyes and move off it.
 */
export function seenWalk(prev: string | undefined, ids: string[]): SeenStep[] {
  const steps: SeenStep[] = [];
  const prevInBatch = prev !== undefined && ids.includes(prev);
  let current = prev;
  let passed = prev === undefined || !prevInBatch;
  for (const id of ids) {
    if (id === current) {
      passed = true;
      continue;
    }
    if (!passed) {
      continue;
    }
    const step: SeenStep = { set: id };
    if (current !== undefined && current !== id) {
      step.unset = current;
    }
    steps.push(step);
    current = id;
    passed = true;
  }
  return steps;
}

export function displayReaction(emoji: string): string {
  const n = emoji.trim().toLowerCase();
  if (n === "eyes" || n === "eye") {
    return "👀";
  }
  if (n === "star") {
    return "⭐";
  }
  return emoji;
}

export function reactionCopyText(args: { emoji: string; text?: string }): string {
  const mark = displayReaction(args.emoji);
  const copy = args.text?.trim() ?? "";
  if (copy.length === 0) {
    return mark;
  }
  return `${mark} ${copy}`;
}
