from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any


def encode_ndjson(obj: object) -> bytes:
    return (json.dumps(obj, separators=(",", ":")) + "\n").encode("utf-8")


def write_ndjson(stream: Any, obj: object) -> None:
    stream.write(encode_ndjson(obj))
    stream.flush()


def drain_jsonrpc(buf: bytes, on_message: Callable[[object], None]) -> bytes:
    while buf:
        as_text = buf.decode("utf-8", errors="surrogateescape")
        cl_match = _content_length_header(as_text)
        if cl_match is not None:
            header, n = cl_match
            header_bytes = len(header.encode("utf-8"))
            if len(buf) < header_bytes + n:
                return buf
            body = buf[header_bytes : header_bytes + n].decode("utf-8")
            buf = buf[header_bytes + n :]
            on_message(json.loads(body))
            continue
        nl = buf.find(b"\n")
        if nl == -1:
            return buf
        line = buf[:nl].decode("utf-8").rstrip("\r")
        buf = buf[nl + 1 :]
        trimmed = line.strip()
        if not trimmed or trimmed.lower().startswith("content-length:"):
            continue
        try:
            on_message(json.loads(trimmed))
        except json.JSONDecodeError:
            continue
    return buf


def _content_length_header(as_text: str) -> tuple[str, int] | None:
    import re

    match = re.match(r"^(?:[^\r\n]*\r\n)*Content-Length:\s*(\d+)\r\n\r\n", as_text, re.I)
    if match is None or match.start() != 0:
        return None
    return match.group(0), int(match.group(1), 10)
