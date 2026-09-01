from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture
def turns_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "turns"
    directory.mkdir()
    monkeypatch.setenv("TURNS_DIR", str(directory))
    monkeypatch.setenv("HARNESS_ACP_TIMEOUT_MS", "15000")
    monkeypatch.setenv("HARNESS_JOB_MS", "15000")
    return directory
