from __future__ import annotations

import os
import shutil
from pathlib import Path

from .tools import MCP_TEAMS_READ_SERVER, MCP_TEAMS_WRITE_SERVER, McpRole, server_name_for_role
from .types import AcpEnvVar, AcpMcpServerStdio, TurnId


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        if (parent / "src" / "mcpServerMain.ts").exists() or (parent / "package.json").exists():
            if (parent / "src").is_dir():
                return parent
    return Path.cwd()


def mcp_server_entry() -> tuple[str, list[str]]:
    root = repo_root()
    js = root / "src" / "mcpServerMain.js"
    ts = root / "src" / "mcpServerMain.ts"
    # Prefer the Node MCP server that already exists in this repo. Python never talks Graph.
    node_bin = shutil.which("node") or "node"
    if js.exists():
        return node_bin, [str(js), "--stdio"]
    tsx_bin = root / "node_modules" / ".bin" / "tsx"
    tsx = str(tsx_bin) if tsx_bin.exists() else "tsx"
    return node_bin, [tsx, str(ts), "--stdio"]


def inherited_env() -> list[AcpEnvVar]:
    names = [
        "PATH",
        "HOME",
        "USER",
        "TMPDIR",
        "LANG",
        "NODE_PATH",
        "GRAPH_TOKEN",
        "GRAPH_CLIENT_ID",
        "GRAPH_CLIENT_SECRET",
        "GRAPH_TENANT_ID",
    ]
    out: list[AcpEnvVar] = []
    for name in names:
        value = os.environ.get(name)
        if value:
            out.append({"name": name, "value": value})
    return out


def common_env(
    *,
    turn_id: TurnId,
    turns_dir: str,
    conversation_id: str,
    service_url: str,
    conversation_type: str,
    callback_url: str | None = None,
) -> list[AcpEnvVar]:
    env: list[AcpEnvVar] = [
        *inherited_env(),
        {"name": "TURN_ID", "value": turn_id},
        {"name": "TURNS_DIR", "value": turns_dir},
        {"name": "CONVERSATION_ID", "value": conversation_id},
        {"name": "SERVICE_URL", "value": service_url},
        {"name": "CONVERSATION_TYPE", "value": conversation_type},
    ]
    if callback_url:
        env.append({"name": "HOST_CALLBACK_URL", "value": callback_url})
    return env


def write_scope_env(scope: dict[str, str], conversation_id: str) -> list[AcpEnvVar]:
    kind = scope.get("kind")
    if kind == "chat":
        return [
            {"name": "WRITE_KIND", "value": "chat"},
            {"name": "WRITE_CONVERSATION_ID", "value": scope["conversationId"]},
        ]
    if kind == "channel":
        return [
            {"name": "WRITE_KIND", "value": "channel"},
            {"name": "WRITE_CONVERSATION_ID", "value": conversation_id},
            {"name": "WRITE_TEAM_ID", "value": scope["teamId"]},
            {"name": "WRITE_CHANNEL_ID", "value": scope["channelId"]},
            {"name": "WRITE_THREAD_ID", "value": scope["threadId"]},
        ]
    raise ValueError(f"unknown write scope {scope!r}")


def stdio_spec(*, role: McpRole, env: list[AcpEnvVar]) -> AcpMcpServerStdio:
    command, args = mcp_server_entry()
    return {
        "type": "stdio",
        "name": server_name_for_role(role),
        "command": command,
        "args": [*args, f"--role={role}"],
        "env": env,
    }


def teams_mcp_servers(
    *,
    turn_id: TurnId,
    turns_dir: str,
    conversation_id: str,
    service_url: str,
    conversation_type: str,
    write_scope: dict[str, str],
    callback_url: str | None = None,
) -> dict[str, AcpMcpServerStdio]:
    shared = common_env(
        turn_id=turn_id,
        turns_dir=turns_dir,
        conversation_id=conversation_id,
        service_url=service_url,
        conversation_type=conversation_type,
        callback_url=callback_url,
    )
    read = stdio_spec(role="read", env=shared)
    write = stdio_spec(role="write", env=[*shared, *write_scope_env(write_scope, conversation_id)])
    return {"read": read, "write": write}


def grok_config_for_mcp(read: AcpMcpServerStdio, write: AcpMcpServerStdio) -> str:
    import json

    return json.dumps(
        {
            "mcp_servers": {
                MCP_TEAMS_READ_SERVER: {"command": read["command"], "args": read["args"]},
                MCP_TEAMS_WRITE_SERVER: {"command": write["command"], "args": write["args"]},
            }
        }
    )
