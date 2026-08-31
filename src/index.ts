import { createHttpServer, createRuntime, listen } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3978", 10);
const skipAuth = process.env.TEAMS_SKIP_AUTH !== "false";

async function main(): Promise<void> {
  const runtime = createRuntime();
  const server = createHttpServer(runtime);
  const bound = await listen(server, port, "0.0.0.0");
  const callback = `http://127.0.0.1:${bound}/internal/mcp-applied`;
  runtime.host.callbackUrl = callback;
  if (runtime.channelWatch.hasTarget()) {
    runtime.channelWatch.start();
    console.log("Channel watcher polling MCP listChannelMessages");
  }
  console.log(`Harness HTTP skipAuth=${skipAuth} on http://127.0.0.1:${bound}/api/messages`);
  console.log("Playground: agentsplayground -e http://localhost:3978/api/messages -c msteams");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "startup failed";
  console.error(message);
  process.exit(1);
});
