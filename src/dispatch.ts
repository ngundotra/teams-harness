import { parseActivity, parseReactionAll } from "./parseActivity.js";
import type { HarnessHost } from "./harnessHost.js";
import type { DispatchResult, InboundEvent } from "./types.js";

export function dispatchEvent(host: HarnessHost, event: InboundEvent): DispatchResult {
  switch (event.kind) {
    case "message": {
      const running = host.store.getRunning(event.conversationKey);
      if (running !== undefined) {
        host.enqueueFollowup(running.turnId, event);
        return { kind: "enqueued", turnId: running.turnId };
      }
      const started = host.startTurn(event);
      return { kind: "started", turnId: started.turnId };
    }
    case "reaction": {
      const running = host.store.getRunning(event.conversationKey);
      if (running === undefined) {
        return { kind: "dropped", reason: "no running turn for reaction" };
      }
      host.ferryReaction(running.turnId, event);
      return { kind: "ferried", turnId: running.turnId };
    }
    case "ignored": {
      return { kind: "ignored", reason: event.reason };
    }
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function dispatchActivity(host: HarnessHost, body: unknown): DispatchResult[] {
  const parsed = parseActivity(body);
  if (parsed.kind === "error") {
    return [{ kind: "dropped", reason: parsed.message }];
  }
  if (parsed.event.kind === "reaction") {
    const all = parseReactionAll(body);
    return all.map((event) => dispatchEvent(host, event));
  }
  return [dispatchEvent(host, parsed.event)];
}
