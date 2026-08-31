# teams-harness

Bot Framework webhook inbound. grok CLI worker. MCP-only Graph-shaped Teams ops.

Local proof is Microsoft 365 Agents Playground at http://localhost:56150/. npm test is not local-done.

Use localhost, not 127.0.0.1. Two tabs of the same playground origin break compose.

## Architecture

- Inbound: Bot Framework POST /api/messages on :3978. Ack Working on it immediately. Not Graph.
- Worker: real grok CLI (grok agent --always-approve stdio). No grok shim.
- Outbound: MCP only. Tool names mcp_graph_chat_* and mcp_graph_teams_* on teams-read (channel-wide) and teams-post (thread-bound). Do not call Graph from the bot process.
- Graph-backed MCP: GRAPH_TOKEN or GRAPH_CLIENT_ID + GRAPH_CLIENT_SECRET + GRAPH_TENANT_ID. Unset token uses the in-process playground mock. Graph REST lives inside MCP, not a second control plane.
- Channel watch (optional): MCP listChannelMessages when HARNESS_TEAM_ID and HARNESS_CHANNEL_ID are set.

## Setup

Node 20+ and grok on PATH (~/.grok/bin or ~/.local/bin).

Auth is the grok CLI cache or XAI_API_KEY. Never commit auth.json or .env.

    npm install
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

## Environment

All optional except grok auth.

- PORT default 3978
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

## License

MIT
