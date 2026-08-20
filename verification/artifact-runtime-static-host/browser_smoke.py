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
    request = urllib.request.Request(url, method=method, headers={"User-Agent": "artifact-runtime-browser-proof/3"})
    with urllib.request.urlopen(request, timeout=10) as response:
        value = json.loads(response.read())
    invariant(isinstance(value, dict), "CDP endpoint returned invalid JSON")
    return value


def open_page(port: int, url: str) -> tuple[WebSocket, Cdp]:
    page = fetch_json(f"http://127.0.0.1:{port}/json/new?{urllib.parse.quote(url, safe='')}", method="PUT")
    web_socket_url = page.get("webSocketDebuggerUrl")
    invariant(isinstance(web_socket_url, str), "page WebSocket URL is missing")
    socket_ = WebSocket(web_socket_url)
    cdp = Cdp(socket_)
    cdp.call("Runtime.enable")
    cdp.call("Page.enable")
    return socket_, cdp


def evaluate(cdp: Cdp, expression: str) -> object:
    evaluated = cdp.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
    remote = evaluated.get("result", {})
    invariant(isinstance(remote, dict), "Runtime.evaluate result is invalid")
    invariant("exceptionDetails" not in evaluated, f"Runtime.evaluate raised: {evaluated.get('exceptionDetails')}")
    return remote.get("value")


OBSERVATION = """(() => {
  const proof = globalThis.artifactShellProof;
  const action = globalThis.artifactShellActionProof;
  const request = proof?.request || null;
  const input = request?.inputs?.find(item => item?.schema === 'a2ui-app/1');
  const result = proof?.outcome?.result || null;
  const receipt = proof?.outcome?.receipt || null;
  return {
    readyState: document.readyState,
    href: location.href,
    shellStatus: result?.status || null,
    domState: document.getElementById('status')?.dataset?.state || null,
    count: input?.source?.value?.state?.count ?? null,
    actionStatus: action?.status || null,
    actionHref: action?.href || null,
    request,
    outputContracts: (result?.outputs || []).map(item => item.contract),
    capability: receipt?.capability ? `${receipt.capability.id}@${receipt.capability.version}` : null,
    progress: document.getElementById('progress')?.textContent || '',
  };
})()"""


def wait_for(cdp: Cdp, predicate, label: str, timeout: float = 75) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    latest: dict[str, object] | None = None
    while time.monotonic() < deadline:
        value = evaluate(cdp, OBSERVATION)
        if isinstance(value, dict):
            latest = value
            state = latest.get("domState")
            if state in {"fail", "inconclusive"}:
                raise RuntimeError(f"artifact-runtime-readback: browser stopped with {state}: {latest}")
            if predicate(latest):
                return latest
        time.sleep(0.25)
    raise RuntimeError(f"artifact-runtime-readback: timed out waiting for {label}: {latest}")


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def main(argv: list[str]) -> int:
    invariant(len(argv) == 8, "expected local_root root_url tree_digest source_sha project proof_path dom_path")
    local_root = Path(argv[1]).resolve()
    root = validate_root(argv[2], argv[5])
    tree_digest = argv[3]
    source_sha = argv[4]
    project = argv[5]
    proof_path = Path(argv[6])
    dom_path = Path(argv[7])

    fixtures = sorted(local_root.glob("capabilities/render-a2ui-app/*/fixtures/pass.json"))
    invariant(len(fixtures) == 1, "render-a2ui-app pass fixture is not unique")
    request = json.loads(fixtures[0].read_text(encoding="utf-8"))["request"]
    canonical = canonical_bytes(request)
    token = base64.urlsafe_b64encode(gzip.compress(canonical, mtime=0)).decode().rstrip("=")
    initial_url = f"{root}/index.html#invoke={token}"

    browser = next((value for name in ("google-chrome", "chromium", "chromium-browser") if (value := shutil.which(name))), None)
    invariant(browser is not None, "Chromium browser is unavailable")
    port = reserve_port()
    sockets: list[WebSocket] = []
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

            first_socket, first = open_page(port, initial_url)
            sockets.append(first_socket)
            initial = wait_for(
                first,
                lambda value: value.get("shellStatus") == "PASS" and value.get("count") == 0,
                "initial app state",
            )
            invariant(initial.get("href") == initial_url, "initial browser URL changed unexpectedly")
            invariant(initial.get("capability") == "render.a2ui.app@1", "initial capability is not render.a2ui.app@1")
            invariant("a2ui-app-render-receipt/1" in initial.get("outputContracts", []), "initial output contract is missing")
            invariant("INCONCLUSIVE" not in str(initial.get("progress", "")), "initial browser produced INCONCLUSIVE")

            clicked = evaluate(first, "(() => { const button=document.querySelector('[data-a2ui-id=\"increment\"]'); if (!button) return false; button.click(); return true; })()")
            invariant(clicked is True, "increment button is missing")
            next_state = wait_for(
                first,
                lambda value: value.get("shellStatus") == "PASS" and value.get("actionStatus") == "PASS" and value.get("count") == 1 and value.get("href") != initial_url,
                "clicked next app state",
            )
            next_url = next_state.get("href")
            invariant(isinstance(next_url, str), "next URL is missing")
            invariant(next_state.get("actionHref") == next_url, "action proof URL differs from browser URL")
            invariant(next_state.get("capability") == "render.a2ui.app@1", "next capability is not render.a2ui.app@1")
            invariant("a2ui-app-render-receipt/1" in next_state.get("outputContracts", []), "next output contract is missing")
            next_request = next_state.get("request")
            invariant(isinstance(next_request, dict), "next request is missing")

            invariant(evaluate(first, "(() => { history.back(); return true; })()") is True, "history.back failed")
            back = wait_for(
                first,
                lambda value: value.get("shellStatus") == "PASS" and value.get("count") == 0 and value.get("href") == initial_url,
                "Back-restored initial app state",
            )
            invariant(back.get("request") == request, "Back did not restore the exact initial request")

            fresh_socket, fresh = open_page(port, next_url)
            sockets.append(fresh_socket)
            fresh_state = wait_for(
                fresh,
                lambda value: value.get("shellStatus") == "PASS" and value.get("count") == 1 and value.get("href") == next_url,
                "fresh-open next app state",
            )
            invariant(fresh_state.get("request") == next_request, "fresh-open did not restore the exact next request")
            fresh.call("Page.reload", {"ignoreCache": True})
            reloaded = wait_for(
                fresh,
                lambda value: value.get("shellStatus") == "PASS" and value.get("count") == 1 and value.get("href") == next_url,
                "reloaded next app state",
            )
            invariant(reloaded.get("request") == next_request, "reload did not preserve the exact next request")

            dom = evaluate(fresh, "document.documentElement.outerHTML")
            invariant(isinstance(dom, str), "browser DOM is unavailable")
            dom_path.write_text(dom, encoding="utf-8")
        finally:
            for socket_ in sockets:
                socket_.close()
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    initial_request_digest = f"sha256:{hashlib.sha256(canonical).hexdigest()}"
    next_canonical = canonical_bytes(next_request)
    proof = {
        "schema": "ops.artifactRuntimePublicBrowserProof/2",
        "status": "PASS",
        "authority": False,
        "opsCommit": source_sha,
        "project": project,
        "treeDigest": tree_digest,
        "rootUrl": root,
        "browser": subprocess.check_output([browser, "--version"], text=True).strip(),
        "capability": "render.a2ui.app@1",
        "outputContract": "a2ui-app-render-receipt/1",
        "initial": {
            "count": 0,
            "url": initial_url,
            "urlSha256": f"sha256:{hashlib.sha256(initial_url.encode()).hexdigest()}",
            "requestSha256": initial_request_digest,
        },
        "next": {
            "count": 1,
            "url": next_url,
            "urlSha256": f"sha256:{hashlib.sha256(next_url.encode()).hexdigest()}",
            "requestSha256": f"sha256:{hashlib.sha256(next_canonical).hexdigest()}",
        },
        "roundTrip": {
            "clickUpdatesUrl": True,
            "backRestoresInitialState": True,
            "freshOpenRestoresNextState": True,
            "reloadPreservesNextState": True,
        },
        "domSha256": f"sha256:{hashlib.sha256(dom.encode()).hexdigest()}",
    }
    proof_path.write_text(json.dumps(proof, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
