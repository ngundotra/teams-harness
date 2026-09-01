from __future__ import annotations

from pathlib import Path

from teams_harness.spawn import GROK_ACP_ARGS, GROK_BIN, path_with_local_grok, which_grok


ROOT = Path(__file__).resolve().parents[2]
PY_ROOT = Path(__file__).resolve().parents[1]


def _walk_py(directory: Path) -> list[Path]:
    out: list[Path] = []
    for path in directory.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        out.append(path)
    return out


def test_grok_acp_args_are_official_stdio_argv() -> None:
    assert GROK_BIN == "grok"
    assert list(GROK_ACP_ARGS) == [
        "--no-auto-update",
        "--disallowed-tools",
        "search_tool,Agent,run_terminal_command",
        "agent",
        "--always-approve",
        "stdio",
    ]


def test_spawn_module_has_no_shim() -> None:
    spawn_src = (PY_ROOT / "teams_harness" / "spawn.py").read_text(encoding="utf-8")
    host_src = (PY_ROOT / "teams_harness" / "host.py").read_text(encoding="utf-8")
    assert "Popen" in spawn_src and "GROK_BIN" in spawn_src
    assert "[GROK_BIN, *GROK_ACP_ARGS]" in spawn_src or "GROK_ACP_ARGS" in spawn_src
    assert "harnessWorker" not in spawn_src
    assert "harnessWorker" not in host_src
    assert "test/shim" not in spawn_src
    assert "fakeGrok" not in spawn_src
    assert "GROK_USE_SHIM" not in spawn_src
    assert not (ROOT / "bin" / "grok").exists()
    assert not (ROOT / "test" / "shim" / "fakeGrok.ts").exists()


def test_path_with_local_grok_never_uses_repo_shim(tmp_path: Path) -> None:
    built = path_with_local_grok({"HOME": str(tmp_path), "PATH": "/usr/bin"})
    assert str(ROOT / "bin") not in built
    assert "/test/shim" not in built
    grok_home = tmp_path / ".grok" / "bin"
    (grok_home).mkdir(parents=True)
    (grok_home / "grok").write_text("", encoding="utf-8")
    built_present = path_with_local_grok({"HOME": str(tmp_path), "PATH": "/usr/bin"})
    assert built_present.split(":")[0] == str(grok_home)


def test_which_grok_is_optional() -> None:
    # Live grok is not required for the recorded-stream proof.
    found = which_grok()
    assert found is None or found.endswith("grok")
