# Thread replies stay in-thread

The user replies **under** an existing General root post (the loop-7 post or a fresh root created the same way). The bot must stay in that thread: grok content with `original text:` of the **reply** text, no new root post in General.

## Sub-features

- `th-open` opens the thread pane for a known root post.
- `th-reply-compose` types in the thread pane `Type a message...` (not Start a new post).
- `th-same-thread` grok content lands in that pane, not as a sibling root.
- `th-key` `conversationKey` stays `channelId;messageid=<root post id>`.

## How to get to it (user POV)

- **My Team** → **General**.
- Open the thread on the loop-7 post (or a new root you just created with **Start a new post** and whose turn is already done).
- Type in the thread pane `Type a message...`. Send with that pane's paper-plane.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. A finished root post exists in General (drive loop 7 first if needed, wait until `runningTurns` is 0).
- You are typing in the **thread pane**, not **Start a new post**.

- **Open thread.** Click the loop-7 (or new) root post so the thread pane is open.
- **Reply.** Type `pg-ch-8 <nonce> ping` in the thread pane `Type a message...`. Send.
- **Ack.** A 👀 chip on the reply + `Working on it...` stay in that thread. No `👀 pg-ch-8 <nonce> ping` bubble and no leftover 👀 `<p>` row inside the root `fui-Card`.
- **Content pass.** Later `original text: pg-ch-8 <nonce> ping` stays in that same thread. General does **not** gain a new root with that grok text.
- **State pass.** `sent[]` `replyToId` is the root's `;messageid=` suffix. `toolsInvoked` includes `mcp_graph_teams_replyToChannelMessage`. No extra root `mcp_graph_teams_postChannelMessage` for the grok report.
- **Proof.** `receipts/verify-teams-harness/08-thread-replies-stay-in-thread/playground.png` (thread pane + both user reply and grok bubble) + `debug-state.json`.

## Gotchas

- Mixing composers invalidates the loop. If you clicked **Start a new post**, you drove loop 7 again.
- Mid-turn inject is loop 9. This loop starts when no turn is running on that thread.
- Playground in-thread display needs `replyToId` = the numeric `;messageid=` suffix. A missing `replyToId` on `sent[]` is a fail even if MCP recorded a reply.
- Visible 👀 prefix-copy bubbles (including extra `<p>` rows in the root `fui-Card`) are a fail.
