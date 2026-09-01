# teams-harness verification map

This directory is the maintained source for proving the Teams harness the way a user does it: Microsoft 365 Agents Playground at `http://localhost:56150/`. Read this index, then the matching loop file. `npm test` is coverage. It is not a loop receipt.

Notion table (Loop / Status yes|not yet): [Verification loops](https://app.notion.com/p/d1bd9899077b42dfbd91abe7dfa14836). Receipt note (probe text + screenshot path) goes on the page body when Status flips to yes.

## Baseline preconditions

- Real grok at `$HOME/.grok/bin/grok`. Cloud VMs often ENOENT — stop; do not shim.
- `node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor` exit 0.
- Harness on `:3978`, Playground on `:56150`, **one** tab at `http://localhost:56150/` (not `127.0.0.1`).
- Ungate already applied (`node scripts/ungate-playground.mjs`).
- `harness.toml` `read_policy = "surface"` for loops 1–10. Loop 11 relaunches with `thread-only`.
- Unique probe text every drive (`pg-dm-1 <nonce> ping`, etc.). Reusing an old probe makes `/debug/state` ambiguous.
- Never drive an instance this run did not doctor.

## Driving conventions

- Start every recipe from Personal Chat / Group Chat / My Team → General as that file says. Do not reuse a leftover thread from another loop unless the file says to (loop 8 may hang off a fresh loop-7 post from the same session).
- Type in the real composer. Send with the paper-plane (~40px after ungate) or Enter in DM/group. Channel **roots** use **Start a new post** + **Post**.
- Mid-turn means the second send happens while `Working on it...` is still on screen.
- Pass is a later grok **content** bubble (`original text:` / queued follow-ups / `⭐` copy). `👀` and `Working on it...` are acks.
- Grok takes 15–45s. Do not declare fail at 5s.
- Outbound Graph is MCP-only. `/debug/state` `toolsInvoked` must show `mcp_graph_chat_*` or `mcp_graph_teams_*`, never a bot-process Graph REST client.

## Proof and skip reporting

- Screenshot under `receipts/verify-teams-harness/<loop-id>/playground.png` plus `debug-state.json` from `GET http://localhost:3978/debug/state`.
- Read `sent[]`, `setReactions[]`, `runningTurns`. Saving the JSON without reading it is not proof.
- If grok is missing, report the machine gate and the `doctor` exit 2. That is a blocked proof, not a pass.
- Do not report a skipped Playground path as verified through `npm test`.

## Feature entry contract

Each file: H1, one paragraph, then exactly four H2s — `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-teams-harness`, `Gotchas`.

## Features

1. [DM respond](./01-dm-respond.md) — Personal Chat ping → grok `original text:` via `mcp_graph_chat_postMessage`.
2. [DM mid-turn follow-up](./02-dm-mid-turn-follow-up.md) — second message while Working on it; queued follow-ups; `harness_drainInbox`.
3. [DM intra-turn star](./03-dm-intra-turn-star.md) — `star this` while Working on it; `⭐` copy + `setReaction`.
4. [Group respond](./04-group-respond.md) — same as 1 in Group Chat.
5. [Group mid-turn follow-up](./05-group-mid-turn-follow-up.md)
6. [Group intra-turn star](./06-group-intra-turn-star.md)
7. [Channel new post](./07-channel-new-post.md) — Start a new post in General, not the thread composer.
8. [Thread replies stay in-thread](./08-thread-replies-stay-in-thread.md) — reply under the loop-7 post; bot stays in that thread.
9. [Mid-turn thread follow-ups](./09-mid-turn-thread-follow-ups.md) — new root post, inject thread reply while Working on it.
10. [In-thread star](./10-in-thread-star.md) — new root post, `star this` in thread while Working on it.
11. [Thread-only read policy](./11-thread-only-read-policy.md) — `read_policy=thread-only` must not advertise/use `mcp_graph_teams_listChannelMessages` (sibling channel leak).
