from __future__ import annotations

from pathlib import Path

from teams_harness.dispatch import dispatch_activity, dispatch_event
from teams_harness.parse_activity import parse_activity

from fixtures import inbound_message, personal_activity, thread_activity
from helpers import make_host, spawn_recorded, touch


def test_dispatch_enqueues_on_running_conversation(turns_dir: Path, tmp_path: Path) -> None:
    hold_session = tmp_path / "release-session"
    extra = {
        "RECORDED_ACP_LOG": str(tmp_path / "acp.jsonl"),
        "RECORDED_ACP_HOLD_SESSION": str(hold_session),
    }
    host = make_host(spawn=lambda env: spawn_recorded(env, extra))
    try:
        first = dispatch_event(host, inbound_message("msg-1", "hello world"))
        second = dispatch_event(host, inbound_message("msg-2", "follow up please"))
        assert first.kind == "started"
        assert second.kind == "enqueued"
        assert second.turn_id == first.turn_id
        running = host.store.get_running("a:chat-1")
        assert running is not None
        assert len(running.followups) == 1
        assert running.followups[0].text == "follow up please"
        assert host.acks[0].text.startswith("Working")
    finally:
        host.dispose()


def test_dispatch_activity_uses_conversation_plus_thread() -> None:
    parsed = parse_activity(thread_activity("m1", "channel hello", "root-1"))
    assert parsed.kind == "ok"
    assert parsed.event.kind == "message"
    assert parsed.event.surface["kind"] == "thread"
    assert parsed.event.surface["threadId"] == "root-1"
    assert parsed.event.conversation_key == "19:channel-1@thread.tacv2;messageid=root-1"


def test_dispatch_activity_personal_roundtrip(turns_dir: Path, tmp_path: Path) -> None:
    hold_session = tmp_path / "release-session"
    extra = {
        "RECORDED_ACP_LOG": str(tmp_path / "acp.jsonl"),
        "RECORDED_ACP_HOLD_SESSION": str(hold_session),
    }
    host = make_host(spawn=lambda env: spawn_recorded(env, extra))
    try:
        results = dispatch_activity(host, personal_activity("msg-1", "hello world"))
        assert results[0].kind == "started"
        again = dispatch_activity(host, personal_activity("msg-2", "follow up please"))
        assert again[0].kind == "enqueued"
        touch(hold_session)
    finally:
        host.dispose()
