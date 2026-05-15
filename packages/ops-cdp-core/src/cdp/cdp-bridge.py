#!/usr/bin/env python3
"""Small CDP bridge used by repos/ops package outputs.

The command contract intentionally matches the earlier Zig bridge:

  cdp-bridge version [--addr 127.0.0.1] [--port 9222]
  cdp-bridge wsurl   [--addr 127.0.0.1] [--port 9222]
  cdp-bridge list    [--addr 127.0.0.1] [--port 9222]
  cdp-bridge new     [--addr 127.0.0.1] [--port 9222] [--url about:blank]
  cdp-bridge close   [--addr 127.0.0.1] [--port 9222] --id <targetId>
  cdp-bridge call    --ws <ws://...> --req <json> [--timeout-ms 30000]
  cdp-bridge filechooser --ws <ws://...> --selector <css> --file <path> [--file <path> ...] [--click-mode direct|mouse|programmatic] [--timeout-ms 30000]

This implementation is Python standard-library only. It avoids pinning the ops
flake to a Zig stdlib version while preserving the transport functionality that
other package-backed commands consume.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import os
import secrets
import socket
import struct
import sys
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional


class BridgeError(Exception):
    """User-facing bridge error."""


@dataclass(frozen=True)
class AddrPort:
    addr: str = "127.0.0.1"
    port: int = 9222


@dataclass(frozen=True)
class WsUrl:
    host: str
    port: int
    path: str


def usage() -> str:
    return (
        "cdp-bridge: minimal CDP helper (HTTP + WebSocket)\n\n"
        "usage:\n"
        "  cdp-bridge version [--addr 127.0.0.1] [--port 9222]\n"
        "  cdp-bridge wsurl   [--addr 127.0.0.1] [--port 9222]\n"
        "  cdp-bridge list    [--addr 127.0.0.1] [--port 9222]\n"
        "  cdp-bridge new     [--addr 127.0.0.1] [--port 9222] [--url about:blank]\n"
        "  cdp-bridge close   [--addr 127.0.0.1] [--port 9222] --id <targetId>\n"
        "  cdp-bridge call    --ws <ws://...> --req <json> [--timeout-ms 30000]\n"
        "  cdp-bridge filechooser --ws <ws://...> --selector <css> --file <path> [--file <path> ...] [--click-mode direct|mouse|programmatic] [--timeout-ms 30000]\n"
    )


def die(message: str, code: int = 2) -> int:
    sys.stderr.write(f"{message}\n")
    sys.stderr.write(usage())
    return code


def parse_flag_value(argv: list[str], start: int, flag: str) -> Optional[str]:
    i = start
    while i < len(argv):
        if argv[i] == flag:
            if i + 1 >= len(argv):
                return None
            return argv[i + 1]
        i += 1
    return None


def parse_flag_values(argv: list[str], start: int, flag: str) -> list[str]:
    values: list[str] = []
    i = start
    while i < len(argv):
        if argv[i] == flag:
            if i + 1 >= len(argv):
                return values
            values.append(argv[i + 1])
            i += 2
            continue
        i += 1
    return values


def parse_addr_port(argv: list[str], start: int) -> AddrPort:
    addr = "127.0.0.1"
    port = 9222
    i = start
    while i < len(argv):
        arg = argv[i]
        if arg == "--addr":
            if i + 1 >= len(argv):
                raise BridgeError("missing value for --addr")
            addr = argv[i + 1]
            i += 2
            continue
        if arg == "--port":
            if i + 1 >= len(argv):
                raise BridgeError("missing value for --port")
            try:
                port = int(argv[i + 1], 10)
            except ValueError as exc:
                raise BridgeError(f"invalid port: {argv[i + 1]}") from exc
            if not (0 <= port <= 65535):
                raise BridgeError(f"invalid port: {port}")
            i += 2
            continue
        i += 1
    return AddrPort(addr=addr, port=port)


def parse_timeout_ms(value: Optional[str]) -> int:
    if value is None:
        return 30000
    try:
        parsed = int(value, 10)
    except ValueError as exc:
        raise BridgeError(f"invalid timeout: {value}") from exc
    if parsed < 0:
        raise BridgeError(f"invalid timeout: {value}")
    return parsed


def http_request(addr: str, port: int, method: str, path: str, timeout_ms: int = 30000) -> bytes:
    timeout = max(timeout_ms, 1) / 1000.0
    conn = http.client.HTTPConnection(addr, port, timeout=timeout)
    try:
        conn.request(method, path, headers={"Connection": "close"})
        resp = conn.getresponse()
        body = resp.read(8 * 1024 * 1024 + 1)
    finally:
        conn.close()
    if len(body) > 8 * 1024 * 1024:
        raise BridgeError("response body too large")
    return body


def write_json_or_string(body: bytes) -> None:
    text = body.decode("utf-8", errors="replace")
    stripped = text.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        sys.stdout.write(stripped + "\n")
        return
    sys.stdout.write(json.dumps(text.rstrip("\r\n"), ensure_ascii=False) + "\n")


def parse_json_object(body: bytes) -> Mapping[str, Any]:
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BridgeError("invalid JSON response") from exc
    if not isinstance(parsed, dict):
        raise BridgeError("expected JSON object")
    return parsed


def parse_ws_url(url: str) -> WsUrl:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "ws":
        raise BridgeError("invalid ws URL: expected ws://")
    if not parsed.hostname:
        raise BridgeError("invalid ws URL: missing host")
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return WsUrl(host=parsed.hostname, port=parsed.port or 80, path=path)


def recv_exact(sock: socket.socket, n: int) -> bytes:
    chunks: list[bytes] = []
    remaining = n
    while remaining:
        chunk = sock.recv(remaining)
        if not chunk:
            raise BridgeError("unexpected end of stream")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def recv_until(sock: socket.socket, needle: bytes, limit: int) -> bytes:
    data = bytearray()
    while needle not in data:
        if len(data) >= limit:
            raise BridgeError("header too large")
        chunk = sock.recv(4096)
        if not chunk:
            raise BridgeError("unexpected end of stream")
        data.extend(chunk)
    return bytes(data)


def websocket_connect(url: str, timeout_ms: int) -> socket.socket:
    ws = parse_ws_url(url)
    timeout = max(timeout_ms, 1) / 1000.0
    sock = socket.create_connection((ws.host, ws.port), timeout=timeout)
    sock.settimeout(timeout)
    key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
    request = (
        f"GET {ws.path} HTTP/1.1\r\n"
        f"Host: {ws.host}:{ws.port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    ).encode("ascii")
    sock.sendall(request)
    headers = recv_until(sock, b"\r\n\r\n", 64 * 1024)
    head = headers.split(b"\r\n\r\n", 1)[0]
    lines = head.split(b"\r\n")
    if not lines or b" 101 " not in lines[0]:
        sock.close()
        raise BridgeError("websocket handshake failed")
    hdrs: dict[str, str] = {}
    for line in lines[1:]:
        if b":" not in line:
            continue
        k, v = line.split(b":", 1)
        hdrs[k.decode("ascii", errors="ignore").lower()] = v.decode("ascii", errors="ignore").strip()
    expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
    if hdrs.get("sec-websocket-accept") != expected:
        sock.close()
        raise BridgeError("websocket accept mismatch")
    return sock


def ws_send_frame(sock: socket.socket, opcode: int, payload: bytes) -> None:
    # Client-to-server WebSocket frames must be masked.
    mask = secrets.token_bytes(4)
    header = bytearray([0x80 | (opcode & 0x0F)])
    length = len(payload)
    if length <= 125:
        header.append(0x80 | length)
    elif length <= 0xFFFF:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    header.extend(mask)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(bytes(header) + masked)


def ws_send_text(sock: socket.socket, text: str) -> None:
    ws_send_frame(sock, 0x1, text.encode("utf-8"))


def ws_read_frame(sock: socket.socket) -> tuple[bool, int, bytes]:
    b0, b1 = recv_exact(sock, 2)
    fin = (b0 & 0x80) != 0
    opcode = b0 & 0x0F
    masked = (b1 & 0x80) != 0
    length = b1 & 0x7F
    if length == 126:
        length = struct.unpack("!H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(sock, 8))[0]
    if length > 64 * 1024 * 1024:
        raise BridgeError("frame too large")
    mask = recv_exact(sock, 4) if masked else b""
    payload = recv_exact(sock, int(length)) if length else b""
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return fin, opcode, payload


def ws_read_text(sock: socket.socket) -> str:
    chunks: list[bytes] = []
    in_text = False
    while True:
        fin, opcode, payload = ws_read_frame(sock)
        if opcode == 0x9:  # ping
            ws_send_frame(sock, 0xA, payload)
            continue
        if opcode == 0xA:  # pong
            continue
        if opcode == 0x8:  # close
            raise BridgeError("connection closed")
        if opcode == 0x1:  # text start
            chunks = [payload]
            in_text = True
            if fin:
                return b"".join(chunks).decode("utf-8", errors="replace")
            continue
        if opcode == 0x0 and in_text:  # continuation
            chunks.append(payload)
            if fin:
                return b"".join(chunks).decode("utf-8", errors="replace")
            continue


def ws_call(ws_url: str, request_json: str, timeout_ms: int) -> str:
    try:
        parsed_req = json.loads(request_json)
    except json.JSONDecodeError as exc:
        raise BridgeError("invalid request JSON") from exc
    if not isinstance(parsed_req, dict) or "id" not in parsed_req:
        raise BridgeError("request JSON must be an object with id")
    req_id = parsed_req["id"]
    sock = websocket_connect(ws_url, timeout_ms)
    deadline = time.monotonic() + (max(timeout_ms, 1) / 1000.0)
    try:
        ws_send_text(sock, request_json)
        while True:
            remaining = deadline - time.monotonic()
            if timeout_ms > 0 and remaining <= 0:
                raise BridgeError("timeout waiting for response")
            sock.settimeout(max(remaining, 0.001) if timeout_ms > 0 else None)
            msg = ws_read_text(sock)
            try:
                parsed = json.loads(msg)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and parsed.get("id") == req_id:
                return msg
    finally:
        try:
            sock.close()
        except OSError:
            pass


def ws_send_and_wait_id(sock: socket.socket, req: Mapping[str, Any], req_id: int, timeout_ms: int) -> str:
    ws_send_text(sock, json.dumps(req, separators=(",", ":"), ensure_ascii=False))
    deadline = time.monotonic() + (max(timeout_ms, 1) / 1000.0)
    while True:
        remaining = deadline - time.monotonic()
        if timeout_ms > 0 and remaining <= 0:
            raise BridgeError("timeout waiting for response")
        sock.settimeout(max(remaining, 0.001) if timeout_ms > 0 else None)
        msg = ws_read_text(sock)
        try:
            parsed = json.loads(msg)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and parsed.get("id") == req_id:
            return msg


def ws_wait_for_method(sock: socket.socket, method: str, timeout_ms: int) -> str:
    deadline = time.monotonic() + (max(timeout_ms, 1) / 1000.0)
    while True:
        remaining = deadline - time.monotonic()
        if timeout_ms > 0 and remaining <= 0:
            raise BridgeError(f"timeout waiting for {method}")
        sock.settimeout(max(remaining, 0.001) if timeout_ms > 0 else None)
        msg = ws_read_text(sock)
        try:
            parsed = json.loads(msg)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and parsed.get("method") == method:
            return msg


def build_center_expr(selector: str) -> str:
    sel = json.dumps(selector)
    return (
        f"(() => {{ const sel = {sel}; const el = document.querySelector(sel); "
        "if (!el) return { ok: false, reason: 'not_found', selector: sel }; "
        "try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {} "
        "const r = el.getBoundingClientRect(); "
        "return { ok: true, selector: sel, x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()"
    )


def build_click_expr(selector: str) -> str:
    sel = json.dumps(selector)
    return (
        f"(() => {{ const sel = {sel}; const el = document.querySelector(sel); "
        "if (!el) return { ok: false, reason: 'not_found', selector: sel }; "
        "el.click(); return { ok: true, selector: sel, id: String(el.id || ''), "
        "tag: String(el.tagName || ''), type: String(el.type || '') }; })()"
    )


def build_verify_expr(file_paths: list[str]) -> str:
    names = json.dumps([os.path.basename(path) for path in file_paths])
    return (
        f"(() => {{ const names = {names}; "
        "const inputs = Array.from(document.querySelectorAll('input[type=file]')); "
        "const picked = inputs.map((i) => { try { return { accept: String(i.accept||''), "
        "n: (i.files?i.files.length:0), names: i.files?Array.from(i.files).map((f)=>f.name):[] }; } "
        "catch (e) { return { accept: String(i.accept||''), n: 0, names: [] }; } }); "
        "const visible = names.map((name) => ({ name, ok: picked.some((x) => (x.names || []).includes(name)) || String(document.body && document.body.innerText || '').includes(name) })); "
        "const aria = Array.from(document.querySelectorAll('[aria-label]')).map((e)=>String(e.getAttribute('aria-label')||'')); "
        "const hasTile = names.some((name) => aria.includes(name)); "
        "return { href: location.href, title: document.title, visible, ok: visible.every((row) => row.ok), inputs: picked, has_aria_label_tile: hasTile }; })()"
    )


def build_dispatch_file_change_expr(selector: str) -> str:
    sel = json.dumps(selector)
    return (
        f"(() => {{ const sel = {sel}; const el = document.querySelector(sel); "
        "if (!el) return { ok: false, reason: 'not_found', selector: sel }; "
        "const before = { n: el.files ? el.files.length : 0, names: el.files ? Array.from(el.files).map((f) => f.name) : [] }; "
        "try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {} "
        "try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {} "
        "return { ok: true, selector: sel, id: String(el.id || ''), tag: String(el.tagName || ''), type: String(el.type || ''), before }; })()"
    )


def build_add_sources_button_expr() -> str:
    return (
        "(() => { "
        "const candidates = Array.from(document.querySelectorAll('button,[role=\"button\"]')); "
        "const el = candidates.find((x) => String(x.innerText || x.textContent || '').trim() === 'Add sources'); "
        "if (!el) return { ok: false, reason: 'not_found' }; "
        "try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {} "
        "const r = el.getBoundingClientRect(); "
        "return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, text: String(el.innerText || el.textContent || '') }; "
        "})()"
    )


def require_int(value: Any, field: str) -> int:
    if not isinstance(value, int):
        raise BridgeError(f"expected integer {field}")
    return value


def dispatch_mouse_click(sock: socket.socket, next_id: int, x: float, y: float, timeout_ms: int) -> int:
    events = [
        {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0},
        {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1},
        {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1},
    ]
    for params in events:
        ws_send_and_wait_id(sock, {"id": next_id, "method": "Input.dispatchMouseEvent", "params": params}, next_id, timeout_ms)
        next_id += 1
    return next_id


def ws_direct_set_file_input(sock: socket.socket, next_id: int, selector: str, file_paths: list[str], timeout_ms: int) -> tuple[int, dict[str, Any]]:
    doc = ws_send_and_wait_id(
        sock,
        {"id": next_id, "method": "DOM.getDocument", "params": {"depth": 1, "pierce": True}},
        next_id,
        timeout_ms,
    )
    next_id += 1
    doc_obj = json.loads(doc)
    root_id = doc_obj.get("result", {}).get("root", {}).get("nodeId")
    if not isinstance(root_id, int):
        raise BridgeError("DOM.getDocument did not return root nodeId")

    query = ws_send_and_wait_id(
        sock,
        {"id": next_id, "method": "DOM.querySelector", "params": {"nodeId": root_id, "selector": selector}},
        next_id,
        timeout_ms,
    )
    next_id += 1
    query_obj = json.loads(query)
    node_id = query_obj.get("result", {}).get("nodeId")
    if not isinstance(node_id, int) or node_id <= 0:
        trigger = ws_send_and_wait_id(
            sock,
            {
                "id": next_id,
                "method": "Runtime.evaluate",
                "params": {"expression": build_add_sources_button_expr(), "returnByValue": True, "awaitPromise": False, "userGesture": False},
            },
            next_id,
            timeout_ms,
        )
        next_id += 1
        trigger_obj = json.loads(trigger)
        trigger_value = trigger_obj.get("result", {}).get("result", {}).get("value", {})
        if not trigger_value.get("ok"):
            raise BridgeError(f"file input not found and Add sources button not found: {selector}")
        next_id = dispatch_mouse_click(sock, next_id, float(trigger_value.get("x") or 0), float(trigger_value.get("y") or 0), timeout_ms)
        file_chooser_opened = ws_wait_for_method(sock, "Page.fileChooserOpened", timeout_ms)
        evt = json.loads(file_chooser_opened)
        backend_node_id = require_int(evt.get("params", {}).get("backendNodeId"), "backendNodeId")
        set_files = ws_send_and_wait_id(
            sock,
            {
                "id": next_id,
                "method": "DOM.setFileInputFiles",
                "params": {"backendNodeId": backend_node_id, "files": file_paths},
            },
            next_id,
            timeout_ms,
        )
        next_id += 1
        return next_id, {
            "mode": "add_sources_button_filechooser",
            "backendNodeId": backend_node_id,
            "document": doc_obj,
            "querySelector": query_obj,
            "addSourcesButton": trigger_obj,
            "fileChooserOpened": evt,
            "setFileInputFiles": json.loads(set_files),
        }

    try:
        scroll = ws_send_and_wait_id(
            sock,
            {"id": next_id, "method": "DOM.scrollIntoViewIfNeeded", "params": {"nodeId": node_id}},
            next_id,
            timeout_ms,
        )
        scroll_obj: Any = json.loads(scroll)
    except Exception as exc:
        scroll_obj = {"ok": False, "ignored_error": str(exc)}
    next_id += 1

    set_files = ws_send_and_wait_id(
        sock,
        {
            "id": next_id,
            "method": "DOM.setFileInputFiles",
            "params": {"nodeId": node_id, "files": file_paths},
        },
        next_id,
        timeout_ms,
    )
    next_id += 1

    dispatch = ws_send_and_wait_id(
        sock,
        {
            "id": next_id,
            "method": "Runtime.evaluate",
            "params": {"expression": build_dispatch_file_change_expr(selector), "returnByValue": True, "awaitPromise": False, "userGesture": True},
        },
        next_id,
        timeout_ms,
    )
    next_id += 1

    return next_id, {
        "mode": "direct_file_input",
        "nodeId": node_id,
        "document": doc_obj,
        "querySelector": query_obj,
        "scrollIntoViewIfNeeded": scroll_obj,
        "setFileInputFiles": json.loads(set_files),
        "dispatchInputChange": json.loads(dispatch),
    }


def ws_filechooser(ws_url: str, selector: str, file_paths: list[str], timeout_ms: int, click_mode: str = "mouse") -> str:
    sock = websocket_connect(ws_url, timeout_ms)
    next_id = 1
    try:
        runtime_enable = ws_send_and_wait_id(sock, {"id": next_id, "method": "Runtime.enable", "params": {}}, next_id, timeout_ms)
        next_id += 1
        dom_enable = ws_send_and_wait_id(sock, {"id": next_id, "method": "DOM.enable", "params": {}}, next_id, timeout_ms)
        next_id += 1
        page_enable = ws_send_and_wait_id(sock, {"id": next_id, "method": "Page.enable", "params": {}}, next_id, timeout_ms)
        next_id += 1
        bring_to_front = ws_send_and_wait_id(sock, {"id": next_id, "method": "Page.bringToFront", "params": {}}, next_id, timeout_ms)
        next_id += 1
        intercept_on = ws_send_and_wait_id(
            sock,
            {"id": next_id, "method": "Page.setInterceptFileChooserDialog", "params": {"enabled": True}},
            next_id,
            timeout_ms,
        )
        next_id += 1
        center = ws_send_and_wait_id(
            sock,
            {
                "id": next_id,
                "method": "Runtime.evaluate",
                "params": {"expression": build_center_expr(selector), "returnByValue": True, "awaitPromise": False, "userGesture": False},
            },
            next_id,
            timeout_ms,
        )
        center_obj = json.loads(center).get("result", {}).get("result", {}).get("value", {})
        next_id += 1
        if click_mode == "direct":
            next_id, direct = ws_direct_set_file_input(sock, next_id, selector, file_paths, timeout_ms)
            click_record = json.dumps({"mode": click_mode, "direct": direct}, separators=(",", ":"), ensure_ascii=False)
            file_chooser_opened = None
            set_files = json.dumps(direct["setFileInputFiles"], separators=(",", ":"), ensure_ascii=False)
        elif click_mode == "programmatic":
            click_req = {
                "id": next_id,
                "method": "Runtime.evaluate",
                "params": {"expression": build_click_expr(selector), "returnByValue": True, "awaitPromise": False, "userGesture": True},
            }
            ws_send_text(sock, json.dumps(click_req, separators=(",", ":"), ensure_ascii=False))
            click_record = json.dumps({"id": next_id, "mode": click_mode, "sent": True}, separators=(",", ":"))
            next_id += 1
        elif click_mode == "mouse":
            if not center_obj.get("ok"):
                raise BridgeError(f"selector not clickable: {center_obj}")
            next_id = dispatch_mouse_click(sock, next_id, float(center_obj.get("x") or 0), float(center_obj.get("y") or 0), timeout_ms)
            click_record = json.dumps({"mode": click_mode, "x": center_obj.get("x"), "y": center_obj.get("y")}, separators=(",", ":"))
            file_chooser_opened = ws_wait_for_method(sock, "Page.fileChooserOpened", timeout_ms)
        else:
            raise BridgeError(f"invalid click mode: {click_mode}")
        if click_mode == "programmatic":
            file_chooser_opened = ws_wait_for_method(sock, "Page.fileChooserOpened", timeout_ms)
        backend_node_id = None
        if file_chooser_opened is None:
            evt = None
        else:
            evt = json.loads(file_chooser_opened)
            backend_node_id = require_int(evt.get("params", {}).get("backendNodeId"), "backendNodeId")
            set_files = ws_send_and_wait_id(
                sock,
                {
                    "id": next_id,
                    "method": "DOM.setFileInputFiles",
                    "params": {"backendNodeId": backend_node_id, "files": file_paths},
                },
                next_id,
                timeout_ms,
            )
            next_id += 1
        intercept_off = ws_send_and_wait_id(
            sock,
            {"id": next_id, "method": "Page.setInterceptFileChooserDialog", "params": {"enabled": False}},
            next_id,
            timeout_ms,
        )
        next_id += 1
        verify = ws_send_and_wait_id(
            sock,
            {
                "id": next_id,
                "method": "Runtime.evaluate",
                "params": {"expression": build_verify_expr(file_paths), "returnByValue": True, "awaitPromise": False, "userGesture": False},
            },
            next_id,
            timeout_ms,
        )
        result = {
            "ok": True,
            "backendNodeId": backend_node_id,
            "runtime_enable": json.loads(runtime_enable),
            "dom_enable": json.loads(dom_enable),
            "page_enable": json.loads(page_enable),
            "bring_to_front": json.loads(bring_to_front),
            "intercept_on": json.loads(intercept_on),
            "center": json.loads(center),
            "click": json.loads(click_record),
            "fileChooserOpened": evt,
            "setFileInputFiles": json.loads(set_files),
            "intercept_off": json.loads(intercept_off),
            "verify": json.loads(verify),
        }
        return json.dumps(result, separators=(",", ":"), ensure_ascii=False)
    finally:
        try:
            sock.close()
        except OSError:
            pass


def cmd_version(argv: list[str]) -> int:
    opts = parse_addr_port(argv, 2)
    body = http_request(opts.addr, opts.port, "GET", "/json/version")
    write_json_or_string(body)
    return 0


def cmd_wsurl(argv: list[str]) -> int:
    opts = parse_addr_port(argv, 2)
    body = http_request(opts.addr, opts.port, "GET", "/json/version")
    obj = parse_json_object(body)
    value = obj.get("webSocketDebuggerUrl")
    if not isinstance(value, str):
        raise BridgeError("missing webSocketDebuggerUrl")
    sys.stdout.write(value + "\n")
    return 0


def cmd_list(argv: list[str]) -> int:
    opts = parse_addr_port(argv, 2)
    body = http_request(opts.addr, opts.port, "GET", "/json/list")
    write_json_or_string(body)
    return 0


def cmd_new(argv: list[str]) -> int:
    opts = parse_addr_port(argv, 2)
    url = parse_flag_value(argv, 2, "--url") or "about:blank"
    # Chrome's /json/new endpoint expects the target URL after the question mark.
    safe = urllib.parse.quote(url, safe=":/#?&=%+~,;@!$'()*[]")
    body = http_request(opts.addr, opts.port, "PUT", f"/json/new?{safe}")
    write_json_or_string(body)
    return 0


def cmd_close(argv: list[str]) -> int:
    opts = parse_addr_port(argv, 2)
    target_id = parse_flag_value(argv, 2, "--id")
    if target_id is None:
        raise BridgeError("missing: --id")
    body = http_request(opts.addr, opts.port, "PUT", f"/json/close/{urllib.parse.quote(target_id, safe='')}")
    write_json_or_string(body)
    return 0


def cmd_call(argv: list[str]) -> int:
    ws_url = parse_flag_value(argv, 2, "--ws")
    req = parse_flag_value(argv, 2, "--req")
    if ws_url is None:
        raise BridgeError("missing: --ws")
    if req is None:
        raise BridgeError("missing: --req")
    timeout_ms = parse_timeout_ms(parse_flag_value(argv, 2, "--timeout-ms"))
    sys.stdout.write(ws_call(ws_url, req, timeout_ms) + "\n")
    return 0


def cmd_filechooser(argv: list[str]) -> int:
    ws_url = parse_flag_value(argv, 2, "--ws")
    selector = parse_flag_value(argv, 2, "--selector")
    file_paths = parse_flag_values(argv, 2, "--file")
    click_mode = parse_flag_value(argv, 2, "--click-mode") or "mouse"
    if ws_url is None:
        raise BridgeError("missing: --ws")
    if selector is None:
        raise BridgeError("missing: --selector")
    if not file_paths:
        raise BridgeError("missing: --file")
    timeout_ms = parse_timeout_ms(parse_flag_value(argv, 2, "--timeout-ms"))
    sys.stdout.write(ws_filechooser(ws_url, selector, [os.path.abspath(path) for path in file_paths], timeout_ms, click_mode) + "\n")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    if len(argv) < 2 or argv[1] in {"-h", "--help", "help"}:
        sys.stderr.write(usage())
        return 0 if len(argv) >= 2 else 2
    commands = {
        "version": cmd_version,
        "wsurl": cmd_wsurl,
        "list": cmd_list,
        "new": cmd_new,
        "close": cmd_close,
        "call": cmd_call,
        "filechooser": cmd_filechooser,
    }
    handler = commands.get(argv[1])
    if handler is None:
        return die(f"unknown command: {argv[1]}")
    try:
        return handler(argv)
    except (BridgeError, OSError, TimeoutError, socket.timeout) as exc:
        sys.stderr.write(f"cdp-bridge:error:{exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
