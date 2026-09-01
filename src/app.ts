import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ChannelWatcher, createChannelWatcher } from "./channelWatch.js";
import type { DeployConfig } from "./deployConfig.js";
import { defaultDeployConfig } from "./deployConfig.js";
import { dispatchActivity } from "./dispatch.js";
import { HarnessHost } from "./harnessHost.js";
import { MockTeamsMcp, type SentMessage } from "./mockMcp.js";
import { TurnStore } from "./turnStore.js";
import { reactionCopyText } from "./seenCursor.js";
import { isRecord, readString, type MessageId } from "./types.js";

export type Runtime = {
  store: TurnStore;
  mcp: MockTeamsMcp;
  host: HarnessHost;
  channelWatch: ChannelWatcher;
};

export function createRuntime(deploy?: DeployConfig): Runtime {
  const store = new TurnStore();
  const mcp = new MockTeamsMcp();
  const host = new HarnessHost({ store, mcp, deploy: deploy ?? defaultDeployConfig() });
  mcp.attachOutbound({
    ack: async (args) => {
      await postConnector(args.serviceUrl, args.conversationId, { type: "typing" });
      await postConnector(args.serviceUrl, args.conversationId, {
        type: "message",
        text: args.text,
      });
    },
    sendMessage: async (sent: SentMessage) => {
      await postConnector(sent.serviceUrl, sent.conversationId, {
        type: "message",
        text: sent.text,
        ...(sent.replyToId !== undefined ? { replyToId: sent.replyToId } : {}),
      });
    },
    setReaction: async (args: {
      conversationId: string;
      serviceUrl: string;
      messageId: MessageId;
      emoji: string;
      text?: string;
      replyToId?: MessageId;
    }) => {
      // playground cannot render reaction chips; post a copy of the target text
      await postConnector(args.serviceUrl, args.conversationId, {
        type: "message",
        text: reactionCopyText(
          args.text !== undefined ? { emoji: args.emoji, text: args.text } : { emoji: args.emoji },
        ),
        ...(args.replyToId !== undefined ? { replyToId: args.replyToId } : {}),
      });
    },
    unsetReaction: async () => {
      // playground cannot render chips; unset stays host-side
    },
  });
  const channelWatch = createChannelWatcher(host);
  host.onDispose(() => {
    channelWatch.stop();
  });
  if (channelWatch.hasTarget()) {
    channelWatch.start();
  }
  return { store, mcp, host, channelWatch };
}

async function postConnector(
  serviceUrl: string,
  conversationId: string,
  activity: Record<string, unknown>,
): Promise<void> {
  if (serviceUrl.length === 0) {
    return;
  }
  const base = serviceUrl.endsWith("/") ? serviceUrl.slice(0, -1) : serviceUrl;
  const url = `${base}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(activity),
    });
  } catch {
    // playground / tests without a connector still keep MCP records
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        const parsed: unknown = JSON.parse(text);
        resolve(parsed);
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function createHttpServer(runtime: Runtime): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttp(runtime, req, res);
  });
}

async function handleHttp(
  runtime: Runtime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? "/";
  if (req.method === "GET" && (url === "/health" || url.startsWith("/health?"))) {
    writeJson(res, 200, {
      ok: true,
      runningTurns: runtime.store.runningCount(),
      harnessSpawns: runtime.store.getSpawnCount(),
    });
    return;
  }
  if (req.method === "POST" && (url === "/internal/mcp-applied" || url.startsWith("/internal/mcp-applied?"))) {
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      writeJson(res, 400, { error: "invalid json" });
      return;
    }
    await runtime.mcp.applyFromCallback(body);
    writeJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && (url === "/debug/state" || url.startsWith("/debug/state?"))) {
    writeJson(res, 200, {
      acks: runtime.host.acks,
      harnessSpawns: runtime.store.getSpawnCount(),
      runningTurns: runtime.store.runningCount(),
      toolsInvoked: runtime.mcp.toolsInvoked,
      sent: runtime.mcp.sent,
      setReactions: runtime.mcp.setReactions,
    });
    return;
  }
  if (req.method === "POST" && (url === "/api/messages" || url.startsWith("/api/messages?"))) {
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      writeJson(res, 400, { error: "invalid json" });
      return;
    }
    const results = dispatchActivity(runtime.host, body);
    const started = results.find((r) => r.kind === "started");
    const type = isRecord(body) ? readString(body.type) : undefined;
    if (type === "message" && started !== undefined) {
      // inbound webhook ack window — Bot Framework activity, not Graph
    }
    writeJson(res, 200, {
      ack: type === "message" ? "Working on it…" : "ok",
      results,
      runningTurns: runtime.store.runningCount(),
      harnessSpawns: runtime.store.getSpawnCount(),
      turnId: started !== undefined && started.kind === "started" ? started.turnId : undefined,
    });
    return;
  }
  writeJson(res, 404, { error: "not found" });
}

export function listen(server: Server, port: number, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address();
      if (addr !== null && typeof addr === "object") {
        resolve(addr.port);
        return;
      }
      resolve(port);
    });
    server.on("error", reject);
  });
}
