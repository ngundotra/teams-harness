# In-thread star

Create a **new** General root post, then while `Working on it...` is showing, send `star this` in that post's thread pane. Pass is a visible `⭐` prefix copy in-thread and/or `mcp_graph_teams_setReaction` in `/debug/state`.

## Sub-features

- `th-star-root` new root via **Start a new post** + **Post**.
- `th-star-inject` thread-pane `pg-ch-10 <nonce> star this` while Working on it is showing.
- `th-star-copy` in-thread `⭐ pg-ch-10 <nonce> star this` (optional `.pg-chip`).
- `th-star-mcp` `setReactions[]` star via `mcp_graph_teams_setReaction`.

## How to get to it (user POV)

- **My Team** → **General**.
- New root with **Start a new post**.
- Thread pane `Type a message...` for the star request, sent mid-turn.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Ungate applied (chip restyle + `messageReaction`). `runningTurns` is 0.
- Fresh root. Do not star inside the loop-7/8/9 thread unless that turn is idle and you still inject mid-turn on a **new** root.

- **New root.** **Start a new post** → `pg-ch-10 <nonce> start` → **Post**. Wait for `👀` + `Working on it...`.
- **Star inject.** In the thread pane, send `pg-ch-10 <nonce> star this` while Working on it is showing.
- **Copy pass.** In-thread bubble `⭐ pg-ch-10 <nonce> star this`. Optional `.pg-chip[data-emoji="⭐"]`. No native chip required.
- **State pass.** `setReactions[]` has a star. `toolsInvoked` includes `mcp_graph_teams_setReaction` (channel, not `mcp_graph_chat_setReaction`). `sent[]` star copy has `replyToId` = root `;messageid=` suffix.
- **Proof.** `receipts/verify-teams-harness/10-in-thread-star/playground.png` + `debug-state.json`.

## Gotchas

- Chat `mcp_graph_chat_setReaction` on this loop is the wrong Surface — fail.
- Eyes `👀` is not the star.
- A second **Start a new post** for `star this` is a new root, not an in-thread star.
- Playground 0.2.28 cannot render real reaction chips. Prefix copy + MCP record is the pass.
