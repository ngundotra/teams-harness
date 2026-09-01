from __future__ import annotations

import os
import sys
import threading
from collections.abc import Callable
from concurrent.futures import Future
from pathlib import Path
from subprocess import PIPE, Popen
from typing import Any

from .acp_stdio import drain_jsonrpc, write_ndjson
from .types import JsonRpcId, is_record, read_number, read_string


def acp_timeout_ms() -> int:
    raw = os.environ.get("HARNESS_ACP_TIMEOUT_MS")
    if raw:
        try:
            n = int(raw, 10)
        except ValueError:
            n = 0
        if n > 0:
            return n
    return 120_000


def json_rpc_id(value: object) -> JsonRpcId | None:
    if isinstance(value, str) or (isinstance(value, int) and not isinstance(value, bool)):
        return value
    return None


def is_secret_path(path: str) -> bool:
    n = path.replace("\\", "/").lower()
    return n.endswith("/auth.json") or "/.grok/auth" in n or n.endswith("auth.json")


class _Term:
    def __init__(self, child: Popen[bytes], byte_limit: int) -> None:
        self.child = child
        self.output = ""
        self.truncated = False
        self.exit_code: int | None = None
        self.signal: str | None = None
        self.byte_limit = byte_limit
        self.closed = threading.Event()


class AcpClient:
    def __init__(self, child: Popen[bytes]) -> None:
        self.child = child
        self.next_id = 1
        self.term_seq = 0
        self.pending: dict[JsonRpcId, Future[object]] = {}
        self.terminals: dict[str, _Term] = {}
        self.agent_text = ""
        self._write_lock = threading.Lock()
        self._id_lock = threading.Lock()
        if self.child.stdout is None:
            raise RuntimeError("grok child missing stdout")
        self._reader = threading.Thread(target=self._read_loop, name="acp-reader", daemon=True)
        self._reader.start()
        if self.child.stderr is not None:
            threading.Thread(target=self._stderr_loop, name="acp-stderr", daemon=True).start()
        threading.Thread(target=self._wait_exit, name="acp-exit", daemon=True).start()

    def request(self, method: str, params: object, timeout_ms: int | None = None) -> Future[object]:
        limit = acp_timeout_ms() if timeout_ms is None else timeout_ms
        with self._id_lock:
            req_id = self.next_id
            self.next_id += 1
        fut: Future[object] = Future()
        self.pending[req_id] = fut
        if self.child.stdin is None:
            self.pending.pop(req_id, None)
            fut.set_exception(RuntimeError("grok stdin closed"))
            return fut

        def _timeout() -> None:
            pending = self.pending.pop(req_id, None)
            if pending is not None and not pending.done():
                pending.set_exception(TimeoutError(f"{method} timed out"))

        timer = threading.Timer(limit / 1000, _timeout)
        timer.daemon = True
        timer.start()

        def _clear_timer(done: Future[object]) -> None:
            timer.cancel()

        fut.add_done_callback(_clear_timer)
        try:
            self._write({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
        except OSError as err:
            self.pending.pop(req_id, None)
            if not fut.done():
                fut.set_exception(err)
        return fut

    def _write(self, obj: object) -> None:
        if self.child.stdin is None:
            return
        with self._write_lock:
            write_ndjson(self.child.stdin, obj)

    def _reply(self, req_id: JsonRpcId, result: object) -> None:
        if self.child.stdin is None:
            return
        self._write({"jsonrpc": "2.0", "id": req_id, "result": result})

    def _reply_error(self, req_id: JsonRpcId, message: str, code: int = -32000) -> None:
        if self.child.stdin is None:
            return
        self._write({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})

    def _read_loop(self) -> None:
        assert self.child.stdout is not None
        buf = b""
        try:
            while True:
                chunk = self.child.stdout.read(4096)
                if not chunk:
                    break
                buf = drain_jsonrpc(buf + chunk, self._on_message)
        except OSError:
            return

    def _stderr_loop(self) -> None:
        assert self.child.stderr is not None
        try:
            for chunk in iter(lambda: self.child.stderr.read(4096) if self.child.stderr else b"", b""):
                if not chunk:
                    break
                sys.stderr.write(f"[grok] {chunk.decode('utf-8', errors='replace')}")
        except OSError:
            return

    def _wait_exit(self) -> None:
        self.child.wait()
        for pending in list(self.pending.values()):
            if not pending.done():
                pending.set_exception(RuntimeError("grok exited"))
        self.pending.clear()
        for term in list(self.terminals.values()):
            if term.child.poll() is None:
                term.child.terminate()
        self.terminals.clear()

    def _on_message(self, value: object) -> None:
        if not is_record(value):
            return
        method = read_string(value.get("method"))
        if method is not None:
            if method != "session/update":
                sys.stderr.write(f"[acp] <- {method}\n")
            self._on_agent_request(method, json_rpc_id(value.get("id")), value.get("params"))
            return
        req_id = json_rpc_id(value.get("id"))
        if req_id is None:
            return
        pending = self.pending.pop(req_id, None)
        if pending is None:
            return
        if value.get("error") is not None:
            err = value.get("error")
            text = json_dumps(err) if is_record(err) else "acp error"
            if not pending.done():
                pending.set_exception(RuntimeError(text))
            return
        if not pending.done():
            pending.set_result(value.get("result") if value.get("result") is not None else {})

    def _on_agent_request(self, method: str, req_id: JsonRpcId | None, params: object) -> None:
        if method == "session/update":
            self._on_session_update(params)
            return
        if req_id is None:
            return
        try:
            if method == "session/request_permission":
                self._reply(req_id, {"outcome": {"outcome": "selected", "optionId": permission_option_id(params)}})
                return
            if method == "fs/read_text_file":
                self._reply(req_id, {"content": self._read_text_file(params)})
                return
            if method == "fs/write_text_file":
                self._write_text_file(params)
                self._reply(req_id, None)
                return
            if method == "terminal/create":
                self._reply(req_id, {"terminalId": self._create_terminal(params)})
                return
            if method == "terminal/output":
                self._reply(req_id, self._terminal_output(params))
                return
            if method == "terminal/wait_for_exit":
                threading.Thread(
                    target=self._wait_for_exit,
                    args=(req_id, params),
                    name="acp-term-wait",
                    daemon=True,
                ).start()
                return
            if method == "terminal/kill":
                self._kill_terminal(params, release=False)
                self._reply(req_id, {})
                return
            if method == "terminal/release":
                self._kill_terminal(params, release=True)
                self._reply(req_id, {})
                return
            if method == "elicitation/create":
                self._reply(req_id, {"action": "cancel"})
                return
            if method.startswith("_") or method.startswith("x.ai/"):
                self._reply(req_id, {})
                return
            self._reply_error(req_id, f"method not found: {method}", -32601)
        except Exception as err:  # noqa: BLE001 — match TS host: reply the error, keep the session
            message = str(err) if err else "acp client error"
            self._reply_error(req_id, message)

    def _read_text_file(self, params: object) -> str:
        if not is_record(params):
            raise RuntimeError("fs/read_text_file missing params")
        path = read_string(params.get("path"))
        if path is None:
            raise RuntimeError("fs/read_text_file missing path")
        if is_secret_path(path):
            raise RuntimeError("refused")
        text = Path(path).read_text(encoding="utf-8")
        line = read_number(params.get("line"))
        limit = read_number(params.get("limit"))
        if line is not None or limit is not None:
            lines = text.split("\n")
            start = max(0, int(line or 1) - 1)
            end = start + int(limit) if limit is not None else len(lines)
            text = "\n".join(lines[start:end])
        return text

    def _write_text_file(self, params: object) -> None:
        if not is_record(params):
            raise RuntimeError("fs/write_text_file missing params")
        path = read_string(params.get("path"))
        content = read_string(params.get("content")) or ""
        if path is None:
            raise RuntimeError("fs/write_text_file missing path")
        if is_secret_path(path):
            raise RuntimeError("refused")
        dest = Path(path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")

    def _create_terminal(self, params: object) -> str:
        if not is_record(params):
            raise RuntimeError("terminal/create missing params")
        command = read_string(params.get("command"))
        if not command:
            raise RuntimeError("terminal/create missing command")
        raw_args = params.get("args")
        args = [a for a in raw_args if isinstance(a, str)] if isinstance(raw_args, list) else []
        cwd = read_string(params.get("cwd")) or os.getcwd()
        env = {**os.environ}
        raw_env = params.get("env")
        if isinstance(raw_env, list):
            for item in raw_env:
                if is_record(item):
                    name = read_string(item.get("name"))
                    value = read_string(item.get("value"))
                    if name is not None and value is not None:
                        env[name] = value
        byte_limit = int(read_number(params.get("outputByteLimit")) or 1_048_576)
        if not args:
            child = Popen(["/bin/bash", "-lc", command], cwd=cwd, env=env, stdin=PIPE, stdout=PIPE, stderr=PIPE)
        else:
            child = Popen([command, *args], cwd=cwd, env=env, stdin=PIPE, stdout=PIPE, stderr=PIPE)
        self.term_seq += 1
        terminal_id = f"term_{self.term_seq}"
        term = _Term(child, byte_limit)
        self.terminals[terminal_id] = term

        def _append(chunk: bytes) -> None:
            text = chunk.decode("utf-8", errors="replace")
            term.output += text
            if len(term.output) > byte_limit:
                term.output = term.output[-byte_limit:]
                term.truncated = True

        def _pump() -> None:
            try:
                while True:
                    if child.stdout is None:
                        break
                    chunk = child.stdout.read(4096)
                    if not chunk:
                        break
                    _append(chunk)
            finally:
                if child.stderr is not None:
                    extra = child.stderr.read()
                    if extra:
                        _append(extra)
                code = child.wait()
                term.exit_code = code
                term.signal = None
                term.closed.set()

        threading.Thread(target=_pump, name=f"acp-{terminal_id}", daemon=True).start()
        sys.stderr.write(f"[acp] terminal {terminal_id} {command} {' '.join(args)}\n")
        return terminal_id

    def _get_term(self, params: object) -> _Term:
        if not is_record(params):
            raise RuntimeError("terminal missing params")
        terminal_id = read_string(params.get("terminalId"))
        if terminal_id is None:
            raise RuntimeError("terminal missing terminalId")
        term = self.terminals.get(terminal_id)
        if term is None:
            raise RuntimeError(f"unknown terminal {terminal_id}")
        return term

    def _terminal_output(self, params: object) -> dict[str, object]:
        term = self._get_term(params)
        result: dict[str, object] = {"output": term.output, "truncated": term.truncated}
        if term.exit_code is not None or term.signal is not None:
            result["exitStatus"] = {"exitCode": term.exit_code, "signal": term.signal}
        return result

    def _wait_for_exit(self, req_id: JsonRpcId, params: object) -> None:
        try:
            term = self._get_term(params)
            if term.exit_code is None and term.signal is None:
                term.closed.wait()
            self._reply(req_id, {"exitCode": term.exit_code, "signal": term.signal})
        except Exception as err:  # noqa: BLE001
            self._reply_error(req_id, str(err) if err else "terminal wait failed")

    def _kill_terminal(self, params: object, release: bool) -> None:
        if not is_record(params):
            raise RuntimeError("terminal missing params")
        terminal_id = read_string(params.get("terminalId"))
        if terminal_id is None:
            raise RuntimeError("terminal missing terminalId")
        term = self.terminals.get(terminal_id)
        if term is None:
            return
        if term.child.poll() is None:
            term.child.terminate()
        if release:
            self.terminals.pop(terminal_id, None)

    def _on_session_update(self, params: object) -> None:
        if not is_record(params):
            return
        update = params.get("update")
        if not is_record(update):
            return
        kind = read_string(update.get("sessionUpdate"))
        if kind in ("tool_call", "tool_call_update"):
            title = read_string(update.get("title")) or read_string(update.get("toolCallId")) or ""
            sys.stderr.write(f"[acp] {kind} {title}\n")
        if kind != "agent_message_chunk":
            return
        content = update.get("content")
        if not is_record(content):
            return
        text = read_string(content.get("text"))
        if text is not None:
            self.agent_text += text


def permission_option_id(params: object) -> str:
    if not is_record(params) or not isinstance(params.get("options"), list):
        return "allow-once"
    ids: list[str] = []
    for item in params["options"]:
        if is_record(item):
            option = read_string(item.get("optionId")) or read_string(item.get("id"))
            if option is not None:
                ids.append(option)
    for preferred in ("allow_always", "allow-always", "allow-once", "allow_once"):
        if preferred in ids:
            return preferred
    return ids[0] if ids else "allow-once"


def auth_method_id(init: object) -> str | None:
    if not is_record(init):
        return "cached_token"
    methods = init.get("authMethods")
    ids: set[str] = set()
    if isinstance(methods, list):
        for item in methods:
            if is_record(item):
                method_id = read_string(item.get("id"))
                if method_id is not None:
                    ids.add(method_id)
    if not ids:
        return None
    xai = os.environ.get("XAI_API_KEY")
    if xai and "xai.api_key" in ids:
        return "xai.api_key"
    if "cached_token" in ids:
        return "cached_token"
    return next(iter(ids))


def json_dumps(value: object) -> str:
    import json

    return json.dumps(value)


SpawnFn = Callable[..., Popen[bytes]]
