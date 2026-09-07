# Thread-only read policy

With `read_policy = "thread-only"`, teams-read must not list sibling channel posts. `mcp_graph_teams_listChannelMessages` is omitted from the advertised read tools. The worker may still list/get **this** thread (`mcp_graph_teams_listChannelMessageReplies`) and must still reply in-thread.

This is an optional eleventh loop. Loops 1–10 stay on master default `read_policy = "surface"`.

## Sub-features

- `policy-relaunch` restarts the harness with `HARNESS_READ_POLICY=thread-only` (do not add `read_channels`).
- `policy-root` drives a General **Start a new post** like loop 7.
- `policy-no-list` `/debug/state` `toolsInvoked` does **not** include `mcp_graph_teams_listChannelMessages`.
- `policy-thread-read` may include `mcp_graph_teams_listChannelMessageReplies`; write is still `mcp_graph_teams_replyToChannelMessage`.

## How to get to it (user POV)

- Same Playground chrome as loop 7: **My Team** → **General** → **Start a new post** → **Post**.
- The user-visible chat is unchanged. The difference is what teams-read is allowed to see (this thread only).

## Driving it with verify-teams-harness

Preconditions:

- Doctor exit 0 on a grok machine.
- Cleanup the surface-policy harness first (`harness.mjs cleanup`).
- Relaunch with the env override (TOML stays `surface` on disk; env wins for this run):

```bash
HARNESS_READ_POLICY=thread-only node .cursor/skills/verify-teams-harness/scripts/harness.mjs launch
```

If the helper does not forward that env into the child (it inherits `process.env`), export it in the same shell. Confirm the harness log / next doctor print is not required to rewrite `harness.toml`. Restore `surface` after cleanup by unsetting the env and launching normally.

- **New root.** In General, **Start a new post** → `pg-ch-11 <nonce> ping` → **Post**.
- **Content pass.** In-thread `original text: pg-ch-11 <nonce> ping` (same UI pass as loop 7).
- **Policy pass.** `GET /debug/state` `toolsInvoked` contains `mcp_graph_teams_replyToChannelMessage` and does **not** contain `mcp_graph_teams_listChannelMessages`. Sibling root texts from other loops must not appear as listed channel messages in the grok bubble.
- **Proof.** `receipts/verify-teams-harness/11-thread-only-read-policy/playground.png` + `debug-state.json`. Note `HARNESS_READ_POLICY=thread-only` in `notes.md`.

## Gotchas

- `read_policy = "thread-only"` plus a nonempty `read_channels` is a parse error. Do not set both.
- Default master TOML is `surface`, which **does** advertise `listChannelMessages` on thread Surfaces. If you forget the env override, this loop is invalid.
- Absence of `listChannelMessages` in `toolsInvoked` is the policy proof; a green `npm test` deployConfig case is coverage only.
- After this loop, cleanup and relaunch without the override before driving loops 1–10 again.
