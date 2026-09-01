from __future__ import annotations

import re

from teams_harness.prompt import drain_prompt, followup_prompt, start_prompt
from teams_harness.tools import TOOL_CHAT_POST, TOOL_DRAIN_INBOX

from fixtures import inbound_message


def test_start_prompt_does_not_tell_grok_to_sleep() -> None:
    text = start_prompt(inbound_message("m1", "hi"))
    assert "injected as extra prompts" in text
    assert "Do not sleep" in text
    assert TOOL_CHAT_POST in text
    assert TOOL_DRAIN_INBOX in text
    assert not re.search(r"Work for \d+ ms|seconds have elapsed|sleep \d+", text, re.I)


def test_followup_and_drain_prompts() -> None:
    follow = followup_prompt(inbound_message("m2", "follow up please"))
    assert '"phase":"inject"' in follow
    assert "follow up please" in follow
    drain = drain_prompt()
    assert '"phase":"drain"' in drain
    assert TOOL_DRAIN_INBOX in drain
