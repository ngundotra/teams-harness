import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runtime } from "../src/app.js";

export function isolatedTurnsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "teams-harness-"));
  process.env.TURNS_DIR = dir;
  return dir;
}

export function isEyesEmoji(emoji: string): boolean {
  const n = emoji.trim().toLowerCase();
  return n === "eyes" || n === "eye" || n.includes("eyes") || emoji.includes("👀");
}

export function isStarEmoji(emoji: string): boolean {
  const n = emoji.trim().toLowerCase();
  return n === "star" || n.includes("star") || emoji.includes("⭐") || emoji.includes("★");
}

export function toolsDump(runtime: Runtime): string {
  return JSON.stringify(runtime.mcp.toolsInvoked);
}

export async function waitForEyes(runtime: Runtime, messageId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const eyes = runtime.mcp.setReactions.find((r) => isEyesEmoji(r.emoji) && r.messageId === messageId);
    if (eyes !== undefined) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`eyes not recorded on ${messageId}; toolsInvoked=${toolsDump(runtime)}`);
}

export function messageActivity(args: {
  id: string;
  text: string;
  conversationId?: string;
  fromId?: string;
  conversationType?: string;
  serviceUrl?: string;
  replyToId?: string;
}): Record<string, unknown> {
  const activity: Record<string, unknown> = {
    type: "message",
    id: args.id,
    text: args.text,
    serviceUrl: args.serviceUrl ?? "",
    from: { id: args.fromId ?? "user-1" },
    conversation: {
      id: args.conversationId ?? "conv-1",
      conversationType: args.conversationType ?? "personal",
    },
  };
  if (args.replyToId !== undefined) {
    activity.replyToId = args.replyToId;
  }
  return activity;
}

export function reactionActivity(args: {
  replyToId: string;
  emoji?: string;
  action?: "add" | "remove";
  conversationId?: string;
  fromId?: string;
  serviceUrl?: string;
}): Record<string, unknown> {
  const emoji = args.emoji ?? "like";
  const action = args.action ?? "add";
  return {
    type: "messageReaction",
    id: `rxn-${args.replyToId}`,
    replyToId: args.replyToId,
    serviceUrl: args.serviceUrl ?? "",
    from: { id: args.fromId ?? "user-1" },
    conversation: {
      id: args.conversationId ?? "conv-1",
      conversationType: "personal",
    },
    ...(action === "add"
      ? { reactionsAdded: [{ type: emoji }] }
      : { reactionsRemoved: [{ type: emoji }] }),
  };
}
