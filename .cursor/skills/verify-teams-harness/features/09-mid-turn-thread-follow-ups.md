# Mid-turn thread follow-ups

Create a **new** General root post, then while `Working on it...` is still showing, inject a **thread** reply under that post. The later grok bubble (in-thread) lists the queued follow-up.

## Sub-features

- `th-follow-root` creates a new root with **Start a new post** + **Post**.
- `th-follow-inject` sends a thread-pane reply while Working on it is visible on that turn.
- `th-follow-queue` content bubble lists `queued follow-ups:` with the reply text.
- `th-follow-stay` everything stays on `channelId;messageid=<root id>`.
- `th-follow-hide-eyes` in-thread mid-turn 👀 copies that landed as extra `<p>` rows inside the root `fui-Card` are hidden (PR 5 restyle). A leftover 👀 row is a fail.

## How to get to it (user POV)

- **My Team** → **General**.
- **Start a new post** / **Post** for the start probe.
- Immediately open that post's thread pane and type `Type a message...` for the follow-up. Do not start another root.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. `runningTurns` is 0 before the root.
- Start `pg-ch-9 <nonce> start`. Follow-up `pg-ch-9 <nonce> follow include this`.

- **New root.** **Start a new post** → `pg-ch-9 <nonce> start` → **Post**. Confirm a 👀 chip on the root + `Working on it...`. No `👀 … start` bubble.
- **Inject in-thread.** Open the thread pane. While Working on it is still showing, send `pg-ch-9 <nonce> follow include this` in the thread `Type a message...` box. Eyes walk to a 👀 chip on the follow-up row. No leftover `👀 pg-ch-9 <nonce> follow include this` `<p>` inside the root `fui-Card`.
- **Content pass.** Later in-thread bubble lists the follow-up (`queued follow-ups: pg-ch-9 <nonce> follow include this`). `original text:` names the start probe. No new General root for the grok report.
- **State pass.** `sent[]` content includes both probes and has `replyToId` = root `;messageid=` suffix. `toolsInvoked` includes `mcp_graph_teams_replyToChannelMessage`. `harness_drainInbox` optional backup.
- **Proof.** `receipts/verify-teams-harness/09-mid-turn-thread-follow-ups/playground.png` + `debug-state.json`.

## Gotchas

- The follow-up must be a **thread reply**, not a second **Start a new post**. A second root is a different `conversationKey` and a different turn.
- If Working on it is gone before you reply, you missed the inject. New nonce, retry.
- Do not reuse the loop-7/8 thread unless you just created a fresh root for this loop — leftover turns confuse `runningTurns`.
- PR 5 (`scripts/pg-restyle.js`) collects nested `<p>` rows so those in-thread 👀 copies hide without hiding the whole post. On master without that hide, a leftover 👀 `<p>` is a product gap, not a map pass.
