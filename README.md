# teams-harness

Bot Framework webhook inbound plus grok CLI worker plus MCP-only Graph-shaped Teams ops.

Local proof is Microsoft 365 Agents Playground on port 56150.
The node test runner is not local-done.

## Architecture

- **Inbound:** Bot Framework activity webhook POST /api/messages on port 3978 (default). Immediate ack Working on it before grok is ready. Not Microsoft Graph.
- **Worker:** grok CLI agent over stdio with always-approve. The host never spawns a tsx harness worker. Grok has no Graph credentials.
- **Outbound Teams ops:** MCP only. Graph-shaped Work IQ tool names mcp_graph_chat_* and mcp_graph_teams_* over generic MCP servers teams-read / teams-post. Do not hardcode a tenant Work IQ URL.
- **Graph-backed MCP:** When GRAPH_TOKEN or client credentials (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID) are set, MCP tools call Microsoft Graph. Otherwise they fall back to the in-process playground mock.
- **Channel watch (optional):** polls MCP listChannelMessages when HARNESS_TEAM_ID and HARNESS_CHANNEL_ID are set. Still MCP, not a Graph SDK.
- **Local verify UI:** Microsoft 365 Agents Playground on port 56150 pointed at http://localhost:3978/api/messages.

## Setup

Requires Node 20+ and grok on PATH (~/.grok/bin or ~/.local/bin).

Auth is the grok CLI cache or XAI_API_KEY in the environment. Never commit auth.json or .env.

Commands:
- install
- run dev (HTTP on :3978)
- run playground
- agentsplayground endpoint localhost:3978/api/messages channel msteams port 56150

Open http://127.0.0.1:56150 -- that UI is the receipt that counts.

## Verification

The node test runner is not local-done. Unit and loop coverage helps; it does not ship the product.

Done = 10 playground loops in Agents Playground at port 56150 against the harness on :3978, with screenshot receipts:

1. Personal: first message, immediate ack, grok spawned, eyes seen-cursor, final MCP post.
2. Personal: follow-up during the job, injected, no second grok.
3. Personal: messageReaction keyed by replyToId / target messageId.
4. Personal: grok setReaction recorded as Work IQ MCP mcp_graph_chat_setReaction.
5. Personal: final reply lists original, follow-ups, per-message reactions.
6. Group chat: same long-turn plus MCP post (not a channel thread).
7. Channel: thread reply stays in-thread mcp_graph_teams_replyToChannelMessage.
8. Channel: follow-up injected mid-turn, same destination.
9. Channel: intra-thread reaction via MCP mcp_graph_teams_setReaction.
10. Channel: injected extra plus final reply in the same thread.

Keep the Playground window at http://127.0.0.1:56150 as the receipt. Passing unit tests without those 10 loops is not a ship receipt.

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

Without GRAPH_TOKEN or client credentials, MCP tools use the playground mock fallback.

## License

MIT
