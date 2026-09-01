# teams-harness

Bot Framework webhook inbound. grok CLI worker. MCP-only Graph-shaped Teams ops.

Local proof is Microsoft 365 Agents Playground at http://localhost:56150/. npm test is not local-done.

Use localhost, not 127.0.0.1. Two tabs of the same playground origin break compose.

## Architecture

- Inbound: Bot Framework POST /api/messages on :3978. Ack Working on it immediately. Not Graph.
- Worker: real grok CLI (grok agent --always-approve stdio). No grok shim.
- Outbound: MCP only. Tool names mcp_graph_chat_* and mcp_graph_teams_*. teams-post is bound to this turn's Surface. teams-read tools are derived from Surface + ReadPolicy at deploy time (thread-only drops listChannelMessages). Do not call Graph from the bot process.
- Graph-backed MCP: GRAPH_TOKEN or GRAPH_CLIENT_ID + GRAPH_CLIENT_SECRET + GRAPH_TENANT_ID. Unset token uses the in-process playground mock. Graph REST lives inside MCP, not a second control plane.
- Channel watch (optional): MCP listChannelMessages when HARNESS_TEAM_ID and HARNESS_CHANNEL_ID are set.

## Setup

Node 20+ and grok on PATH (~/.grok/bin or ~/.local/bin).

Auth is the grok CLI cache or XAI_API_KEY. Never commit auth.json or .env.

    npm install
    # edit harness.toml (read_policy, features, port, …)
    npm run dev

Playground (ungates compose + reaction copies, then starts the harness):

    npm run playground

or:

    agentsplayground -e http://localhost:3978/api/messages -c msteams -p 56150

Open http://localhost:56150/  one tab.

## Verification

The node runner is coverage. It is not the receipt.

Done = ten playground loops against the harness on :3978, each with a screenshot of the Playground UI (not a log line, not npm test). Track them in a Notion table with two properties:

- Loop (title)
- Status (yes / not yet)

No in-progress select. Put the receipt note (unique probe text, screenshot path) on the page body when it flips to yes.

The ten loops:

1. DM. bot responds
2. DM. mid-turn follow-ups
3. DM. react intra-turn
4. Group. bot responds
5. Group. mid-turn follow-ups
6. Group. react intra-turn
7. Channel. respond to new posts
8. Channel. thread replies stay in-thread
9. Channel. read follow-up replies intra-turn
10. Channel. set reactions in thread

How to run them:

- DM / group: type in the bottom composer, Enter.
- Channel new post: top Start a new post, then Post. The thread box under an existing post is a reply, not a new post.
- Mid-turn (2, 5, 9, and the star loops): send the follow-up while Working on it is still showing. Waiting until the grok report lands starts a new turn.
- Pass is a grok content bubble (original text, follow-ups listed, or a visible star copy). Eyes and Working on it are acks only.
- Playground cannot render reaction chips. The harness posts a copy of the target (eyes prefix / star prefix). Visible star copy is the react pass.

Keep one playground tab. Passing unit tests without those ten screenshots is not a ship receipt.

**Status:** not yet. This change was not driven through the playground; do not treat unit tests as the receipt.

## harness.toml

Deployments are configured by `harness.toml` (or `HARNESS_TOML`). The file is parsed at process start into `DeployConfig`. Env may override for tests; TOML is the deploy source of truth. Do not put secrets in the file.

```toml
# thread-only | surface | allowlist
read_policy = "surface"

# Required nonempty iff read_policy = "allowlist".
# thread-only and surface must not set this — parse fails if they do.
# read_channels = [
#   { team = "19:team-id@thread.tacv2", channel = "19:channel-id@thread.tacv2" },
# ]

[features]
# When true and policy is not thread-only, advertise mcp_graph_teams_listRecentThreads
# for the current channel (and allowlisted channels). Off = tool absent.
read_recent_threads = false

port = 3978
skip_auth = true
turns_dir = "/tmp/turns"
```

ReadPolicy is a discriminated union, not `dataPlane: boolean` plus an optional allowlist:

- `thread-only` — data plane off. teams-read may list/get **this thread only** (`listChannelMessageReplies` for the bound `threadId`). No `listChannelMessages` on the parent channel. No other chats/channels. A nonempty `read_channels` is a parse error.
- `surface` — read this DM, group, or channel, including recent threads in this channel when the feature is on.
- `allowlist` — `read_channels` required and nonempty. Read those channels (plus this surface).

Each turn lives on one Surface: `{ kind: "dm", chatId }`, `{ kind: "group", chatId }`, or `{ kind: "thread", teamId, channelId, threadId }`. A new channel root post opens a thread surface (`threadId` = that post id). Replies in that thread enqueue on the same turn. The start prompt includes the Surface so grok knows which thread it is in.

## Environment

All optional except grok auth.

- PORT default 3978
- HARNESS_TOML path to harness.toml (default ./harness.toml)
- HARNESS_READ_POLICY thread-only | surface | allowlist (overrides TOML)
- HARNESS_READ_CHANNELS team:channel,... or JSON (allowlist override)
- HARNESS_READ_RECENT_THREADS true | false
- TEAMS_SKIP_AUTH skip Bot Framework auth locally (default on)
- HARNESS_JOB_MS job window
- HARNESS_ACP_TIMEOUT_MS grok ACP timeout
- TURNS_DIR default /tmp/turns
- HARNESS_TEAM_ID and HARNESS_CHANNEL_ID enable channel watch (MCP poll)
- HARNESS_BOT_ID bot identity for mock posts
- HARNESS_SERVICE_URL Bot Framework connector base
- HARNESS_CHANNEL_POLL_MS channel watch interval
- GRAPH_TOKEN static Graph access token; if set, MCP tools hit Graph
- GRAPH_CLIENT_ID GRAPH_CLIENT_SECRET GRAPH_TENANT_ID client-credentials Graph auth when GRAPH_TOKEN is unset
- XAI_API_KEY grok ACP if offered; do not commit

Without Graph creds, MCP tools use the playground mock.

## Python ACP handoff

`python/` is a library-only port of the grok ACP handoff (spawn, session/new + teams-read/teams-post, start prompt, mid-turn `session/prompt` inject, inbox+drain backup, injectWaits). It does not replace the TypeScript Bot Framework process.

```bash
cd python && python3 -m pip install -e '.[dev]' && python3 -m pytest
```

## License

MIT
