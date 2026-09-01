from __future__ import annotations

from teams_harness.mcp_spec import teams_mcp_servers
from teams_harness.tools import MCP_TEAMS_READ_SERVER, MCP_TEAMS_WRITE_SERVER


def test_teams_mcp_servers_split_read_write() -> None:
    servers = teams_mcp_servers(
        turn_id="t-spec",
        turns_dir="/tmp/turns-spec",
        conversation_id="19:channel-1@thread.tacv2;messageid=root-1",
        service_url="http://localhost",
        conversation_type="channel",
        write_scope={"kind": "channel", "teamId": "team-1", "channelId": "channel-1", "threadId": "root-1"},
    )
    assert servers["read"]["name"] == MCP_TEAMS_READ_SERVER
    assert servers["write"]["name"] == MCP_TEAMS_WRITE_SERVER
    assert "--role=write" in servers["write"]["args"]
    assert "--role=read" in servers["read"]["args"]
    assert any(e["name"] == "WRITE_THREAD_ID" and e["value"] == "root-1" for e in servers["write"]["env"])
    assert not any(e["name"] == "WRITE_THREAD_ID" for e in servers["read"]["env"])
