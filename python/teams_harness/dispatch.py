from __future__ import annotations

from typing import TYPE_CHECKING

from .parse_activity import parse_activity, parse_reaction_all
from .types import (
    DispatchDropped,
    DispatchEnqueued,
    DispatchFerried,
    DispatchIgnored,
    DispatchResult,
    DispatchStarted,
    InboundEvent,
)

if TYPE_CHECKING:
    from .host import HarnessHost


def dispatch_event(host: HarnessHost, event: InboundEvent) -> DispatchResult:
    if event.kind == "message":
        running = host.store.get_running(event.conversation_key)
        if running is not None:
            host.enqueue_followup(running.turn_id, event)
            return DispatchEnqueued(kind="enqueued", turn_id=running.turn_id)
        started = host.start_turn(event)
        return DispatchStarted(kind="started", turn_id=started.turn_id)
    if event.kind == "reaction":
        running = host.store.get_running(event.conversation_key)
        if running is None:
            return DispatchDropped(kind="dropped", reason="no running turn for reaction")
        host.ferry_reaction(running.turn_id, event)
        return DispatchFerried(kind="ferried", turn_id=running.turn_id)
    if event.kind == "ignored":
        return DispatchIgnored(kind="ignored", reason=event.reason)
    raise TypeError(f"unknown inbound event {event!r}")


def dispatch_activity(host: HarnessHost, body: object) -> list[DispatchResult]:
    parsed = parse_activity(body)
    if parsed.kind == "error":
        return [DispatchDropped(kind="dropped", reason=parsed.message)]
    if parsed.event.kind == "reaction":
        return [dispatch_event(host, event) for event in parse_reaction_all(body)]
    return [dispatch_event(host, parsed.event)]
