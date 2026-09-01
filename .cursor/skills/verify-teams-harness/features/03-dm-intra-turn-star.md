# DM intra-turn star

While Personal Chat still shows `Working on it...`, the user sends `star this`. Grok sets a star via `mcp_graph_chat_setReaction`. Playground 0.2.28 cannot render native reaction chips; the harness posts a prefix-copy `⭐ <text>`. After ungate, a `.pg-chip` may decorate the previous bubble.

## Sub-features

- `dm-star-start` starts a turn (any short ping).
- `dm-star-inject` sends `pg-dm-3 <nonce> star this` while `Working on it...` is showing.
- `dm-star-copy` shows a visible `⭐ pg-dm-3 <nonce> star this` bubble (and optional `.pg-chip[data-emoji="⭐"]`).
- `dm-star-mcp` records `setReactions[]` with a star and `toolsInvoked` contains `mcp_graph_chat_setReaction`.

## How to get to it (user POV)

- **Personal Chat**, bottom `Type a message...`, paper-plane.
- First message starts the turn. Second message is the star request, sent mid-turn.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Ungate applied (chip restyle + `messageReaction` accepted). One tab.
- `runningTurns` is 0.

- **Start turn.** Send `pg-dm-3 <nonce> start`. Wait until `👀` + `Working on it...` are visible.
- **Star inject.** Send `pg-dm-3 <nonce> star this` while Working on it is still showing.
- **Copy pass.** A bubble whose text starts with `⭐` and includes `pg-dm-3 <nonce> star this`. Optional `.pg-chip` on the previous `.ui-chat__message`. Do **not** claim a native Teams reaction chip unless that shim is present.
- **State pass.** `setReactions[]` has a star on the follow-up (or start) messageId. `toolsInvoked` includes `mcp_graph_chat_setReaction`. Eyes in `setReactions[]` are expected and are not the star pass.
- **Proof.** `receipts/verify-teams-harness/03-dm-intra-turn-star/playground.png` + `debug-state.json`.

## Gotchas

- Playground cannot render real reaction chips. A missing chip is not a product fail if the `⭐` prefix copy is visible and/or `setReaction` is in state.
- Sending `star this` after the grok report lands is a new turn, not intra-turn.
- Do not treat the eyes `👀` copy as the star.
- `npm test` star asserts are coverage. The receipt is the visible `⭐` copy in Playground.
