import { createHttpServer, createRuntime, listen } from "./app.js";
import { applyDeployToEnv, loadDeployConfig } from "./deployConfig.js";

async function main(): Promise<void> {
  const deploy = loadDeployConfig();
  applyDeployToEnv(deploy);
  const port = deploy.port;
  const skipAuth = deploy.skipAuth;
  const runtime = createRuntime(deploy);
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
