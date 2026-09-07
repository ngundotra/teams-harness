# DM mid-turn follow-up

While Personal Chat still shows `Working on it...` for the first ping, the user sends a second message. That follow-up enqueues on the same turn. The later grok content bubble lists the queued follow-up (and may mention `harness_drainInbox` as the backup drain).

## Sub-features

- `dm-start` starts a turn with a unique `… start` probe.
- `dm-inject` sends `… follow include this` while `Working on it...` is still visible.
- `dm-queue` lists that follow-up in the grok content bubble (`queued follow-ups:` or the follow-up text itself).
- `dm-drain` may show `harness_drainInbox` in `toolsInvoked` if the inject was missed; inject is the primary path.

## How to get to it (user POV)

- Same chrome as loop 1: **Personal Chat**, bottom `Type a message...`, paper-plane.
- Send the first message, then immediately type and send the second **before** the grok report lands.

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0. Personal Chat. `runningTurns` is 0.
- Unique nonce. First line `pg-dm-2 <nonce> start`. Second line `pg-dm-2 <nonce> follow include this`.

- **Start turn.** Send `pg-dm-2 <nonce> start`. Confirm a 👀 chip on that message + `Working on it...`. No `👀 … start` bubble.
- **Inject now.** While `Working on it...` is still the last bot text, send `pg-dm-2 <nonce> follow include this`. Eyes walk: 👀 chip on the follow-up. A leftover `👀 pg-dm-2 <nonce> follow include this` bubble is a fail.
- **Do not wait-then-send.** If the content bubble already landed, you started a new turn. Abort and retry with a new nonce.
- **Content pass.** Later bubble lists the follow-up (`queued follow-ups: pg-dm-2 <nonce> follow include this` or equivalent). `original text:` still names the start probe.
- **State pass.** `sent[]` content includes both probes. `toolsInvoked` includes `mcp_graph_chat_postMessage`. `harness_drainInbox` may appear; it is backup, not required if inject worked.
- **Proof.** `receipts/verify-teams-harness/02-dm-mid-turn-follow-up/playground.png` + `debug-state.json`.

## Gotchas

- Mid-turn is a timing constraint, not a second conversation. The second send must happen while `Working on it...` is showing.
- Grok can take 15–45s. That wait is **after** the inject, not before it.
- Eyes walking to the follow-up is an ack (chip, not a prefix-copy bubble). The content bubble is the pass.
- Mixing this loop with a star (`star this`) belongs in loop 3, not here.
