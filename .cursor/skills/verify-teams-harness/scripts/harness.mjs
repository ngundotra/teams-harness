#!/usr/bin/env node
/**
 * verify-teams-harness helper: doctor | launch | cleanup
 *
 * Never shims grok. Never treats npm test as a receipt.
 * Proof still requires Agents Playground at http://localhost:56150/.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(skillRoot, "../../..");
const runDir = "/tmp/verify-teams-harness";
const runFile = join(runDir, "run.json");
const grokBin = join(homedir(), ".grok", "bin", "grok");
const healthUrl = "http://localhost:3978/health";
const playgroundUrl = "http://localhost:56150/";
const MACHINE_GATE =
  "MACHINE GATE: real grok is required at $HOME/.grok/bin/grok. Cloud VMs often lack it (ENOENT). Proof runs on a machine with grok + Agents Playground. Do not shim grok. Do not treat npm test as the receipt. Do not fake a Playground screenshot.";

function die(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function repoOk() {
  const pkgPath = join(repoRoot, "package.json");
  if (!existsSync(pkgPath)) {
    die(1, `doctor: no package.json at ${repoRoot}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.name !== "teams-harness") {
    die(1, `doctor: expected package name teams-harness, got ${pkg.name}`);
  }
  if (!existsSync(join(repoRoot, "harness.toml"))) {
    die(1, "doctor: harness.toml missing at repo root");
  }
  if (!existsSync(join(repoRoot, "scripts", "ungate-playground.mjs"))) {
    die(1, "doctor: scripts/ungate-playground.mjs missing");
  }
}

function readPolicy() {
  const text = readFileSync(join(repoRoot, "harness.toml"), "utf8");
  const m = text.match(/^\s*read_policy\s*=\s*"([^"]+)"/m);
  return m?.[1] ?? "(unset)";
}

function checkGrok() {
  if (!existsSync(grokBin)) {
    die(2, MACHINE_GATE);
  }
  const st = statSync(grokBin);
  if (!st.isFile()) {
    die(2, `${MACHINE_GATE}\n(${grokBin} is not a file)`);
  }
  const inRepo = resolve(grokBin).startsWith(repoRoot + "/") || resolve(grokBin) === repoRoot;
  if (inRepo) {
    die(2, `${MACHINE_GATE}\n(grok must not live inside this repo — shim refused)`);
  }
  try {
    execFileSync(grokBin, ["--version"], { stdio: ["ignore", "pipe", "pipe"], timeout: 8000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      die(2, MACHINE_GATE);
    }
    // --version may be unsupported; executable + not-ENOENT is enough
  }
  process.stdout.write(`doctor: grok ok ${grokBin}\n`);
}

function playgroundPkgRoot() {
  const require = createRequire(join(repoRoot, "package.json"));
  try {
    return dirname(require.resolve("@microsoft/m365agentsplayground/package.json"));
  } catch {
    return undefined;
  }
}

function checkUngate() {
  const restylePath = join(repoRoot, "scripts", "pg-restyle.js");
  if (!existsSync(restylePath)) {
    die(1, "doctor: scripts/pg-restyle.js missing — product must include PR 4 playground shim");
  }
  const restyle = readFileSync(restylePath, "utf8");
  if (!restyle.includes("display:none") || !restyle.includes("data-pg-reactcopy")) {
    die(1, "doctor: pg-restyle.js must hide prefix-copy bubbles (display:none on data-pg-reactcopy)");
  }
  const ungateSrc = readFileSync(join(repoRoot, "scripts", "ungate-playground.mjs"), "utf8");
  if (!ungateSrc.includes("pg-restyle.js")) {
    die(1, "doctor: ungate-playground.mjs must inject scripts/pg-restyle.js");
  }
  if (!restyle.includes('querySelectorAll("p")') || !restyle.includes("fui-Card")) {
    process.stdout.write(
      "doctor: warn pg-restyle.js lacks nested <p>/fui-Card hide (PR 5). In-thread mid-turn 👀 leftovers may still show.\n",
    );
  }
  const pkgRoot = playgroundPkgRoot();
  if (pkgRoot === undefined) {
    die(1, "doctor: @microsoft/m365agentsplayground not installed (npm install)");
  }
  const dist = join(pkgRoot, "dist", "index.js");
  const html = join(pkgRoot, "dist", "client", "index.html");
  if (!existsSync(dist) || !existsSync(html)) {
    die(1, `doctor: playground dist missing under ${pkgRoot}`);
  }
  const server = readFileSync(dist, "utf8");
  const page = readFileSync(html, "utf8");
  const mentionOff = server.includes(
    "(afterAll=()=>this.messageConnector.sendCreateMessageActivity(message).catch((()=>{})))",
  );
  const gatedStill = server.includes(
    "(isPersonalChat||isBotMentioned)&&(afterAll=()=>this.messageConnector.sendCreateMessageActivity(message).catch((()=>{})))",
  );
  const reactionAccepted = server.includes('z.literal("messageReaction")') || server.includes('activity.type==="messageReaction"');
  const chipBoot = page.includes("pg-chip-boot") && page.includes("__pgRestyle");
  const hidesCopies = page.includes("data-pg-reactcopy") && page.includes("display:none");
  if (gatedStill) {
    die(1, "doctor: mention-gate still on — run node scripts/ungate-playground.mjs");
  }
  if (!mentionOff) {
    process.stdout.write("doctor: warn mention-gate pattern not found (package may have drifted)\n");
  }
  if (!reactionAccepted) {
    die(1, "doctor: messageReaction not accepted — run node scripts/ungate-playground.mjs");
  }
  if (!chipBoot || !hidesCopies) {
    die(1, "doctor: pg-restyle.js not injected (need pg-chip-boot + __pgRestyle + hidden copies) — run node scripts/ungate-playground.mjs");
  }
  process.stdout.write(`doctor: ungate+pg-restyle ok ${pkgRoot}\n`);
}

async function httpJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function checkHealth(requireUp) {
  try {
    const { status, body } = await httpJson(healthUrl);
    if (status !== 200 || !body || body.ok !== true) {
      die(1, `doctor: ${healthUrl} not ok status=${status} body=${JSON.stringify(body)}`);
    }
    process.stdout.write(`doctor: health ok runningTurns=${body.runningTurns} harnessSpawns=${body.harnessSpawns}\n`);
    return true;
  } catch (err) {
    if (requireUp) {
      const msg = err instanceof Error ? err.message : String(err);
      die(1, `doctor: harness not answering ${healthUrl} (${msg})`);
    }
    process.stdout.write("doctor: harness not up (ok before launch)\n");
    return false;
  }
}

async function checkPlayground(requireUp) {
  try {
    const res = await fetch(playgroundUrl);
    if (!res.ok) {
      die(1, `doctor: ${playgroundUrl} status ${res.status}`);
    }
    process.stdout.write(`doctor: playground ok ${playgroundUrl}\n`);
    return true;
  } catch (err) {
    if (requireUp) {
      const msg = err instanceof Error ? err.message : String(err);
      die(1, `doctor: playground not answering ${playgroundUrl} (${msg})`);
    }
    process.stdout.write("doctor: playground not up (ok before launch)\n");
    return false;
  }
}

function readRun() {
  if (!existsSync(runFile)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(runFile, "utf8"));
  } catch {
    return undefined;
  }
}

function pidAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function whoOwns(port) {
  const out = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  if (out.status !== 0) {
    return undefined;
  }
  const line = (out.stdout ?? "").split("\n").find((l) => l.includes(`:${port} `) || l.includes(`:${port}\n`));
  return line;
}

async function doctor(args) {
  repoOk();
  const coverage = args.includes("--coverage");
  process.stdout.write(`doctor: repo ${repoRoot}\n`);
  process.stdout.write(`doctor: read_policy=${readPolicy()} (loops 1-10 expect surface)\n`);
  process.stdout.write("doctor: receipt is Playground UI + GET /debug/state — npm test is not the receipt\n");
  checkGrok();
  if (!existsSync(join(repoRoot, "node_modules", "tsx"))) {
    die(1, "doctor: node_modules missing — npm install");
  }
  checkUngate();
  const run = readRun();
  const harnessUp = await checkHealth(false);
  const playgroundUp = await checkPlayground(false);
  if (harnessUp && run?.harnessPid && !pidAlive(run.harnessPid)) {
    die(3, "doctor: :3978 is up but the pid we launched is dead — refuse to double-drive. cleanup or identify the owner.");
  }
  if (playgroundUp && run?.playgroundPid && !pidAlive(run.playgroundPid)) {
    die(3, "doctor: :56150 is up but the pid we launched is dead — one tab / one owner. cleanup or identify the owner.");
  }
  if (!harnessUp) {
    const owner = whoOwns(3978);
    if (owner) {
      process.stdout.write(`doctor: port 3978 in use by unknown: ${owner.trim()}\n`);
    }
  }
  if (coverage) {
    process.stdout.write("doctor: running npm test as coverage only — this is NOT a receipt\n");
    const test = spawnSync("npm", ["test"], { cwd: repoRoot, stdio: "inherit", env: process.env });
    if (test.status !== 0) {
      die(1, "doctor: npm test failed (coverage). Still not a Playground receipt.");
    }
    process.stdout.write("doctor: coverage ok. Still need Playground screenshots for a pass.\n");
  }
  if (harnessUp && playgroundUp) {
    process.stdout.write("doctor: instance worth driving. Open http://localhost:56150/ — one tab, not 127.0.0.1.\n");
  } else {
    process.stdout.write("doctor: grok+ungate ok; run launch next, then drive a feature file.\n");
  }
}

function waitHttp(url, timeoutMs, pred) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(url)
        .then(async (res) => {
          if (pred !== undefined) {
            const body = await res.json().catch(() => undefined);
            if (res.ok && pred(body)) {
              resolve();
              return;
            }
          } else if (res.ok) {
            resolve();
            return;
          }
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`timeout waiting for ${url}`));
            return;
          }
          setTimeout(tick, 250);
        })
        .catch(() => {
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`timeout waiting for ${url}`));
            return;
          }
          setTimeout(tick, 250);
        });
    };
    tick();
  });
}

function spawnLogged(cmd, cmdArgs, logName) {
  mkdirSync(runDir, { recursive: true });
  const log = join(runDir, logName);
  const fd = writeFileSync(log, "");
  void fd;
  const out = spawn(cmd, cmdArgs, {
    cwd: repoRoot,
    env: { ...process.env, PATH: `${join(homedir(), ".grok", "bin")}:${process.env.PATH ?? ""}` },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stream = (chunk) => {
    writeFileSync(log, chunk, { flag: "a" });
  };
  out.stdout?.on("data", stream);
  out.stderr?.on("data", stream);
  out.unref();
  return { pid: out.pid, log };
}

async function launch() {
  repoOk();
  checkGrok();
  const existing = readRun();
  if (existing && (pidAlive(existing.harnessPid) || pidAlive(existing.playgroundPid))) {
    die(3, "launch: a verify run is already recorded and alive. Drive that instance or cleanup first.");
  }
  const healthNow = await checkHealth(false);
  const playNow = await checkPlayground(false);
  if (healthNow || playNow) {
    die(3, "launch: :3978 or :56150 already answering but not owned by this helper. Refuse to double-drive.");
  }
  if (!existsSync(join(repoRoot, "node_modules", "tsx"))) {
    die(1, "launch: node_modules missing — npm install");
  }
  const ungate = spawnSync(process.execPath, [join(repoRoot, "scripts", "ungate-playground.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (ungate.status !== 0) {
    die(1, "launch: ungate-playground.mjs failed");
  }
  const tsx = join(repoRoot, "node_modules", ".bin", "tsx");
  const harness = spawnLogged(tsx, [join(repoRoot, "src", "index.ts")], "harness.log");
  const playgroundBin = join(repoRoot, "node_modules", ".bin", "agentsplayground");
  if (!existsSync(playgroundBin)) {
    die(1, "launch: agentsplayground bin missing — npm install");
  }
  const playground = spawnLogged(
    playgroundBin,
    ["-e", "http://localhost:3978/api/messages", "-c", "msteams", "-p", "56150"],
    "playground.log",
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    runFile,
    JSON.stringify(
      {
        harnessPid: harness.pid,
        playgroundPid: playground.pid,
        startedAt: new Date().toISOString(),
        repoRoot,
        healthUrl,
        playgroundUrl,
      },
      null,
      2,
    ),
  );
  try {
    await waitHttp(healthUrl, 20000, (body) => body && body.ok === true);
    await waitHttp(playgroundUrl, 30000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`launch: ${msg}\n`);
    cleanupPids(harness.pid, playground.pid);
    rmSync(runFile, { force: true });
    die(1, "launch failed; pids we started were killed. receipts untouched.");
  }
  process.stdout.write(`launch: harness pid=${harness.pid} ${healthUrl}\n`);
  process.stdout.write(`launch: playground pid=${playground.pid} ${playgroundUrl}\n`);
  process.stdout.write("launch: open http://localhost:56150/ — one tab. Then drive features/01-dm-respond.md\n");
}

function cleanupPids(...pids) {
  for (const pid of pids) {
    if (!pidAlive(pid)) {
      continue;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (pids.every((p) => !pidAlive(p))) {
      return;
    }
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 100)"], { timeout: 500 });
  }
  for (const pid of pids) {
    if (pidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
  }
}

function cleanup() {
  const run = readRun();
  if (run === undefined) {
    process.stdout.write("cleanup: no run.json — nothing this helper started. receipts left in place.\n");
    return;
  }
  cleanupPids(run.harnessPid, run.playgroundPid);
  rmSync(runFile, { force: true });
  process.stdout.write("cleanup: killed recorded pids. receipts/verify-teams-harness/ was not deleted.\n");
}

const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === "doctor") {
  await doctor(args.slice(1));
} else if (cmd === "launch") {
  await launch();
} else if (cmd === "cleanup") {
  cleanup();
} else {
  die(
    1,
    "usage: node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor [--coverage] | launch | cleanup",
  );
}
