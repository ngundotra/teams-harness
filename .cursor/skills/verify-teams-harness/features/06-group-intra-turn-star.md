# Group intra-turn star

Same star contract as loop 3, in **Group Chat**. Mid-turn `star this` must produce a **⭐ chip on the target message**. A visible `⭐ …` prefix-copy bubble is a fail. `mcp_graph_chat_setReaction` in `/debug/state` is supporting evidence only.

## Sub-features

- `grp-star-start` starts a Group Chat turn.
- `grp-star-inject` sends `pg-grp-3 <nonce> star this` while Working on it is showing.
- `grp-star-chip` shows `.pg-chip[data-emoji="⭐"]` on the target. The prefix-copy bubble is hidden.
- `grp-star-mcp` records star on `setReactions[]` via `mcp_graph_chat_setReaction`.

## How to get to it (user POV)

- **Group Chat**, bottom composer, paper-plane.
- Second message is the star request, sent mid-turn.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Ungate + `pg-restyle.js`. Group Chat. One tab at `http://localhost:56150/`.
- `runningTurns` is 0.

- **Start turn.** Send `pg-grp-3 <nonce> start`. Wait for a 👀 chip on that message + `Working on it...`. No `👀 … start` bubble.
- **Star inject.** Send `pg-grp-3 <nonce> star this` while Working on it is showing.
- **Chip pass.** ⭐ chip on the target. No visible `⭐ pg-grp-3 <nonce> star this` bubble.
- **State (supporting).** `setReactions[]` has a star. `toolsInvoked` includes `mcp_graph_chat_setReaction`.
- **Proof.** `receipts/verify-teams-harness/06-group-intra-turn-star/playground.png` + `debug-state.json`.

## Gotchas

- A 👀 chip is not the star pass.
- A visible prefix-copy bubble is a fail. Do not treat `setReaction` alone as the receipt.
- Sending `star this` after the report lands is a new turn.
