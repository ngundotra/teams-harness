"""Prove inject hits session/prompt on a recorded ACP stream.

Also proves the pre-session follow-up path: inject no-ops, inbox+drain is the backup.
Does not invent a second conversation or turn.
"""

from __future__ import annotations

from pathlib import Path

from teams_harness.dispatch import dispatch_event
from teams_harness.inbox import pending_inbox_count, read_inbox_lines
from teams_harness.prompt import followup_prompt

from fixtures import inbound_message, inbound_reaction
from helpers import (
    make_host,
    prompt_phase,
    prompt_text,
    read_jsonl,
    session_prompts,
    spawn_recorded,
    touch,
    wait_log,
    wait_until,
)


def test_inject_noops_when_session_maps_empty(turns_dir: Path) -> None:
    host = make_host()
    host.inject("trn_missing", followup_prompt(inbound_message("m-early", "queued")))
    assert host.session_id("trn_missing") is None
    assert host.acp_client("trn_missing") is None


def test_followup_before_session_new_enqueues_and_drains_not_injects(turns_dir: Path, tmp_path: Path) -> None:
    log_path = tmp_path / "acp.jsonl"
    hold_session = tmp_path / "release-session"
    extra = {
        "RECORDED_ACP_LOG": str(log_path),
        "RECORDED_ACP_HOLD_SESSION": str(hold_session),
        "RECORDED_ACP_SESSION": "sess_early_1",
    }
    host = make_host(spawn=lambda env: spawn_recorded(env, extra))
    try:
        started = dispatch_event(host, inbound_message("msg-1", "hello world"))
        assert started.kind == "started"
        turn_id = started.turn_id
        assert host.store.running_count() == 1
        assert host.session_id(turn_id) is None

        enqueued = dispatch_event(host, inbound_message("msg-2", "follow up please"))
        assert enqueued.kind == "enqueued"
        assert enqueued.turn_id == turn_id
        assert host.store.get_spawn_count() == 1
        assert pending_inbox_count(turn_id) == 1
        items = read_inbox_lines(turn_id)
        assert items[0].kind == "followup"
        assert items[0].message.text == "follow up please"

        wait_log(log_path, lambda rows: any(r.get("method") == "initialize" for r in rows))
        assert not any(r.get("method") == "session/prompt" for r in read_jsonl(log_path))
        assert host.session_id(turn_id) is None

        touch(hold_session)
        host.wait_until_done(turn_id, 20000)

        log = read_jsonl(log_path)
        methods = [r.get("method") for r in log]
        assert "initialize" in methods
        assert "authenticate" in methods
        assert "session/new" in methods
        created = next(r for r in log if r.get("method") == "session/new")
        params = created.get("params")
        assert isinstance(params, dict)
        servers = params.get("mcpServers")
        assert isinstance(servers, list)
        names = [s.get("name") for s in servers if isinstance(s, dict)]
        assert names == ["teams-read", "teams-post"]

        phases = [prompt_phase(r) for r in session_prompts(log)]
        assert "start" in phases
        assert "drain" in phases
        assert "inject" not in phases
        assert host.store.get_by_id(turn_id).kind == "done"
        assert host.store.running_count() == 0
    finally:
        host.dispose()


def test_inject_hits_session_prompt_on_recorded_stream(turns_dir: Path, tmp_path: Path) -> None:
    log_path = tmp_path / "acp.jsonl"
    hold_start = tmp_path / "release-start"
    extra = {
        "RECORDED_ACP_LOG": str(log_path),
        "RECORDED_ACP_HOLD_START": str(hold_start),
        "RECORDED_ACP_SESSION": "sess_inject_1",
    }
    host = make_host(spawn=lambda env: spawn_recorded(env, extra))
    try:
        started = dispatch_event(host, inbound_message("msg-1", "hello world"))
        assert started.kind == "started"
        turn_id = started.turn_id
        assert host.wait_session(turn_id, 10.0)
        assert host.session_id(turn_id) == "sess_inject_1"

        wait_log(log_path, lambda rows: any(prompt_phase(r) == "start" for r in session_prompts(rows)))

        follow = inbound_message("msg-2", "star this please")
        result = dispatch_event(host, follow)
        assert result.kind == "enqueued"
        assert result.turn_id == turn_id
        assert host.store.get_spawn_count() == 1
        assert pending_inbox_count(turn_id) == 1

        log = wait_log(log_path, lambda rows: any(prompt_phase(r) == "inject" for r in session_prompts(rows)))
        injects = [r for r in session_prompts(log) if prompt_phase(r) == "inject"]
        assert len(injects) == 1
        text = prompt_text(injects[0])
        assert '"phase":"inject"' in text
        assert '"kind":"followup"' in text
        assert "star this please" in text
        params = injects[0].get("params")
        assert isinstance(params, dict)
        assert params.get("sessionId") == "sess_inject_1"

        touch(hold_start)
        host.wait_until_done(turn_id, 20000)
        assert host.store.get_by_id(turn_id).kind == "done"
    finally:
        host.dispose()


def test_inject_waits_before_turn_done(turns_dir: Path, tmp_path: Path) -> None:
    log_path = tmp_path / "acp.jsonl"
    hold_start = tmp_path / "release-start"
    hold_inject = tmp_path / "release-inject"
    extra = {
        "RECORDED_ACP_LOG": str(log_path),
        "RECORDED_ACP_HOLD_START": str(hold_start),
        "RECORDED_ACP_HOLD_INJECT": str(hold_inject),
        "RECORDED_ACP_SESSION": "sess_waits_1",
    }
    host = make_host(spawn=lambda env: spawn_recorded(env, extra))
    try:
        started = dispatch_event(host, inbound_message("msg-1", "hello world"))
        turn_id = started.turn_id
        assert host.wait_session(turn_id, 10.0)
        wait_log(log_path, lambda rows: any(prompt_phase(r) == "start" for r in session_prompts(rows)))

        dispatch_event(host, inbound_message("msg-2", "follow up please"))
        wait_log(log_path, lambda rows: any(prompt_phase(r) == "inject" for r in session_prompts(rows)))

        touch(hold_start)
        wait_until(lambda: any(prompt_phase(r) == "start" for r in session_prompts(read_jsonl(log_path))), 5.0)
        # Start prompt has returned on the wire, but inject is still held.
        time_state = host.store.get_by_id(turn_id)
        assert time_state is not None and time_state.kind == "running"

        done_before_release = False
        try:
            host.wait_until_done(turn_id, 400)
            done_before_release = True
        except TimeoutError:
            done_before_release = False
        assert done_before_release is False
        assert host.store.get_by_id(turn_id).kind == "running"

        touch(hold_inject)
        host.wait_until_done(turn_id, 20000)
        assert host.store.get_by_id(turn_id).kind == "done"
    finally:
        host.dispose()


def test_reaction_after_session_injects_same_session(turns_dir: Path, tmp_path: Path) -> None:
    log_path = tmp_path / "acp.jsonl"
    hold_start = tmp_path / "release-start"
    extra = {
        "RECORDED_ACP_LOG": str(log_path),
        "RECORDED_ACP_HOLD_START": str(hold_start),
        "RECORDED_ACP_SESSION": "sess_rxn_1",
    }
    host = make_host(spawn=lambda env: spawn_recorded(env, extra))
    try:
        started = dispatch_event(host, inbound_message("msg-1", "hello world"))
        turn_id = started.turn_id
        assert host.wait_session(turn_id, 10.0)
        wait_log(log_path, lambda rows: any(prompt_phase(r) == "start" for r in session_prompts(rows)))

        ferried = dispatch_event(host, inbound_reaction("msg-1", "like"))
        assert ferried.kind == "ferried"
        assert ferried.turn_id == turn_id

        log = wait_log(log_path, lambda rows: any(prompt_phase(r) == "inject" for r in session_prompts(rows)))
        injects = [r for r in session_prompts(log) if prompt_phase(r) == "inject"]
        assert any('"kind":"reaction"' in prompt_text(r) for r in injects)
        assert any(r.get("params", {}).get("sessionId") == "sess_rxn_1" for r in injects)

        touch(hold_start)
        host.wait_until_done(turn_id, 20000)
    finally:
        host.dispose()


def test_one_session_per_conversation_thread(turns_dir: Path, tmp_path: Path) -> None:
    log_path = tmp_path / "acp.jsonl"
    hold_session = tmp_path / "release-session"
    extra = {
        "RECORDED_ACP_LOG": str(log_path),
        "RECORDED_ACP_HOLD_SESSION": str(hold_session),
    }
    host = make_host(spawn=lambda env: spawn_recorded(env, extra))
    try:
        first = dispatch_event(host, inbound_message("a1", "hello", conversation_id="a:chat-1"))
        second = dispatch_event(host, inbound_message("a2", "again", conversation_id="a:chat-1"))
        other = dispatch_event(
            host,
            inbound_message(
                "b1",
                "other thread",
                conversation_id="19:channel-1@thread.tacv2",
                conversation_key="19:channel-1@thread.tacv2;thread=root-9",
                conversation_type="channel",
                team_id="team-1",
                channel_id="19:channel-1@thread.tacv2",
                reply_to_id="root-9",
            ),
        )
        assert first.kind == "started"
        assert second.kind == "enqueued"
        assert second.turn_id == first.turn_id
        assert other.kind == "started"
        assert other.turn_id != first.turn_id
        assert host.store.get_spawn_count() == 2
        assert host.store.running_count() == 2
    finally:
        host.dispose()
