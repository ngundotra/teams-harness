import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEnvOverrides,
  parseDeployToml,
  parseReadPolicy,
} from "../src/deployConfig.js";

test("parses thread-only TOML without channels", () => {
  const cfg = parseDeployToml(`
read_policy = "thread-only"

[features]
read_recent_threads = false
`);
  assert.deepEqual(cfg.readPolicy, { kind: "thread-only" });
  assert.equal(cfg.features.readRecentThreads, false);
});

test("parses surface TOML with existing knobs", () => {
  const cfg = parseDeployToml(`
read_policy = "surface"
port = 4000
skip_auth = true
turns_dir = "/tmp/turns-toml"
job_ms = 9000

[features]
read_recent_threads = true
`);
  assert.deepEqual(cfg.readPolicy, { kind: "surface" });
  assert.equal(cfg.features.readRecentThreads, true);
  assert.equal(cfg.port, 4000);
  assert.equal(cfg.turnsDir, "/tmp/turns-toml");
  assert.equal(cfg.jobMs, 9000);
});

test("parses allowlist TOML with nonempty channels", () => {
  const cfg = parseDeployToml(`
read_policy = "allowlist"
read_channels = [
  { team = "19:team-a@thread.tacv2", channel = "19:chan-a@thread.tacv2" },
  { team = "19:team-b@thread.tacv2", channel = "19:chan-b@thread.tacv2" },
]
`);
  assert.equal(cfg.readPolicy.kind, "allowlist");
  if (cfg.readPolicy.kind !== "allowlist") {
    return;
  }
  assert.equal(cfg.readPolicy.channels.length, 2);
  assert.equal(cfg.readPolicy.channels[0]?.teamId, "19:team-a@thread.tacv2");
  assert.equal(cfg.readPolicy.channels[0]?.channelId, "19:chan-a@thread.tacv2");
});

test("allowlist without channels fails", () => {
  assert.throws(
    () => parseDeployToml(`read_policy = "allowlist"`),
    /nonempty read_channels/,
  );
  assert.throws(
    () => parseDeployToml(`
read_policy = "allowlist"
read_channels = []
`),
    /nonempty read_channels/,
  );
});

test("thread-only cannot carry channels", () => {
  assert.throws(
    () =>
      parseDeployToml(`
read_policy = "thread-only"
read_channels = [
  { team = "t", channel = "c" },
]
`),
    /cannot carry read_channels/,
  );
  assert.throws(
    () => parseReadPolicy("thread-only", [{ teamId: "t", channelId: "c" }]),
    /cannot carry read_channels/,
  );
});

test("env overrides TOML for tests", () => {
  const base = parseDeployToml(`read_policy = "surface"`);
  const over = applyEnvOverrides(base, {
    HARNESS_READ_POLICY: "thread-only",
    HARNESS_READ_RECENT_THREADS: "true",
    PORT: "4123",
  });
  assert.deepEqual(over.readPolicy, { kind: "thread-only" });
  assert.equal(over.features.readRecentThreads, true);
  assert.equal(over.port, 4123);
});
