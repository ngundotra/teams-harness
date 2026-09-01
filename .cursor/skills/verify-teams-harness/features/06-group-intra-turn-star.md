# Group intra-turn star

Same star contract as loop 3, in **Group Chat**. Mid-turn `star this` must produce a visible `⭐` prefix copy and/or `mcp_graph_chat_setReaction` in `/debug/state`.

## Sub-features

- `grp-star-start` starts a Group Chat turn.
- `grp-star-inject` sends `pg-grp-3 <nonce> star this` while Working on it is showing.
- `grp-star-copy` shows `⭐ pg-grp-3 <nonce> star this`.
- `grp-star-mcp` records star on `setReactions[]` via `mcp_graph_chat_setReaction`.

## How to get to it (user POV)

- **Group Chat**, bottom composer, paper-plane.
- Second message is the star request, sent mid-turn.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Ungate applied. Group Chat. `runningTurns` is 0.

- **Start turn.** Send `pg-grp-3 <nonce> start`. Wait for `👀` + `Working on it...`.
- **Star inject.** Send `pg-grp-3 <nonce> star this` while Working on it is showing.
- **Copy pass.** Visible `⭐ pg-grp-3 <nonce> star this`. Optional `.pg-chip[data-emoji="⭐"]`. No native chip required.
- **State pass.** `setReactions[]` has a star. `toolsInvoked` includes `mcp_graph_chat_setReaction`.
- **Proof.** `receipts/verify-teams-harness/06-group-intra-turn-star/playground.png` + `debug-state.json`.

## Gotchas

- Eyes `👀` is not the star pass.
- Playground 0.2.28 has no real reaction chips. Prefix copy + MCP record is the pass.
- Sending `star this` after the report lands is a new turn.
