# Group mid-turn follow-up

Same inject contract as loop 2, in **Group Chat**. The second message is sent while `Working on it...` is showing. The grok content bubble lists the queued follow-up.

## Sub-features

- `grp-start` starts a Group Chat turn with `… start`.
- `grp-inject` sends `… follow include this` while Working on it is visible.
- `grp-queue` lists that follow-up in the content bubble.
- `grp-drain` may record `harness_drainInbox` if inject was missed.

## How to get to it (user POV)

- Left rail **Group Chat**, bottom `Type a message...`, paper-plane.
- First send, then second send before the grok report.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Group Chat. `runningTurns` is 0.
- Start text `pg-grp-2 <nonce> start`. Follow-up `pg-grp-2 <nonce> follow include this`.

- **Start turn.** Send the start probe. Confirm `👀` + `Working on it...`.
- **Inject.** Send the follow-up while Working on it is still showing. Eyes should walk to the follow-up.
- **Content pass.** Later bubble lists `pg-grp-2 <nonce> follow include this` under queued follow-ups (or equivalent wording).
- **State pass.** `sent[]` content includes both probes. `toolsInvoked` includes `mcp_graph_chat_postMessage`. `harness_drainInbox` optional backup.
- **Proof.** `receipts/verify-teams-harness/05-group-mid-turn-follow-up/playground.png` + `debug-state.json`.

## Gotchas

- If you wait for the grok report before the second send, you started a new turn. Retry with a new nonce.
- Do not drive this from Personal Chat or General.
- Acks (`👀`, Working on it) are not the pass.
