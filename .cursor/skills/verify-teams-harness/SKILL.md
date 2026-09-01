---
name: verify-teams-harness
description: Drive Microsoft 365 Agents Playground against the teams-harness webhook (localhost:56150 → :3978). Use when proving DM / group / channel / thread loops, mid-turn follow-ups, or intra-turn stars. Receipt is the Playground UI plus GET /debug/state — never npm test.
---

# Verify teams-harness

You are driving **Microsoft 365 Agents Playground** against this repo's Bot Framework harness. That UI is the only verification surface. `npm test` is coverage. It is not the receipt. Do not invent a second surface (CLI probe, Graph REST, a grok shim, or a unit-test dump treated as pass).

This skill is for a later agent on a **machine that already has a real grok CLI and Agents Playground**. Cloud VMs usually lack `~/.grok/bin/grok` (ENOENT). On those machines: run `doctor`, record the grok miss, **stop**. Do not fake a Playground screenshot. Do not write a grok stub. Do not POST synthetic `/api/messages` and call it a loop pass.

## Machine gate (read this first)

Proof of any mapped loop requires all of:

1. Real grok binary at `$HOME/.grok/bin/grok` (executable file). Never a repo-local shim, wrapper, or `alias`.
2. `@microsoft/m365agentsplayground` 0.2.28 (or the repo pin) installed, then `node scripts/ungate-playground.mjs`.
3. Harness answering `GET http://localhost:3978/health`.
4. Playground open at **`http://localhost:56150/`** — hostname `localhost`, **one tab**. `127.0.0.1` and a second tab of the same origin break compose.

If (1) fails, the run is **blocked**, not skipped-as-pass. Write that in the evidence note and exit.

## Surface (do not add another)

| Role | What | Not this |
| --- | --- | --- |
| Receipt | Playground chat UI at `http://localhost:56150/` | `npm test`, log lines, `/api/messages` curl as the pass |
| Side-effect dump | `GET http://localhost:3978/debug/state` → `sent[]`, `setReactions[]`, `runningTurns` | Graph SDK / Graph REST from the bot process |
| Inbound | Bot Framework webhook `POST /api/messages` (Playground connector) | Graph subscription inbound |
| Outbound | MCP only: `mcp_graph_chat_*` / `mcp_graph_teams_*` on `teams-read` + `teams-post` | Graph from `src/` outside MCP |

Product "Surface" types (`dm` / `group` / `thread` in `src/surface.ts`) are turn keys, not a second verification UI.

## Launch

From repo root, after `npm install`. Prefer the helper (it writes pids this run owns):

```bash
node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor
node .cursor/skills/verify-teams-harness/scripts/harness.mjs launch
```

Manual equivalent (same processes, same ports):

```bash
npm install
node scripts/ungate-playground.mjs
PORT=3978 PATH="$HOME/.grok/bin:$PATH" npx tsx src/index.ts
# other terminal / tmux pane:
PATH="$HOME/.grok/bin:$PATH" agentsplayground -e http://localhost:3978/api/messages -c msteams -p 56150
```

Ungate **after** the playground package is on disk. It turns the mention-gate off, grows the compose/send hit-target (~40px paper-plane), accepts `messageReaction`, and restyles `👀` / `⭐` prefix copies as chips. `npm run playground` ungates then starts only the harness — it does **not** start Agents Playground. You still need `agentsplayground … -p 56150`.

Ready when:

- `curl -sS http://localhost:3978/health` → JSON `{ "ok": true, "runningTurns": <n>, "harnessSpawns": <n> }`
- `curl -sS -o /dev/null -w '%{http_code}' http://localhost:56150/` → `200`
- Browser: one tab at `http://localhost:56150/` showing the Teams-style left rail (`Personal Chat`, `Group Chat`, `My Team`)

Default deploy is `harness.toml` `read_policy = "surface"`. Loops 1–10 use that. Loop 11 relaunches with `HARNESS_READ_POLICY=thread-only`.

Isolation: ports **3978** and **56150** are shared. If they are already bound by a process this run did not start, **refuse to launch another**. Doctor the existing instance or clean up the pids you own. Two Playground tabs of `http://localhost:56150/` corrupt compose — never open a second tab.

Teardown is **Cleanup** below. Launch does not delete receipts.

## Doctor

Run this first whenever anything looks off, and again after every launch:

```bash
node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor
```

A healthy instance means all of:

- `test -x "$HOME/.grok/bin/grok"` — real binary. Missing → exit 2, machine-gate text, stop. Do not install a fake `grok`.
- `node_modules/@microsoft/m365agentsplayground` present.
- Ungate markers in that package: mention-gate off, send button 40px, `messageReaction` in the connector schema, `pg-chip-boot` in `dist/client/index.html`.
- `GET http://localhost:3978/health` → `ok: true` and the listening process is the one `launch` recorded (or you just started it).
- Playground `GET http://localhost:56150/` → 200.
- `harness.toml` `read_policy` printed (`surface` for loops 1–10).

Optional coverage (never a receipt):

```bash
node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor --coverage
```

That runs `npm test`. Green tests without a Playground screenshot + `/debug/state` dump are **not** local-done.

## Drive

Read `features/README.md`, then the feature file for the loop. Drive the Playground **as a user**: click the rail, type in the real composer, send with the paper-plane. Do not POST `/api/messages` yourself and call the loop passed.

### Playground chrome (0.2.28, after ungate)

Ground every click in these handles. Prefer visible text and Fluent chat classes over coordinates.

| Handle | Where |
| --- | --- |
| Left rail `Personal Chat` | DM loops 1–3 |
| Left rail `Group Chat` | Group loops 4–6 |
| Left rail `My Team` → `General` | Channel / thread loops 7–10 |
| Placeholder `Type a message...` | Bottom composer in Personal Chat and Group Chat; **thread pane** composer only |
| Paper-plane send | Button next to that composer. After ungate ≈ 40×40px (`minWidth`/`maxWidth` 40). Hit the button or Enter in DM/group. |
| `Start a new post` then `Post` | Channel **root** posts only (loop 7, and the root that loops 8–10 hang off) |
| Thread pane `Type a message...` | Replies under an existing channel post (loops 8–10) |
| `.ui-chat__message` / `.ui-chat__message__bubble` | Message bubbles |
| Text `/^(👀\|⭐)/` and optional `.pg-chip[data-emoji="👀\|⭐"]` | Prefix-copy "reactions" (not native chips) |

Mixing `Start a new post` with the thread composer **invalidates** the loop. A channel root post opens a thread Surface (`threadId` = that post id). `conversationKey` is `channelId;messageid=threadId`. Playground in-thread display needs outbound `replyToId` = the conversation `;messageid=` numeric suffix.

### Pass vs ack (every content loop)

Immediate host ack (not a pass):

- A bubble `👀 <the user text>` (seen-cursor copy; playground cannot render real reaction chips).
- A bubble `Working on it...` / `Working on it…`.

Pass is a **later grok content bubble**, typically starting with `original text:`. Grok takes **15–45s**. Acks alone are not a pass. Do not declare pass when `Working on it...` is still the last bot text.

Mid-turn loops (2, 3, 5, 6, 9, 10): send the second message **while `Working on it...` is still showing**. Waiting until the grok report lands starts a **new** turn and invalidates the inject.

Star loops: user text is `star this` (unique prefix in front). Pass = visible `⭐ <that text>` copy and/or `setReactions[]` with a star. Playground 0.2.28 cannot render real reaction chips; the harness posts a prefix-copy message. After ungate, `.pg-chip` may decorate the previous bubble. Do not claim native chips exist unless that shim is present.

### Browser recipe (loop 1 — the one a later agent must be able to finish)

Preconditions: `doctor` exit 0. One tab at `http://localhost:56150/`. `read_policy` = `surface`.

1. Click left-rail **Personal Chat**.
2. Focus the bottom composer (`Type a message...`).
3. Type a unique probe `pg-dm-1 <nonce> ping` (nonce = `date +%s` or 6 hex chars).
4. Click the paper-plane (or Enter).
5. Capture the ack state: `👀 pg-dm-1 <nonce> ping` and `Working on it...` visible. This is **not** pass.
6. Wait 15–45s. Do not send another Personal Chat message.
7. Pass when a later bubble starts with `original text:` and repeats the probe.
8. Evidence: screenshot of that thread + `GET /debug/state` (see Evidence).

If grok is missing, `launch`/`doctor` already stopped you. Do not continue from step 1.

## Evidence

Named receipts dir (survives cleanup):

```
receipts/verify-teams-harness/<loop-id>/
  playground.png          # Playground UI, probe + grok content bubble visible
  debug-state.json        # GET http://localhost:3978/debug/state
  notes.md                # nonce, timestamps, pass/fail one-liner
```

Dump state with:

```bash
mkdir -p receipts/verify-teams-harness/01-dm-respond
curl -sS http://localhost:3978/debug/state > receipts/verify-teams-harness/01-dm-respond/debug-state.json
```

`debug-state.json` must be read, not just saved. For a content-loop pass:

- `sent[]` has an item whose `text` starts with `original text:` and contains the probe (star loops: a `sent[]` item starting with `⭐`).
- `setReactions[]` records eyes on the inbound message; star loops also record a star.
- `toolsInvoked` contains the MCP write for that surface (`mcp_graph_chat_postMessage` on DM/group; `mcp_graph_teams_replyToChannelMessage` on thread). No Graph REST URLs.
- `runningTurns` is `0` after grok finishes (nonzero while `Working on it...` is up).
- Screenshot shows the Playground chrome (rail + bubbles), not a terminal.

Proof standards:

- Exercise the real user path in Playground. Do not call internal setters, do not POST `/api/messages` as the pass, do not treat `npm test` as the pass.
- Capture the action (ack) **and** the resulting grok content, not only the final screen.
- Side effects live in `/debug/state`. The screenshot is still required.
- Graph REST stays inside MCP when `GRAPH_*` is set. Local Playground uses the in-process mock. Never add a Graph SDK call to the bot process to "make verify easier".
- Mocks are only the playground MCP mock (already the production boundary when Graph creds are unset).

## Cleanup

```bash
node .cursor/skills/verify-teams-harness/scripts/harness.mjs cleanup
```

Kills **only** the harness and playground PIDs recorded in `/tmp/verify-teams-harness/run.json`. Never `pkill -f grok`, `pkill tsx`, or `killall agentsplayground`. After cleanup, confirm `receipts/verify-teams-harness/` still exists. A cleanup that deletes receipts has failed.

If you started processes by hand, kill those PIDs the same way (the shells/tmux panes you opened), not by binary name.

Do not revert `scripts/ungate-playground.mjs` patches in `node_modules` unless you are discarding the whole install. Ungate is local to the package install.

## Helpers

```bash
node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor
node .cursor/skills/verify-teams-harness/scripts/harness.mjs doctor --coverage
node .cursor/skills/verify-teams-harness/scripts/harness.mjs launch
node .cursor/skills/verify-teams-harness/scripts/harness.mjs cleanup
```

`doctor` / `launch` refuse to proceed without `$HOME/.grok/bin/grok`. That is the feature, not a bug.

## Feature map

`.cursor/skills/verify-teams-harness/features/` is the maintained source. A proof that only drives loop 1 is incomplete when you claimed the whole map. One live loop is enough to prove **this skill** works; ship receipts for every file you claim.

Keep the map honest with `/maintain-verification-skill` after harness or Playground chrome changes.
