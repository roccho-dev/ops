"""Real Chrome + real C library/CLI + a PTY protocol sink. No user credentials.
The audit WebSocket proxy and browser lifecycle exist ONLY in this test process.
A Kitty-protocol sink is not a real terminal-renderer or Windows/SSH proof.
"""
from __future__ import annotations
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import socketserver
import struct
import subprocess
import tempfile
import termios
import threading
import time
import urllib.request
import zlib
import websocket

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {"Page.getLayoutMetrics", "Page.getFrameTree", "Page.captureScreenshot",
           "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText"}
RECEIPTS: list[dict] = []
PAGE = b'''<!doctype html><meta charset=utf-8><title>fixture</title>
<style>body{margin:0;height:2500px;background:#eee;font:18px sans-serif}
input{position:absolute;left:20px;top:20px;width:400px;height:50px;caret-color:transparent}
button{position:absolute;left:200px;top:120px;width:220px;height:90px}
#stamp{position:absolute;left:20px;top:250px}</style>
<input id=text><input id=other style="top:350px"><button id=button>fixture button</button><div id=stamp>stable</div>
<script>window.events=[];window.clicks=0;
for(const type of ['mousedown','mouseup','click','keydown','keyup','wheel','input'])
addEventListener(type,e=>events.push({type,key:e.key,button:e.button,x:e.clientX,y:e.clientY,dy:e.deltaY}));
button.onclick=()=>clicks++;</script>'''

def record(name: str, **observed):
    row = {"test": name, "status": "PASS", **observed}
    RECEIPTS.append(row)
    print(json.dumps(row, ensure_ascii=False), flush=True)

def eventually(fn, timeout=8):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            value = fn()
            if value:
                return value
        except (OSError, ValueError, websocket.WebSocketException):
            pass
        time.sleep(.02)
    raise AssertionError("bounded wait expired")

class Controller:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=4, suppress_origin=True)
        self.id = 0
    def call(self, method, params=None):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params or {}}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.id:
                assert "error" not in r, r
                return r["result"]
    def evaluate(self, expression):
        r = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        assert "exceptionDetails" not in r, r
        return r["result"].get("value")
    def close(self):
        self.ws.close()

@contextlib.contextmanager
def browser(scale=1):
    binary = os.environ.get("CHROME_BIN") or shutil.which("chromium") or shutil.which("google-chrome")
    assert binary, "real Chrome is REQUIRED; missing browser is not a skip"
    with tempfile.TemporaryDirectory(prefix="cdp-tty-proof-") as d:
        with open(Path(d) / "chrome.log", "wb") as log:
            process = subprocess.Popen([binary, "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
                "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
                f"--user-data-dir={d}/profile", "--window-size=800,600",
                f"--force-device-scale-factor={scale}", "about:blank"],
                stdout=log, stderr=log, start_new_session=True)
            try:
                active = Path(d) / "profile/DevToolsActivePort"
                eventually(lambda: active.exists() and len(active.read_text().splitlines()) >= 2)
                debug = int(active.read_text().splitlines()[0])
                def target():
                    rows = json.load(urllib.request.urlopen(f"http://127.0.0.1:{debug}/json/list", timeout=2))
                    return next((r for r in rows if r["type"] == "page" and r["url"] == "about:blank"), None)
                page = eventually(target)
                ctl = Controller(page["webSocketDebuggerUrl"])
                frame_id = ctl.call("Page.getFrameTree")["frameTree"]["frame"]["id"]
                ctl.call("Page.setDocumentContent", {"frameId": frame_id, "html": PAGE.decode()})
                ctl.call("Network.setCookie", {"name": "fixture-session", "value": "synthetic-only", "domain": "fixture.invalid", "httpOnly": True})
                eventually(lambda: ctl.evaluate("!!document.querySelector('#text')"))
                yield page, ctl, process, debug, 0
                ctl.close()
            finally:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=4)

# Test-only RFC 6455 envelope. The PRODUCT delegates WebSockets to libcurl.
class Audit(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    def __init__(self, upstream, fault=""):
        self.upstream, self.fault, self.methods = upstream, fault, []
        self.connections = 0
        super().__init__(("127.0.0.1", 0), AuditHandler)
        self.thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"ws://127.0.0.1:{self.server_address[1]}/devtools/page/AUDIT"
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.shutdown()
        self.server_close()

class AuditHandler(socketserver.StreamRequestHandler):
    def frame(self, data: bytes, opcode=1, final=True):
        n = len(data)
        header = bytes([(128 if final else 0) | opcode])
        header += bytes([n]) if n < 126 else b"\x7e" + struct.pack("!H", n) if n < 65536 else b"\x7f" + struct.pack("!Q", n)
        self.request.sendall(header + data)
    def message(self):
        h = self.rfile.read(2)
        if len(h) != 2:
            return None
        code, n = h[0] & 15, h[1] & 127
        if n == 126:
            n = struct.unpack("!H", self.rfile.read(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self.rfile.read(8))[0]
        assert n <= 20000 and h[1] & 128 and h[0] & 128
        mask = self.rfile.read(4)
        data = self.rfile.read(n)
        assert len(data) == n
        return code, bytes(v ^ mask[i % 4] for i, v in enumerate(data))
    def handle(self):
        upstream = None
        try:
            self.request.settimeout(12)
            assert self.rfile.readline().startswith(b"GET /devtools/page/")
            headers = {}
            while (line := self.rfile.readline()) not in (b"\r\n", b""):
                k, v = line.decode().split(":", 1)
                headers[k.lower()] = v.strip()
            accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
            self.request.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
            self.server.connections += 1
            upstream = Controller(self.server.upstream)
            while (message := self.message()) is not None:
                code, data = message
                if code in (8, 10):
                    if code == 8:
                        break
                    continue
                assert code == 1
                req = json.loads(data)
                method = req["method"]
                self.server.methods.append(method)  # never retain params, frames or secrets
                assert method in ALLOWED, f"forbidden wire method: {method}"
                fault = self.server.fault
                if fault == "timeout":
                    time.sleep(4)
                    break
                result = upstream.call(method, req.get("params"))
                if fault == "close_after_input" and method.startswith("Input."):
                    break
                if fault == "bad_png" and method == "Page.captureScreenshot":
                    result["data"] = "\x1b_bad_base64"
                reply = json.dumps({"id": req["id"] + (fault == "wrong_id"), "result": result}, separators=(",", ":")).encode()
                if fault == "malformed":
                    reply = b"{broken"
                if fault == "oversize":
                    self.request.sendall(b"\x81\x7f" + struct.pack("!Q", 17 * 1024 * 1024) + b"x")
                    time.sleep(.1)
                    break
                if fault == "fragmented":
                    mid = len(reply) // 2
                    self.frame(reply[:mid], final=False)
                    self.frame(b"ping", opcode=9)
                    self.frame(reply[mid:], opcode=0)
                else:
                    self.frame(reply)
        except (OSError, ValueError, websocket.WebSocketException, AssertionError):
            # Product failure is asserted by the caller. Trace still exposes forbidden methods.
            pass
        finally:
            if upstream:
                upstream.close()

class Probe:
    def __init__(self, url):
        self.p = subprocess.Popen([str(ROOT / "probe"), url], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        assert self.line()[0] == 0, "attach rejected"
    def line(self):
        ready, _, _ = select.select([self.p.stdout], [], [], 12)
        assert ready, "library caller timed out"
        text = self.p.stdout.readline()
        assert text, "library caller exited"
        return [float(x) for x in text.split()]
    def command(self, text):
        self.p.stdin.write(text + "\n")
        self.p.stdin.flush()
        return self.line()
    def frame(self):
        r = self.command("frame")
        assert r[0] == 0, r
        return r
    def close(self):
        if self.p.poll() is None:
            self.p.stdin.write("quit\n")
            self.p.stdin.flush()
        self.p.wait(timeout=5)
        assert self.p.returncode == 0, self.p.stderr.read()
        self.p.stdin.close()
        self.p.stdout.close()
        self.p.stderr.close()
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.close()

class Sink:
    """A real PTY, but only a protocol sink, NOT a terminal renderer."""
    def __init__(self, url, observe=False, ack=True):
        self.master, self.slave = pty.openpty()
        self.saved = termios.tcgetattr(self.slave)
        self.rows, self.cols = 32, 100
        self.resize(self.rows, self.cols)
        self.p = subprocess.Popen([str(ROOT / "cdp-tty"), *( ["--observe"] if observe else [] ), url], stdin=self.slave, stdout=self.slave, stderr=subprocess.PIPE)
        self.buf = b""
        self.parts = []
        self.frames = 0
        self.ack = ack
        self.image = None
        self.last_size = None
        self.chunks = []
    def resize(self, rows, cols):
        self.rows, self.cols = rows, cols
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    def send(self, data):
        os.write(self.master, data)
    def pump(self, duration=.03):
        ready, _, _ = select.select([self.master], [], [], duration)
        if not ready:
            return
        self.buf += os.read(self.master, 65536)
        if b"\x1b[16t" in self.buf:
            self.send(b"\x1b[6;16;8t")
            self.buf = self.buf.replace(b"\x1b[16t", b"")
        while (m := re.search(rb"\x1b_G([^;]*);(.*?)\x1b\\", self.buf, re.S)):
            self.buf = self.buf[m.end():]
            fields = dict(pair.split(b"=", 1) for pair in m[1].split(b",") if b"=" in pair)
            if fields.get(b"a") == b"d":
                continue
            if fields.get(b"a") == b"T":
                self.parts = []
                self.image = int(fields[b"i"])
                self.last_size = int(fields[b"c"]), int(fields[b"r"])
                assert fields[b"t"] == b"d" and fields[b"f"] == b"100"
            assert len(m[2]) <= 4096 and len(m[2]) % 4 == 0
            self.parts.append(m[2])
            self.chunks.append(len(m[2]))
            if fields.get(b"m") == b"0":
                png = base64.b64decode(b"".join(self.parts), validate=True)
                assert png[:8] == b"\x89PNG\r\n\x1a\n"
                self.pixels = struct.unpack("!II", png[16:24])
                # Independent PNG structure/CRC + deflate check, without a renderer.
                i, compressed = 8, b""
                while i < len(png):
                    n = struct.unpack("!I", png[i:i+4])[0]
                    kind, data = png[i+4:i+8], png[i+8:i+8+n]
                    crc = struct.unpack("!I", png[i+8+n:i+12+n])[0]
                    assert zlib.crc32(kind + data) & 0xffffffff == crc
                    if kind == b"IDAT":
                        compressed += data
                    i += 12+n
                assert i == len(png) and zlib.decompress(compressed)
                self.frames += 1
                if self.ack:
                    ack = f"\x1b_Gi={self.image};OK\x1b\\".encode()
                    if self.ack == "split":
                        self.send(ack[:2])
                        time.sleep(.08)
                        self.send(ack[2:])
                    else:
                        self.send(ack)
    def wait_frame(self, count=1):
        end = time.monotonic() + 10
        while self.frames < count and time.monotonic() < end:
            self.pump()
            assert self.p.poll() is None, self.p.stderr.read().decode()
        assert self.frames >= count, "no frame"
        time.sleep(.04)  # let the product consume the matching terminal acknowledgement
    def click(self, x=310, y=160, button=0):
        c, r = self.last_size
        # Fixture coordinates are CSS; screenshot width/height at DPR=1.
        left, top = (self.cols-c)//2, (self.rows-1-r)//2
        cx, cy = left+int(x/self.pixels[0]*c)+1, top+int(y/self.pixels[1]*r)+1
        self.send(f"\x1b[<{button};{cx};{cy}M\x1b[<{button};{cx};{cy}m".encode())
    def close(self, sig=None):
        if self.p.poll() is None:
            if sig:
                self.p.send_signal(sig)
            else:
                self.send(b"\x11")
            end = time.monotonic()+8
            while self.p.poll() is None and time.monotonic()<end:
                self.pump()
        self.p.wait(timeout=3)
        restored = termios.tcgetattr(self.slave) == self.saved
        os.close(self.master)
        os.close(self.slave)
        err = self.p.stderr.read().decode()
        self.p.stderr.close()
        assert restored, "TTY attributes not restored"
        return self.p.returncode, err


def run():
    assert subprocess.run([str(ROOT / "cdp-tty"), "--help"], capture_output=True).returncode == 0
    for url in ["http://127.0.0.1:1/json", "ws://0.0.0.0:1/devtools/page/a", "ws://127.0.0.1:1/devtools/browser/a",
                "ws://127.0.0.1:1/devtools/page/", "ws://user:secret@127.0.0.1:1/devtools/page/a", "ws://127.0.0.1:1/devtools/page/a#fragment"]:
        r = subprocess.run([str(ROOT / "probe"), url], capture_output=True, text=True, timeout=5)
        assert r.stdout.strip() == "3" and "secret" not in r.stderr
    record("explicit-page-loopback-only", rejected=6)
    for scale in (1, 2):
        with browser(scale) as (page, ctl, chrome, debug, port):
            before = ctl.evaluate("[innerWidth,innerHeight,devicePixelRatio]")
            ids = [x["id"] for x in json.load(urllib.request.urlopen(f"http://127.0.0.1:{debug}/json/list"))]
            with Audit(page["webSocketDebuggerUrl"]) as audit:
                with Probe(audit.url) as p:
                    f = p.frame()
                    assert f[1] == round(f[3] * scale) and f[2] == round(f[4] * scale), (f, scale)
                    record("real-chrome-frame-dpr", dpr=scale, pixels=f[1:3], css=f[3:5])
                    assert p.command("invalid")[0] == 3
                    assert p.command("click -1 1 0")[0] == 3
                    assert p.command("key 999")[0] == 3
                    assert p.command("click 310 160 0")[0] == 0
                    assert ctl.evaluate("clicks") == 1
                    point = ctl.evaluate("events.find(e=>e.type==='click')")
                    assert point["x"] == 310 and point["y"] == 160
                    record("real-click-css-coordinate", dpr=scale)
                    ctl.evaluate("document.querySelector('#text').focus()")
                    p.frame()
                    assert p.command("text 日本語")[0] == 0
                    assert ctl.evaluate("document.querySelector('#text').value") == "日本語"
                    p.frame()
                    assert p.command("key 2")[0] == 0  # Backspace
                    assert ctl.evaluate("document.querySelector('#text').value") == "日本"
                    p.frame()
                    assert p.command("key 11")[0] == 0  # Ctrl-A
                    p.frame()
                    assert p.command("text replaced")[0] == 0
                    assert ctl.evaluate("document.querySelector('#text').value") == "replaced"
                    record("real-utf8-physical-key-select-all", dpr=scale)
                    p.frame()
                    assert p.command("wheel 400 400 80")[0] == 0
                    eventually(lambda: ctl.evaluate("events.some(e=>e.type==='wheel' && e.dy===80)"))
                    ctl.evaluate("scrollTo(0,0)")
                    eventually(lambda: ctl.evaluate("scrollY===0"))
                    record("real-wheel", dpr=scale)
                    p.frame()
                    ctl.evaluate("document.querySelector('#stamp').textContent='changed'")
                    assert p.command("text forbidden-stale")[0] == 2
                    assert ctl.evaluate("document.querySelector('#text').value") == "replaced"
                    record("stale-pixels-block-input", dpr=scale)
                    p.frame()
                    old_loader = ctl.call("Page.getFrameTree")["frameTree"]["frame"]["loaderId"]
                    ctl.call("Page.navigate", {"url": "about:blank"})
                    eventually(lambda: ctl.call("Page.getFrameTree")["frameTree"]["frame"]["loaderId"] != old_loader)
                    fid = ctl.call("Page.getFrameTree")["frameTree"]["frame"]["id"]
                    ctl.call("Page.setDocumentContent", {"frameId": fid, "html": PAGE.decode()})
                    eventually(lambda: ctl.evaluate("!!document.querySelector('#text')"))
                    assert p.command("text forbidden-navigation")[0] == 2
                    assert ctl.evaluate("document.querySelector('#text').value") == ""
                    record("navigation-loader-block-input", dpr=scale)
                assert chrome.poll() is None
                assert ctl.evaluate("!!document.querySelector('#text')")
                with Probe(audit.url) as p:
                    p.frame()
                    assert p.command("cancel")[0] == 1
                after_ids = [x["id"] for x in json.load(urllib.request.urlopen(f"http://127.0.0.1:{debug}/json/list"))]
                assert ids == after_ids and before == ctl.evaluate("[innerWidth,innerHeight,devicePixelRatio]")
                assert set(audit.methods) <= ALLOWED
                cookies = ctl.call("Network.getAllCookies")["cookies"]
                assert any(x["name"] == "fixture-session" and x["value"] == "synthetic-only" for x in cookies)
                record("detach-reattach-identity-synthetic-cookie-viewport", dpr=scale, wire_methods=sorted(set(audit.methods)))
                if scale == 1:
                    sink = Sink(audit.url)
                    try:
                        sink.wait_frame()
                        assert sink.pixels == (int(f[1]), int(f[2]))
                        sink.click()
                        sink.wait_frame(sink.frames+1)
                        assert ctl.evaluate("clicks") == 1
                        # Focus is external controller responsibility; input still traverses the PTY.
                        ctl.evaluate("document.querySelector('#text').focus()")
                        sink.wait_frame(sink.frames+1)
                        sink.send(b"\x1b[200~" + "端末入力".encode() + b"\x1b[201~")
                        sink.wait_frame(sink.frames+1)
                        assert ctl.evaluate("document.querySelector('#text').value") == "端末入力"
                        sink.send(b"\x7f")
                        sink.wait_frame(sink.frames+1)
                        assert ctl.evaluate("document.querySelector('#text').value") == "端末入"
                        sink.resize(28, 80)
                        sink.wait_frame(sink.frames+1)
                        assert before == ctl.evaluate("[innerWidth,innerHeight,devicePixelRatio]")
                        record("real-cli-pty-kitty-input-resize", frames=sink.frames, max_payload_chunk=max(sink.chunks), terminal_renderer=False)
                    finally:
                        code, err = sink.close()
                        assert code == 0, err
                    record("tty-normal-exit-restores-state")
                    for sig in (signal.SIGTERM, signal.SIGHUP):
                        sink = Sink(audit.url, observe=True)
                        sink.wait_frame()
                        count = len([m for m in audit.methods if m.startswith("Input.")])
                        sink.send(b"should-not-type\r")
                        for _ in range(10):
                            sink.pump()
                        assert count == len([m for m in audit.methods if m.startswith("Input.")])
                        code, err = sink.close(sig)
                        assert code == 0 and chrome.poll() is None, err
                    record("observe-only-sigterm-sighup-isolation")
                    ctl.evaluate("document.querySelector('#text').value=''; document.querySelector('#text').focus()")
                    sink = Sink(audit.url, ack=False)
                    try:
                        sink.wait_frame()
                        old_id = sink.image
                        count = len([m for m in audit.methods if m.startswith("Input.")])
                        sink.send(b"not-before-ack")
                        for _ in range(4): sink.pump()
                        sink.resize(29, 90)
                        sink.wait_frame(sink.frames+1)
                        assert sink.image != old_id
                        sink.send(f"\x1b_Gi={old_id};OK\x1b\\wrong-generation".encode())
                        for _ in range(4): sink.pump()
                        assert count == len([m for m in audit.methods if m.startswith("Input.")])
                        sink.ack = "split"
                        sink.send(f"\x1b_Gi={sink.image};OK\x1b\\".encode())
                        time.sleep(.06)
                        text = "日".encode()
                        sink.send(text[:1])
                        for _ in range(5): sink.pump()
                        sink.send(text[1:])
                        sink.wait_frame(sink.frames+1)
                        assert ctl.evaluate("document.querySelector('#text').value") == "日"
                        count = len([m for m in audit.methods if m.startswith("Input.")])
                        sink.send(b"\x1bO")
                        for _ in range(3): sink.pump()
                        sink.send(b"A")
                        for _ in range(3): sink.pump()
                        assert count == len([m for m in audit.methods if m.startswith("Input.")])
                        record("ack-generation-and-fragmented-utf8-control")
                    finally:
                        code, err = sink.close()
                        assert code == 0, err
                    for attack in (b"\x1b[200~" + b"x"*5000 + b"\x1b[201~", b"\x1b[<0;" + b"9"*100 + b";1M"):
                        sink = Sink(audit.url)
                        sink.wait_frame()
                        count = len([m for m in audit.methods if m.startswith("Input.")])
                        sink.send(attack)
                        eventually(lambda: (sink.pump() or sink.p.poll() is not None))
                        code, _ = sink.close()
                        assert code == 1 and count == len([m for m in audit.methods if m.startswith("Input.")])
                    record("oversize-paste-and-numeric-control-rejected")
            if scale == 1:
                for fault in ("fragmented", "malformed", "wrong_id", "oversize", "bad_png", "timeout"):
                    with Audit(page["webSocketDebuggerUrl"], fault) as audit, Probe(audit.url) as p:
                        r = p.command("frame")
                        assert (r[0] == 0) == (fault == "fragmented"), (fault, r)
                        assert not any(m.startswith("Input.") for m in audit.methods)
                        record("wire-" + fault)
                ctl.evaluate("document.querySelector('#text').focus()")
                with Audit(page["webSocketDebuggerUrl"], "close_after_input") as audit, Probe(audit.url) as p:
                    p.frame()
                    assert p.command("text once")[0] == 1
                    assert p.command("text must-not-retry")[0] == 1
                    assert audit.methods.count("Input.insertText") == 1 and audit.connections == 1
                    record("unknown-input-result-no-retry")
    # No source-side subprocess or browser lifecycle entrypoint is allowed.
    core = (ROOT / "cdp.c").read_text()
    wire = set(re.findall(r'"((?:Page|Input|Target|Browser|Runtime|Network|Storage|Emulation)\.[A-Za-z]+)"', core))
    assert wire == ALLOWED
    symbols = subprocess.run(["nm", "-u", str(ROOT / "libcdp-tty.a")], capture_output=True, text=True, check=True).stdout
    assert not re.search(r"\b(exec\w*|fork|system|popen|tcsetattr|signal|sigaction|exit)\b", symbols)
    record("finite-wire-surface-no-process-tty-global-core", method_count=len(wire))
    residuals = dict(windows_ssh="NOT_RUN", real_service_auth="NOT_RUN", real_terminal_renderer="NOT_RUN", drag="NOT_IMPLEMENTED", ime_composition="NOT_IMPLEMENTED")
    print(json.dumps({"test": "residuals", "status": "NOT_RUN", **residuals}), flush=True)

if __name__ == "__main__":
    try:
        run()
    except BaseException as error:
        print(json.dumps({"status": "FAIL", "error_type": type(error).__name__}), flush=True)
        raise
