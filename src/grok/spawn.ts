import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const GROK_BIN = "grok";
export const GROK_ACP_ARGS = ["--no-auto-update", "--disallowed-tools", "search_tool,Agent,run_terminal_command", "agent", "--always-approve", "stdio"] as const;

function grokDirIfPresent(dir: string): string[] {
  return existsSync(join(dir, "grok")) ? [dir] : [];
}

export function pathWithLocalGrok(env: NodeJS.ProcessEnv): string {
  const current = env.PATH ?? process.env.PATH ?? "";
  const home = env.HOME ?? process.env.HOME ?? homedir();
  const prefix = [
    ...grokDirIfPresent(join(home, ".grok", "bin")),
    ...grokDirIfPresent(join(home, ".local", "bin")),
  ];
  return [...prefix, current].join(":");
}

export function spawnGrok(env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(GROK_BIN, [...GROK_ACP_ARGS], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...env, PATH: pathWithLocalGrok(env), GROK_SUBAGENTS: "0" },
  });
  child.on("error", (err) => {
    process.stderr.write(`[host] grok spawn: ${err.message}\n`);
  });
  return child;
}
