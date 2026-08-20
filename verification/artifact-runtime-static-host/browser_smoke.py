#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from readback import invariant, validate_root


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
                raise RuntimeError("artifact-runtime-readback: CDP WebSocket closed")
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
                invariant(active_opcode == 1, "CDP returned a non-text message")
                return json.loads(fragments.decode())


class Cdp:
    def __init__(self, socket_: WebSocket) -> None:
        self.socket = socket_
        self.sequence = 0

    def call(self, method: str, params: dict[str, object] | None = None) -> dict[str, object]:
        self.sequence += 1
        identity = self.sequence
        self.socket.send_json({"id": identity, "method": method, "params": params or {}})
        while True:
            message = self.socket.receive_json()
            if not isinstance(message, dict) or message.get("id") != identity:
                continue
            invariant("error" not in message, f"CDP {method} failed: {message.get('error')}")
            result = message.get("result", {})
            invariant(isinstance(result, dict), f"CDP {method} returned an invalid result")
            return result


def reserve_port() -> int:
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        return int(candidate.getsockname()[1])


def fetch_json(url: str, *, method: str = "GET") -> dict[str, object]:
    request = urllib.request.Request(url, method=method, headers={"User-Agent": "artifact-runtime-browser-proof/2"})
    with urllib.request.urlopen(request, timeout=10) as response:
        value = json.loads(response.read())
    invariant(isinstance(value, dict), "CDP endpoint returned invalid JSON")
    return value


def main(argv: list[str]) -> int:
    invariant(len(argv) == 8, "expected local_root root_url tree_digest source_sha project proof_path dom_path")
    local_root = Path(argv[1]).resolve()
    root = validate_root(argv[2], argv[5])
    tree_digest = argv[3]
    source_sha = argv[4]
    project = argv[5]
    proof_path = Path(argv[6])
    dom_path = Path(argv[7])

    fixtures = sorted(local_root.glob("capabilities/inspect-json/*/fixtures/pass.json"))
    invariant(len(fixtures) == 1, "inspect-json pass fixture is not unique")
    request = json.loads(fixtures[0].read_text(encoding="utf-8"))["request"]
    canonical = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    token = base64.urlsafe_b64encode(gzip.compress(canonical, mtime=0)).decode().rstrip("=")
    invoke_url = f"{root}/index.html#invoke={token}"

    browser = next((value for name in ("google-chrome", "chromium", "chromium-browser") if (value := shutil.which(name))), None)
    invariant(browser is not None, "Chromium browser is unavailable")
    port = reserve_port()
    with tempfile.TemporaryDirectory(prefix="artifact-runtime-chrome-", ignore_cleanup_errors=True) as profile:
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
        socket_: WebSocket | None = None
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
            page = fetch_json(f"http://127.0.0.1:{port}/json/new?{urllib.parse.quote(invoke_url, safe='')}", method="PUT")
            web_socket_url = page.get("webSocketDebuggerUrl")
            invariant(isinstance(web_socket_url, str), "page WebSocket URL is missing")
            socket_ = WebSocket(web_socket_url)
            cdp = Cdp(socket_)
            cdp.call("Runtime.enable")
            cdp.call("Page.enable")

            expression = """(() => {
              const status = document.getElementById('status');
              const value = id => document.getElementById(id)?.textContent || '';
              return {readyState: document.readyState, state: status?.dataset?.state || null, status: status?.textContent || '', progress: value('progress'), result: value('result'), receipt: value('receipt')};
            })()"""
            observation: dict[str, object] | None = None
            deadline = time.monotonic() + 75
            while time.monotonic() < deadline:
                evaluated = cdp.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
                remote = evaluated.get("result", {})
                if isinstance(remote, dict) and isinstance(remote.get("value"), dict):
                    observation = remote["value"]
                    state = observation.get("state")
                    if state == "pass":
                        break
                    if state in {"fail", "inconclusive"}:
                        raise RuntimeError(f"artifact-runtime-readback: browser stopped with {state}: {observation}")
                time.sleep(0.5)
            invariant(observation is not None and observation.get("state") == "pass", f"browser did not reach PASS: {observation}")

            result = json.loads(str(observation.get("result", "")))
            receipt = json.loads(str(observation.get("receipt", "")))
            invariant(result.get("status") == "PASS", "result status is not PASS")
            invariant(receipt.get("result", {}).get("status") == "PASS", "receipt result status is not PASS")
            invariant(any(item.get("contract") == "json-inspection/1" for item in result.get("outputs", [])), "output contract is missing")
            capability = receipt.get("capability") or {}
            invariant(capability.get("id") == "inspect.json" and capability.get("version") == "1", "selected capability is missing")
            invariant("INCONCLUSIVE" not in str(observation.get("progress", "")), "browser produced INCONCLUSIVE")

            evaluated = cdp.call("Runtime.evaluate", {"expression": "document.documentElement.outerHTML", "returnByValue": True})
            remote = evaluated.get("result", {})
            dom = remote.get("value") if isinstance(remote, dict) else None
            invariant(isinstance(dom, str), "browser DOM is unavailable")
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

    proof = {
        "schema": "ops.artifactRuntimePublicBrowserProof/1",
        "status": "PASS",
        "authority": False,
        "opsCommit": source_sha,
        "project": project,
        "treeDigest": tree_digest,
        "rootUrl": root,
        "invokeUrl": invoke_url,
        "requestDigest": f"sha256:{hashlib.sha256(canonical).hexdigest()}",
        "resultDigest": receipt["result"]["digest"],
        "domSha256": f"sha256:{hashlib.sha256(dom.encode()).hexdigest()}",
        "browser": subprocess.check_output([browser, "--version"], text=True).strip(),
        "capability": "inspect.json@1",
        "outputContract": "json-inspection/1",
    }
    proof_path.write_text(json.dumps(proof, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
