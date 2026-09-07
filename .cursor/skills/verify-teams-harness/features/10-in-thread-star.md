# In-thread star

Create a **new** General root post, then while `Working on it...` is showing, send `star this` in that post's thread pane. Pass is a **⭐ chip on the target** in that thread. A visible `⭐ …` prefix-copy bubble (or leftover 👀 `<p>` row inside the root `fui-Card`) is a fail.

## Sub-features

- `th-star-root` new root via **Start a new post** + **Post**.
- `th-star-inject` thread-pane `pg-ch-10 <nonce> star this` while Working on it is showing.
- `th-star-chip` in-thread `.pg-chip[data-emoji="⭐"]` on the target. Prefix-copy bubble hidden.
- `th-star-mcp` `setReactions[]` star via `mcp_graph_teams_setReaction` (supporting).

## How to get to it (user POV)

- **My Team** → **General**.
- New root with **Start a new post**.
- Thread pane `Type a message...` for the star request, sent mid-turn.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Ungate + `pg-restyle.js`. One tab at `http://localhost:56150/`.
- Fresh root. Do not star inside the loop-7/8/9 thread unless that turn is idle and you still inject mid-turn on a **new** root.

- **New root.** **Start a new post** → `pg-ch-10 <nonce> start` → **Post**. Wait for a 👀 chip on the root + `Working on it...`. No `👀 … start` bubble and no extra 👀 `<p>` row inside the root `fui-Card`.
- **Star inject.** In the thread pane, send `pg-ch-10 <nonce> star this` while Working on it is showing.
- **Chip pass.** ⭐ chip on the target in that thread. No visible `⭐ pg-ch-10 <nonce> star this` bubble.
- **State (supporting).** `setReactions[]` has a star. `toolsInvoked` includes `mcp_graph_teams_setReaction` (not `mcp_graph_chat_setReaction`). `sent[]` star copy may exist on the wire and must have `replyToId` = root `;messageid=` suffix.
- **Proof.** `receipts/verify-teams-harness/10-in-thread-star/playground.png` + `debug-state.json`.

## Gotchas

- Chat `mcp_graph_chat_setReaction` on this loop is the wrong Surface — fail.
- A 👀 chip is not the star. A leftover in-thread 👀 `<p>` inside the root `fui-Card` is a fail (PR 5 restyle; on master-only without that hide, treat the leftover as a product gap, not a map pass).
- A second **Start a new post** for `star this` is a new root, not an in-thread star.
- Visible prefix-copy bubbles are a fail even if `/debug/state` recorded `setReaction`.
