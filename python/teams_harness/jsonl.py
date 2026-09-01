from __future__ import annotations

import json
from typing import Any

from .types import is_record


def parse_json_line(line: str) -> Any | None:
    trimmed = line.strip()
    if not trimmed:
        return None
    return json.loads(trimmed)


def parse_json_object(line: str) -> dict[str, Any] | None:
    parsed = parse_json_line(line)
    if not is_record(parsed):
        return None
    return parsed
