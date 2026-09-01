# Group respond

Same contract as loop 1, but the left rail is **Group Chat**. Grok still writes through `mcp_graph_chat_postMessage` (group is a chat Surface, not a channel thread).

## Sub-features

- `grp-open` opens Group Chat from the left rail.
- `grp-compose` uses the bottom `Type a message...` composer and paper-plane.
- `grp-ack` shows `👀 <probe>` and `Working on it...`.
- `grp-content` later bubble starts with `original text:` and repeats the probe.

## How to get to it (user POV)

- `http://localhost:56150/` one tab.
- Click **Group Chat**.
- Type in the bottom composer. Send with the paper-plane or Enter.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. `read_policy` = `surface`. `runningTurns` is 0.
- You are in Group Chat, not Personal Chat and not General.

- **Open group.** Click **Group Chat**. Placeholder `Type a message...`.
- **Send probe.** Type `pg-grp-1 <nonce> ping`. Click the paper-plane.
- **Ack.** `👀 pg-grp-1 <nonce> ping` and `Working on it...`.
- **Content pass.** Later bubble `original text: pg-grp-1 <nonce> ping` (or starts with `original text:` and contains the probe).
- **State pass.** `sent[]` has that text. `toolsInvoked` includes `mcp_graph_chat_postMessage` (not `mcp_graph_teams_postChannelMessage`).
- **Proof.** `receipts/verify-teams-harness/04-group-respond/playground.png` (rail shows Group Chat) + `debug-state.json`.

## Gotchas

- Group Chat looks like Personal Chat. If the screenshot rail says Personal Chat, you drove loop 1.
- Channel tools (`mcp_graph_teams_*` post/reply) on this loop are a fail — group is a chat Surface.
- Same ack-vs-content rule as loop 1. Grok 15–45s.
