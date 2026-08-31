import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ConversationKey,
  type TurnId,
  type TurnRunning,
  type TurnState,
  brandConversationKey,
  brandTurnId,
  isRecord,
  readNumber,
  readString,
} from "./types.js";

export function turnsRoot(): string {
  return process.env.TURNS_DIR ?? "/tmp/turns";
}

export class TurnStore {
  private readonly byKey = new Map<string, TurnState>();
  private readonly byId = new Map<string, TurnState>();
  private spawnCount = 0;

  getSpawnCount(): number {
    return this.spawnCount;
  }

  incrementSpawn(): void {
    this.spawnCount += 1;
  }

  getRunning(key: ConversationKey): TurnRunning | undefined {
    const current = this.byKey.get(key);
    if (current !== undefined && current.kind === "running") {
      return current;
    }
    return undefined;
  }

  getById(turnId: TurnId): TurnState | undefined {
    return this.byId.get(turnId);
  }

  runningCount(): number {
    let n = 0;
    for (const state of this.byKey.values()) {
      if (state.kind === "running") {
        n += 1;
      }
    }
    return n;
  }

  put(state: TurnState): void {
    this.byKey.set(state.conversationKey, state);
    this.byId.set(state.turnId, state);
    persistTurn(state);
  }

  markDone(turnId: TurnId, finalReply?: string): TurnState | undefined {
    const current = this.byId.get(turnId);
    if (current === undefined || current.kind !== "running") {
      return current;
    }
    const done: TurnState = {
      kind: "done",
      turnId: current.turnId,
      conversationKey: current.conversationKey,
      startMessage: current.startMessage,
      followups: current.followups,
      inboundReactions: current.inboundReactions,
      setReactions: current.setReactions,
    };
    if (finalReply !== undefined) {
      done.finalReply = finalReply;
    }
    this.put(done);
    return done;
  }
}

function persistTurn(state: TurnState): void {
  const dir = join(turnsRoot(), state.turnId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

export function loadPersistedTurn(turnId: TurnId): unknown {
  const path = join(turnsRoot(), turnId, "state.json");
  if (!existsSync(path)) {
    return undefined;
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return raw;
}

export function newTurnId(key: ConversationKey): TurnId {
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 48);
  return brandTurnId(`trn_${safe}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`);
}

export function rehydrateKey(value: string): ConversationKey {
  return brandConversationKey(value);
}

export function rehydrateTurnId(value: string): TurnId {
  return brandTurnId(value);
}

export function readPersistedPid(raw: unknown): number | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  return readNumber(raw.pid);
}

export function readPersistedKind(raw: unknown): string | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  return readString(raw.kind);
}
