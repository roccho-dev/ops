#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def invariant(condition: object, message: str) -> None:
    if not condition:
        raise RuntimeError(f"artifact-app-browser: {message}")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


class WebSocket:
    def __init__(self, url: str) -> None:
        parsed = urllib.parse.urlsplit(url)
        invariant(parsed.scheme == "ws" and parsed.hostname is not None and parsed.port is not None, "CDP WebSocket URL is invalid")
        self.socket = socket.create_connection((parsed.hostname, parsed.port), timeout=15)
        self.socket.settimeout(30)
        key = base64.b64encode(os.urandom(16)).decode()
        target = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        request = (
            f"GET {target} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}:{parsed.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "Origin: http://127.0.0.1\r\n\r\n"
        ).encode()
        self.socket.sendall(request)
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = self.socket.recv(4096)
            invariant(chunk, "CDP WebSocket handshake closed")
            response.extend(chunk)
        header, _, remainder = bytes(response).partition(b"\r\n\r\n")
        invariant(header.startswith(b"HTTP/1.1 101"), f"CDP WebSocket handshake failed: {header[:200]!r}")
        self.buffer = bytearray(remainder)

    def close(self) -> None:
        try:
            self._send_frame(b"", opcode=8)
        except Exception:
            pass
        self.socket.close()

    def _read_exact(self, size: int) -> bytes:
        while len(self.buffer) < size:
            chunk = self.socket.recv(max(4096, size - len(self.buffer)))
            invariant(chunk, "CDP WebSocket closed")
            self.buffer.extend(chunk)
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def _send_frame(self, payload: bytes, opcode: int = 1) -> None:
        mask = os.urandom(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.socket.sendall(bytes(header) + mask + masked)

    def send_json(self, value: object) -> None:
        self._send_frame(json.dumps(value, separators=(",", ":")).encode())

    def receive_json(self) -> object:
        fragments = bytearray()
        active_opcode: int | None = None
        while True:
            first, second = self._read_exact(2)
            finished = bool(first & 0x80)
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else b""
            payload = self._read_exact(length)
            if masked:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 8:
                raise RuntimeError("artifact-app-browser: CDP WebSocket closed")
            if opcode == 9:
                self._send_frame(payload, opcode=10)
                continue
            if opcode in (1, 2):
                active_opcode = opcode
                fragments = bytearray(payload)
            elif opcode == 0 and active_opcode is not None:
                fragments.extend(payload)
            else:
                continue
            if finished:
                invariant(active_opcode == 1, "CDP returned non-text data")
                return json.loads(fragments.decode())


class Cdp:
    def __init__(self, socket_: WebSocket) -> None:
        self.socket = socket_
        self.sequence = 0
        self.events: list[dict[str, object]] = []

    def call(self, method: str, params: dict[str, object] | None = None) -> dict[str, object]:
        self.sequence += 1
        identity = self.sequence
        self.socket.send_json({"id": identity, "method": method, "params": params or {}})
        while True:
            message = self.socket.receive_json()
            if not isinstance(message, dict):
                continue
            if message.get("id") != identity:
                self.events.append(message)
                continue
            invariant("error" not in message, f"CDP {method} failed: {message.get('error')}")
            result = message.get("result", {})
            invariant(isinstance(result, dict), f"CDP {method} returned invalid data")
            return result


def reserve_port() -> int:
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        return int(candidate.getsockname()[1])


def fetch_json(url: str, *, method: str = "GET") -> dict[str, object]:
    request = urllib.request.Request(url, method=method, headers={"User-Agent": "artifact-app-browser-proof/1"})
    with urllib.request.urlopen(request, timeout=10) as response:
        value = json.loads(response.read())
    invariant(isinstance(value, dict), "CDP endpoint returned invalid JSON")
    return value


def evaluate(cdp: Cdp, expression: str) -> object:
    result = cdp.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
    remote = result.get("result", {})
    invariant(isinstance(remote, dict), "CDP evaluation result is invalid")
    if "exceptionDetails" in result:
        raise RuntimeError(f"artifact-app-browser: JavaScript exception: {result['exceptionDetails']}")
    return remote.get("value")


def wait_value(cdp: Cdp, expression: str, expected: object, timeout: float = 60) -> object:
    deadline = time.monotonic() + timeout
    observed: object = None
    while time.monotonic() < deadline:
        observed = evaluate(cdp, expression)
        if observed == expected:
            return observed
        state = evaluate(cdp, "document.querySelector('#status')?.dataset.state || null")
        if state in ("fail", "inconclusive"):
            raise RuntimeError(f"artifact-app-browser: application stopped with {state}: {evaluate(cdp, 'document.body.innerText')}")
        time.sleep(0.25)
    diagnostics = {
        "observed": observed,
        "url": evaluate(cdp, "location.href"),
        "readyState": evaluate(cdp, "document.readyState"),
        "app": evaluate(cdp, "typeof globalThis.artifactApp"),
        "proof": evaluate(cdp, "globalThis.artifactAppProof ?? null"),
        "body": evaluate(cdp, "document.body?.innerText || null"),
        "events": [event for event in cdp.events if event.get("method") in ("Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded")][-20:],
    }
    raise RuntimeError(f"artifact-app-browser: timeout waiting for {expected!r}; diagnostics={json.dumps(diagnostics, sort_keys=True)}")


def main(argv: list[str]) -> int:
    invariant(len(argv) == 4, "expected app_root proof_path dom_path")
    app_root = Path(argv[1]).resolve()
    proof_path = Path(argv[2]).resolve()
    dom_path = Path(argv[3]).resolve()
    manifest = json.loads((app_root / "artifact-manifest.json").read_text(encoding="utf-8"))
    app = json.loads((app_root / "app.manifest.json").read_text(encoding="utf-8"))
    invariant(manifest.get("schema") == "artifact-app-publication-artifact/1", "app artifact manifest is invalid")
    invariant(app.get("schema") == "artifact-app/1", "app manifest is invalid")

    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(app_root), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    app_url = f"http://127.0.0.1:{server.server_port}/index.html"

    browser = next((value for name in ("google-chrome", "chromium", "chromium-browser") if (value := shutil.which(name))), None)
    invariant(browser is not None, "Chromium browser is unavailable")
    port = reserve_port()
    dom = ""
    socket_: WebSocket | None = None
    with tempfile.TemporaryDirectory(prefix="artifact-app-chrome-", ignore_cleanup_errors=True) as profile:
        process = subprocess.Popen([
            browser,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--remote-allow-origins=*",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 30
            version: dict[str, object] | None = None
            while time.monotonic() < deadline:
                try:
                    version = fetch_json(f"http://127.0.0.1:{port}/json/version")
                    break
                except Exception:
                    time.sleep(0.25)
            invariant(version is not None, "Chrome DevTools endpoint did not start")
            page = fetch_json(f"http://127.0.0.1:{port}/json/new?{urllib.parse.quote('about:blank', safe='')}", method="PUT")
            web_socket_url = page.get("webSocketDebuggerUrl")
            invariant(isinstance(web_socket_url, str), "page WebSocket URL is missing")
            socket_ = WebSocket(web_socket_url)
            cdp = Cdp(socket_)
            cdp.call("Runtime.enable")
            cdp.call("Page.enable")
            cdp.call("Log.enable")
            cdp.call("Page.navigate", {"url": app_url})

            wait_value(cdp, "document.querySelector('#status')?.dataset.state || null", "pass")
            wait_value(cdp, "document.querySelector('[data-a2ui-id=title]')?.textContent || null", "State A")
            url_a = evaluate(cdp, "location.href")
            invariant(isinstance(url_a, str) and "#invoke=" in url_a, "State A URL is missing")
            decoded_a = evaluate(cdp, "globalThis.artifactApp.decode(location.href).then(value => value.id)")
            invariant(decoded_a == "request.interactive-a2ui.state-a", "State A URL did not decode")

            evaluate(cdp, "document.querySelector('[data-a2ui-id=next]').click()")
            wait_value(cdp, "document.querySelector('[data-a2ui-id=title]')?.textContent || null", "State B")
            wait_value(cdp, "document.querySelector('#status')?.dataset.state || null", "pass")
            url_b = evaluate(cdp, "location.href")
            invariant(isinstance(url_b, str) and url_b != url_a and "#invoke=" in url_b, "State B URL was not compiled")
            action_proof = evaluate(cdp, "globalThis.artifactAppProof")
            invariant(isinstance(action_proof, dict) and action_proof.get("nextRequestId") == "request.interactive-a2ui.state-b", "action proof is missing")

            cdp.call("Page.reload", {"ignoreCache": True})
            wait_value(cdp, "document.querySelector('[data-a2ui-id=title]')?.textContent || null", "State B")
            invariant(evaluate(cdp, "location.href") == url_b, "reload changed State B URL")
            invariant(evaluate(cdp, "globalThis.artifactApp.decode(location.href).then(value => value.id)") == "request.interactive-a2ui.state-b", "reloaded State B URL did not decode")

            evaluate(cdp, "history.back()")
            wait_value(cdp, "document.querySelector('[data-a2ui-id=title]')?.textContent || null", "State A")
            invariant(evaluate(cdp, "location.href") == url_a, "Back did not restore State A URL")
            evaluate(cdp, "history.forward()")
            wait_value(cdp, "document.querySelector('[data-a2ui-id=title]')?.textContent || null", "State B")
            invariant(evaluate(cdp, "location.href") == url_b, "Forward did not restore State B URL")

            dom_value = evaluate(cdp, "document.documentElement.outerHTML")
            invariant(isinstance(dom_value, str), "browser DOM is unavailable")
            dom = dom_value
            dom_path.parent.mkdir(parents=True, exist_ok=True)
            dom_path.write_text(dom, encoding="utf-8")
        finally:
            if socket_ is not None:
                socket_.close()
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=5)

    proof = {
        "schema": "artifact-app-browser-proof/1",
        "status": "PASS",
        "authority": False,
        "app": f"{app['id']}@{app['version']}",
        "treeDigest": manifest["treeDigest"],
        "runtimeTreeDigest": manifest["runtimeTreeDigest"],
        "stateA": {"requestId": "request.interactive-a2ui.state-a", "url": url_a},
        "stateB": {"requestId": "request.interactive-a2ui.state-b", "url": url_b},
        "observations": {
            "uiActionToUrl": True,
            "reload": True,
            "back": True,
            "forward": True,
            "freshUrlDecode": True,
        },
        "domSha256": f"sha256:{hashlib.sha256(dom.encode()).hexdigest()}",
        "browser": subprocess.check_output([browser, "--version"], text=True).strip(),
    }
    proof_path.parent.mkdir(parents=True, exist_ok=True)
    proof_path.write_text(json.dumps(proof, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(proof, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
