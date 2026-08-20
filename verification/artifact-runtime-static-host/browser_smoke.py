#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

from readback import invariant, validate_root


class ProofDom(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.attributes: dict[str, dict[str, str]] = {}
        self.text: dict[str, list[str]] = {key: [] for key in ("progress", "receipt", "result", "status")}
        self.current: str | None = None
        self.depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if self.current is not None:
            self.depth += 1
            return
        identity = values.get("id")
        if identity in self.text:
            self.current = identity
            self.depth = 1
            self.attributes[identity] = values

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return
        self.depth -= 1
        if self.depth == 0:
            self.current = None

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.text[self.current].append(data)

    def value(self, identity: str) -> str:
        return "".join(self.text[identity]).strip()


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
    completed = subprocess.run([
        browser,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=20000",
        "--dump-dom",
        invoke_url,
    ], capture_output=True, text=True, timeout=70)
    invariant(completed.returncode == 0, f"browser failed: {completed.stderr[-4000:]}")
    dom = completed.stdout
    dom_path.write_text(dom, encoding="utf-8")

    parsed = ProofDom()
    parsed.feed(dom)
    invariant(parsed.attributes.get("status", {}).get("data-state") == "pass", "browser status is not PASS")
    result = json.loads(parsed.value("result"))
    receipt = json.loads(parsed.value("receipt"))
    invariant(result.get("status") == "PASS", "result status is not PASS")
    invariant(receipt.get("result", {}).get("status") == "PASS", "receipt result status is not PASS")
    invariant(any(item.get("contract") == "json-inspection/1" for item in result.get("outputs", [])), "output contract is missing")
    capability = receipt.get("capability") or {}
    invariant(capability.get("id") == "inspect.json" and capability.get("version") == "1", "selected capability is missing")
    invariant("INCONCLUSIVE" not in parsed.value("progress"), "browser produced INCONCLUSIVE")

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
