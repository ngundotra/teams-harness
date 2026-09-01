from __future__ import annotations

import os
import shutil
import sys
from collections.abc import Mapping
from pathlib import Path
from subprocess import PIPE, Popen

GROK_BIN = "grok"
GROK_ACP_ARGS: tuple[str, ...] = (
    "--no-auto-update",
    "--disallowed-tools",
    "search_tool,Agent,run_terminal_command",
    "agent",
    "--always-approve",
    "stdio",
)


def _grok_dir_if_present(directory: Path) -> list[str]:
    return [str(directory)] if (directory / "grok").exists() else []


def path_with_local_grok(env: Mapping[str, str] | None = None) -> str:
    source = env if env is not None else os.environ
    current = source.get("PATH") or os.environ.get("PATH") or ""
    home = source.get("HOME") or os.environ.get("HOME") or str(Path.home())
    prefix = [
        *_grok_dir_if_present(Path(home) / ".grok" / "bin"),
        *_grok_dir_if_present(Path(home) / ".local" / "bin"),
    ]
    return ":".join([*prefix, current]) if prefix else current


def spawn_grok(env: Mapping[str, str] | None = None) -> Popen[bytes]:
    merged = {**os.environ, **(dict(env) if env is not None else {})}
    merged["PATH"] = path_with_local_grok(merged)
    merged["GROK_SUBAGENTS"] = "0"
    try:
        child = Popen(  # noqa: S603 — production spawn is always the real grok CLI
            [GROK_BIN, *GROK_ACP_ARGS],
            stdin=PIPE,
            stdout=PIPE,
            stderr=PIPE,
            env=merged,
        )
    except OSError as err:
        sys.stderr.write(f"[host] grok spawn: {err}\n")
        raise
    return child


def which_grok(env: Mapping[str, str] | None = None) -> str | None:
    path = path_with_local_grok(env)
    return shutil.which(GROK_BIN, path=path)
