from __future__ import annotations

import os
from pathlib import Path

from teams_harness.acp_client import auth_method_id
from teams_harness.acp_stdio import drain_jsonrpc, encode_ndjson


def test_auth_method_id() -> None:
    assert auth_method_id({}) is None
    assert auth_method_id({"authMethods": [{"id": "cached_token"}]}) == "cached_token"
    assert auth_method_id("nope") == "cached_token"
    os.environ["XAI_API_KEY"] = "not-a-secret-placeholder"
    try:
        assert auth_method_id({"authMethods": [{"id": "xai.api_key"}, {"id": "cached_token"}]}) == "xai.api_key"
    finally:
        os.environ.pop("XAI_API_KEY", None)


def test_ndjson_and_content_length_reader() -> None:
    seen: list[object] = []
    first = encode_ndjson({"jsonrpc": "2.0", "id": 1, "result": {"ok": True}})
    leftover = drain_jsonrpc(first, seen.append)
    assert leftover == b""
    assert seen[0]["id"] == 1

    body = b'{"jsonrpc":"2.0","id":2,"result":{}}'
    framed = f"Content-Length: {len(body)}\r\n\r\n".encode("utf-8") + body
    leftover = drain_jsonrpc(framed, seen.append)
    assert leftover == b""
    assert seen[1]["id"] == 2
