# Channel new post

A user creates a **new root post** in My Team → General. The harness opens a thread Surface (`threadId` = that post id). Grok replies **in that thread** with `original text:` via `mcp_graph_teams_replyToChannelMessage` (channel write is thread-bound). Using the thread composer instead of **Start a new post** invalidates this loop.

## Sub-features

- `ch-open` opens **My Team** → **General**.
- `ch-root-compose` uses **Start a new post** then **Post** (not the thread pane).
- `ch-ack` shows `👀 <probe>` and `Working on it...` on that post's thread.
- `ch-content` later in-thread bubble starts with `original text:` and repeats the probe.

## How to get to it (user POV)

- `http://localhost:56150/` one tab.
- Left rail **My Team**, then channel **General**.
- Click **Start a new post**, type, click **Post**.
- Do not type in a thread pane under an older post.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. `read_policy` = `surface`.
- You can see **Start a new post** at the top of General. If you only see `Type a message...` in a thread pane, you are in the wrong composer.

- **Open channel.** Click **My Team** → **General**.
- **New root.** Click **Start a new post**. Type `pg-ch-1 <nonce> ping`. Click **Post**.
- **Ack.** `👀 pg-ch-1 <nonce> ping` and `Working on it...` appear on that post (thread Surface). `conversationKey` is `channelId;messageid=<that post id>`.
- **Content pass.** Later bubble **in the same thread** starts with `original text:` and contains `pg-ch-1 <nonce> ping`. It must not appear as a sibling root post.
- **State pass.** `sent[]` item has `replyToId` equal to the conversation `;messageid=` numeric suffix (Playground needs that to stay in-thread). `toolsInvoked` includes `mcp_graph_teams_replyToChannelMessage`. `runningTurns` returns to 0.
- **Proof.** `receipts/verify-teams-harness/07-channel-new-post/playground.png` (General + root post + in-thread grok bubble) + `debug-state.json`. Keep this post visible if you will drive loop 8 against it.

## Gotchas

- **Start a new post** + **Post** is the only valid composer for this loop. The thread box under an existing post is a reply (loop 8).
- Acks are not a pass. Wait 15–45s for `original text:`.
- If the grok bubble shows up as a new root in General, `replyToId` was dropped — fail the loop, do not "fix" it by calling Graph REST.
- Do not mention-gate: ungate must be applied or channel posts that do not @mention the bot never reach the harness.
