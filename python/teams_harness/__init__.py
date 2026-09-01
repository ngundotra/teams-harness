"""Python grok ACP handoff. The live Teams bot remains TypeScript."""

from .dispatch import dispatch_activity, dispatch_event
from .host import HarnessHost
from .prompt import drain_prompt, followup_prompt, reaction_prompt, start_prompt
from .spawn import GROK_ACP_ARGS, GROK_BIN, spawn_grok
from .turn_store import TurnStore, new_turn_id

__all__ = [
    "GROK_ACP_ARGS",
    "GROK_BIN",
    "HarnessHost",
    "TurnStore",
    "dispatch_activity",
    "dispatch_event",
    "drain_prompt",
    "followup_prompt",
    "new_turn_id",
    "reaction_prompt",
    "spawn_grok",
    "start_prompt",
]
