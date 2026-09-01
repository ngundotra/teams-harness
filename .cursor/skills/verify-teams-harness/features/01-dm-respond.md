# DM respond

A user in Personal Chat sends a ping. The harness acks immediately (`👀` copy + `Working on it...`), then grok later posts a content bubble that starts with `original text:` and repeats the ping, via `teams-post` `mcp_graph_chat_postMessage`.

## Sub-features

- `dm-open` opens Personal Chat from the Playground left rail.
- `dm-compose` types into the bottom `Type a message...` box and sends with the paper-plane.
- `dm-ack` shows `👀 <probe>` and `Working on it...` right away.
- `dm-content` shows a later grok bubble starting with `original text:` containing the probe.

## How to get to it (user POV)

- Open `http://localhost:56150/` (one tab).
- Click left-rail **Personal Chat**.
- Type in the bottom composer (`Type a message...`).
- Send with the paper-plane (~40px after ungate) or Enter.

## Driving it with verify-teams-harness

Preconditions:

- `node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor` exit 0.
- One Playground tab. `read_policy` = `surface`.
- No in-flight turn in this DM (`GET /debug/state` `runningTurns` is 0).

- **Open DM.** Click **Personal Chat**. The bottom composer shows placeholder `Type a message...`.
- **Send probe.** Type `pg-dm-1 <nonce> ping`. Click the paper-plane. The user bubble appears with that exact text.
- **Ack (not pass).** Within ~2s a `👀 pg-dm-1 <nonce> ping` copy and `Working on it...` appear. `GET /debug/state` shows `runningTurns` ≥ 1 and `setReactions[]` with eyes.
- **Wait for grok.** 15–45s. Do not send another message.
- **Content pass.** A later `.ui-chat__message__bubble` starts with `original text:` and includes `pg-dm-1 <nonce> ping`.
- **State pass.** `sent[]` has that content text. `toolsInvoked` includes `mcp_graph_chat_postMessage`. `runningTurns` returns to 0.
- **Proof.** Screenshot `receipts/verify-teams-harness/01-dm-respond/playground.png` (rail says Personal Chat; probe + content bubble visible). Dump `debug-state.json` from `GET http://localhost:3978/debug/state`.

## Gotchas

- Acks alone are not a pass. If you screenshot `Working on it...` you have not finished.
- `127.0.0.1:56150` and a second tab break compose. Use `localhost`, one tab.
- After ungate the paper-plane is ~40px. If send does nothing, ungate did not apply — re-run `node scripts/ungate-playground.mjs` and reload.
- Do not POST `/api/messages` and call this loop passed. The receipt is the Playground UI.
- `npm test` `verify.loops.test.ts` is coverage for a similar path. It is not this receipt.
