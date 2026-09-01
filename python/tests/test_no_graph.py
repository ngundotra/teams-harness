from __future__ import annotations

from pathlib import Path

PY_ROOT = Path(__file__).resolve().parents[1]
PKG = PY_ROOT / "teams_harness"

FORBIDDEN = (
    "graph.microsoft.com",
    "@microsoft/microsoft-graph-client",
    "GraphServiceClient",
    "msgraph",
    "azure.identity",
    "msal",
    "api.reactions",
)


def test_python_host_has_no_graph_client_or_rest() -> None:
    for path in PKG.rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        for token in FORBIDDEN:
            assert token not in src, f"{path} contains {token}"
        assert "harnessWorker" not in src
