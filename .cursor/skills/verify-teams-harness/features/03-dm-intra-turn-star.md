# DM intra-turn star

While Personal Chat still shows `Working on it...`, the user sends `star this`. Grok sets a star via `mcp_graph_chat_setReaction`. The harness still posts a `⭐ <text>` prefix copy on the wire; `scripts/pg-restyle.js` must restyle that into a **⭐ chip on the target message** and hide the copy bubble. A visible `⭐ …` prefix-copy bubble is a fail.

## Sub-features

- `dm-star-start` starts a turn (any short ping).
- `dm-star-inject` sends `pg-dm-3 <nonce> star this` while `Working on it...` is showing.
- `dm-star-chip` shows `.pg-chip[data-emoji="⭐"]` on the target card (the `star this` message). The `⭐ pg-dm-3 …` bubble is hidden (`data-pg-reactcopy="1"`).
- `dm-star-mcp` records `setReactions[]` with a star and `toolsInvoked` contains `mcp_graph_chat_setReaction` (supporting evidence only).

## How to get to it (user POV)

- **Personal Chat**, bottom `Type a message...`, paper-plane.
- First message starts the turn. Second message is the star request, sent mid-turn.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Ungate applied (`pg-restyle.js` injected). One tab at `http://localhost:56150/` (not `127.0.0.1`).
- `runningTurns` is 0.

- **Start turn.** Send `pg-dm-3 <nonce> start`. Wait until a 👀 chip is on that message and `Working on it...` is visible. No `👀 pg-dm-3 <nonce> start` bubble.
- **Star inject.** Send `pg-dm-3 <nonce> star this` while Working on it is still showing.
- **Chip pass.** The `star this` card (or the start card if grok starred that id) shows `.pg-chip[data-emoji="⭐"]`. No visible bubble whose text is `⭐ pg-dm-3 <nonce> star this`.
- **State (supporting).** `setReactions[]` has a star. `toolsInvoked` includes `mcp_graph_chat_setReaction`. `sent[]` may still contain the `⭐ …` wire copy. Eyes chips/state are not the star pass.
- **Proof.** `receipts/verify-teams-harness/03-dm-intra-turn-star/playground.png` (chip on the target, no prefix-copy bubble) + `debug-state.json`.

## Gotchas

- A visible `⭐` prefix-copy bubble is a fail, even if `setReaction` is in `/debug/state`.
- Sending `star this` after the grok report lands is a new turn, not intra-turn.
- A 👀 chip is the seen-cursor ack, not the star.
- `npm test` star asserts are coverage. The receipt is the chip in Playground.
