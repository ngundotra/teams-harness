# Python grok ACP handoff

Library-only port of the Teams harness **grok ACP handoff**. The live Bot Framework / Teams process stays in TypeScript (`src/`).

This package covers:

- spawn real `grok` (`grok agent --always-approve stdio`), never a shim
- ACP JSON-RPC over stdio (`initialize`, optional `authenticate`, `session/new` with `teams-read` + `teams-post`, `session/prompt`)
- one ACP session per conversation+thread (turn id)
- start prompt, then mid-turn injects as extra `session/prompt` on that session
- follow-ups that land before `session/new` enqueue to the turn inbox; `inject()` no-ops until the session maps are set; drain is the backup
- `injectWaits`: in-flight inject prompts must finish before the turn is considered done

MCP remains the Teams control/data plane. This host does not call Graph REST or a Graph SDK.

```bash
cd python
python3 -m pip install -e '.[dev]'
python3 -m pytest
```
