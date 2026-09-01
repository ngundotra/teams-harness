import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseToml } from "./toml.js";
import { isRecord, readBoolean, readNumber, readString } from "./types.js";

export type ReadChannel = { teamId: string; channelId: string };

/**
 * Discriminated read policy. thread-only cannot carry channels (type + parse).
 * Do not represent this as dataPlane: boolean plus optional allowlist.
 */
export type ReadPolicy =
  | { kind: "thread-only" }
  | { kind: "surface" }
  | { kind: "allowlist"; channels: readonly [ReadChannel, ...ReadChannel[]] };

export type DeployFeatures = {
  readRecentThreads: boolean;
};

export type DeployConfig = {
  readPolicy: ReadPolicy;
  features: DeployFeatures;
  port: number;
  skipAuth: boolean;
  jobMs?: number;
  acpTimeoutMs?: number;
  turnsDir: string;
  teamId?: string;
  channelId?: string;
  botId?: string;
  serviceUrl?: string;
  channelPollMs?: number;
};

export type DeployParseError = Error & { code: "DEPLOY_CONFIG" };

function deployError(message: string): DeployParseError {
  const err = new Error(message) as DeployParseError;
  err.code = "DEPLOY_CONFIG";
  return err;
}

const DEFAULT_PORT = 3978;
const DEFAULT_TURNS_DIR = "/tmp/turns";

export function defaultDeployConfig(): DeployConfig {
  return {
    readPolicy: { kind: "surface" },
    features: { readRecentThreads: false },
    port: DEFAULT_PORT,
    skipAuth: true,
    turnsDir: DEFAULT_TURNS_DIR,
  };
}

export function parseReadPolicy(
  kind: string,
  channels: readonly ReadChannel[] | undefined,
): ReadPolicy {
  if (kind === "thread-only") {
    if (channels !== undefined && channels.length > 0) {
      throw deployError("read_policy = \"thread-only\" cannot carry read_channels");
    }
    return { kind: "thread-only" };
  }
  if (kind === "surface") {
    if (channels !== undefined && channels.length > 0) {
      throw deployError("read_policy = \"surface\" cannot carry read_channels");
    }
    return { kind: "surface" };
  }
  if (kind === "allowlist") {
    if (channels === undefined || channels.length === 0) {
      throw deployError("read_policy = \"allowlist\" requires a nonempty read_channels");
    }
    const first = channels[0];
    if (first === undefined) {
      throw deployError("read_policy = \"allowlist\" requires a nonempty read_channels");
    }
    return { kind: "allowlist", channels: [first, ...channels.slice(1)] };
  }
  throw deployError(`invalid read_policy ${JSON.stringify(kind)}`);
}

function parseChannels(value: unknown): ReadChannel[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw deployError("read_channels must be an array of { team, channel }");
  }
  const out: ReadChannel[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw deployError("read_channels entry must be a table");
    }
    const teamId = readString(item.team) ?? readString(item.teamId);
    const channelId = readString(item.channel) ?? readString(item.channelId);
    if (teamId === undefined || teamId.length === 0 || channelId === undefined || channelId.length === 0) {
      throw deployError("read_channels entry requires team and channel");
    }
    out.push({ teamId, channelId });
  }
  return out;
}

export function parseDeployToml(text: string): DeployConfig {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid toml";
    throw deployError(message);
  }
  const policyKind = readString(raw.read_policy) ?? "surface";
  const channelsPresent = raw.read_channels !== undefined;
  const channels = channelsPresent ? parseChannels(raw.read_channels) : undefined;
  if (policyKind === "thread-only" && channelsPresent) {
    throw deployError("read_policy = \"thread-only\" cannot carry read_channels");
  }
  const readPolicy = parseReadPolicy(policyKind, channels);

  const featuresRaw = isRecord(raw.features) ? raw.features : {};
  const readRecentThreads = readBoolean(featuresRaw.read_recent_threads) ?? false;

  const config: DeployConfig = {
    readPolicy,
    features: { readRecentThreads },
    port: readNumber(raw.port) ?? DEFAULT_PORT,
    skipAuth: readBoolean(raw.skip_auth) ?? true,
    turnsDir: readString(raw.turns_dir) ?? DEFAULT_TURNS_DIR,
  };
  const jobMs = readNumber(raw.job_ms) ?? readNumber(raw.harness_job_ms);
  if (jobMs !== undefined) {
    config.jobMs = jobMs;
  }
  const acpTimeoutMs = readNumber(raw.acp_timeout_ms) ?? readNumber(raw.harness_acp_timeout_ms);
  if (acpTimeoutMs !== undefined) {
    config.acpTimeoutMs = acpTimeoutMs;
  }
  const teamId = readString(raw.team_id) ?? readString(raw.harness_team_id);
  if (teamId !== undefined && teamId.length > 0) {
    config.teamId = teamId;
  }
  const channelId = readString(raw.channel_id) ?? readString(raw.harness_channel_id);
  if (channelId !== undefined && channelId.length > 0) {
    config.channelId = channelId;
  }
  const botId = readString(raw.bot_id) ?? readString(raw.harness_bot_id);
  if (botId !== undefined && botId.length > 0) {
    config.botId = botId;
  }
  const serviceUrl = readString(raw.service_url) ?? readString(raw.harness_service_url);
  if (serviceUrl !== undefined && serviceUrl.length > 0) {
    config.serviceUrl = serviceUrl;
  }
  const channelPollMs = readNumber(raw.channel_poll_ms) ?? readNumber(raw.harness_channel_poll_ms);
  if (channelPollMs !== undefined) {
    config.channelPollMs = channelPollMs;
  }
  return config;
}

function envNonEmpty(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  return raw;
}

function parseEnvChannels(raw: string): ReadChannel[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw deployError("HARNESS_READ_CHANNELS is not valid JSON");
    }
    return parseChannels(parsed);
  }
  const out: ReadChannel[] = [];
  for (const part of trimmed.split(",")) {
    const item = part.trim();
    if (item.length === 0) {
      continue;
    }
    const sep = item.includes(":") ? ":" : "/";
    const i = item.indexOf(sep);
    if (i <= 0 || i === item.length - 1) {
      throw deployError("HARNESS_READ_CHANNELS entries must be team:channel");
    }
    out.push({ teamId: item.slice(0, i), channelId: item.slice(i + 1) });
  }
  return out;
}

export function applyEnvOverrides(base: DeployConfig, env: NodeJS.ProcessEnv = process.env): DeployConfig {
  let policyKind: string = base.readPolicy.kind;
  let channels: readonly ReadChannel[] | undefined =
    base.readPolicy.kind === "allowlist" ? base.readPolicy.channels : undefined;
  const envPolicy = envNonEmpty(env, "HARNESS_READ_POLICY");
  if (envPolicy !== undefined) {
    policyKind = envPolicy;
    if (policyKind === "thread-only" || policyKind === "surface") {
      channels = undefined;
    }
  }
  const envChannels = envNonEmpty(env, "HARNESS_READ_CHANNELS");
  if (envChannels !== undefined) {
    channels = parseEnvChannels(envChannels);
  }
  const readPolicy = parseReadPolicy(policyKind, channels);

  const envRecent = envNonEmpty(env, "HARNESS_READ_RECENT_THREADS");
  const readRecentThreads =
    envRecent !== undefined ? envRecent === "true" || envRecent === "1" : base.features.readRecentThreads;

  const next: DeployConfig = {
    readPolicy,
    features: { readRecentThreads },
    port: parsePositiveInt(envNonEmpty(env, "PORT")) ?? base.port,
    skipAuth: env.TEAMS_SKIP_AUTH !== undefined ? env.TEAMS_SKIP_AUTH !== "false" : base.skipAuth,
    turnsDir: envNonEmpty(env, "TURNS_DIR") ?? base.turnsDir,
  };
  const jobMs = parsePositiveInt(envNonEmpty(env, "HARNESS_JOB_MS")) ?? base.jobMs;
  if (jobMs !== undefined) {
    next.jobMs = jobMs;
  }
  const acpTimeoutMs = parsePositiveInt(envNonEmpty(env, "HARNESS_ACP_TIMEOUT_MS")) ?? base.acpTimeoutMs;
  if (acpTimeoutMs !== undefined) {
    next.acpTimeoutMs = acpTimeoutMs;
  }
  const teamId = envNonEmpty(env, "HARNESS_TEAM_ID") ?? base.teamId;
  if (teamId !== undefined) {
    next.teamId = teamId;
  }
  const channelId = envNonEmpty(env, "HARNESS_CHANNEL_ID") ?? base.channelId;
  if (channelId !== undefined) {
    next.channelId = channelId;
  }
  const botId = envNonEmpty(env, "HARNESS_BOT_ID") ?? base.botId;
  if (botId !== undefined) {
    next.botId = botId;
  }
  const serviceUrl = envNonEmpty(env, "HARNESS_SERVICE_URL") ?? base.serviceUrl;
  if (serviceUrl !== undefined) {
    next.serviceUrl = serviceUrl;
  }
  const channelPollMs = parsePositiveInt(envNonEmpty(env, "HARNESS_CHANNEL_POLL_MS")) ?? base.channelPollMs;
  if (channelPollMs !== undefined) {
    next.channelPollMs = channelPollMs;
  }
  return next;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function resolveHarnessTomlPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return envNonEmpty(env, "HARNESS_TOML") ?? resolve(cwd, "harness.toml");
}

export function loadDeployConfig(args?: {
  tomlPath?: string;
  tomlText?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): DeployConfig {
  const env = args?.env ?? process.env;
  const cwd = args?.cwd ?? process.cwd();
  let base = defaultDeployConfig();
  if (args?.tomlText !== undefined) {
    base = parseDeployToml(args.tomlText);
  } else {
    const path = args?.tomlPath ?? resolveHarnessTomlPath(env, cwd);
    if (existsSync(path)) {
      base = parseDeployToml(readFileSync(path, "utf8"));
    }
  }
  return applyEnvOverrides(base, env);
}

/** Fill process.env from TOML when the env var is unset (channel watch still reads env). */
export function applyDeployToEnv(config: DeployConfig, env: NodeJS.ProcessEnv = process.env): void {
  setIfAbsent(env, "PORT", String(config.port));
  setIfAbsent(env, "TURNS_DIR", config.turnsDir);
  if (config.jobMs !== undefined) {
    setIfAbsent(env, "HARNESS_JOB_MS", String(config.jobMs));
  }
  if (config.acpTimeoutMs !== undefined) {
    setIfAbsent(env, "HARNESS_ACP_TIMEOUT_MS", String(config.acpTimeoutMs));
  }
  if (config.teamId !== undefined) {
    setIfAbsent(env, "HARNESS_TEAM_ID", config.teamId);
  }
  if (config.channelId !== undefined) {
    setIfAbsent(env, "HARNESS_CHANNEL_ID", config.channelId);
  }
  if (config.botId !== undefined) {
    setIfAbsent(env, "HARNESS_BOT_ID", config.botId);
  }
  if (config.serviceUrl !== undefined) {
    setIfAbsent(env, "HARNESS_SERVICE_URL", config.serviceUrl);
  }
  if (config.channelPollMs !== undefined) {
    setIfAbsent(env, "HARNESS_CHANNEL_POLL_MS", String(config.channelPollMs));
  }
  if (env.TEAMS_SKIP_AUTH === undefined) {
    env.TEAMS_SKIP_AUTH = config.skipAuth ? "true" : "false";
  }
}

function setIfAbsent(env: NodeJS.ProcessEnv, name: string, value: string): void {
  const current = env[name];
  if (current === undefined || current.length === 0) {
    env[name] = value;
  }
}
