#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request


def run(*args: str, env: dict | None = None) -> None:
    subprocess.run(args, env=env, check=True)


def capture(*args: str) -> str:
    return subprocess.run(
        args,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    ).stdout


def load(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(path: pathlib.Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_one(base: str, rel: str, spec: dict):
    request = urllib.request.Request(
        urllib.parse.urljoin(base, rel),
        headers={
            "Cache-Control": "no-cache",
            "User-Agent": "mobile-agent-url-only-readback/4",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read()
        observed = sha256(data)
        if len(data) != spec["bytes"] or observed != spec["sha256"]:
            return rel, {
                "path": rel,
                "expectedBytes": spec["bytes"],
                "observedBytes": len(data),
                "expectedSha256": spec["sha256"],
                "observedSha256": observed,
            }
        return rel, None
    except Exception as error:
        return rel, {"path": rel, "error": str(error)}


def readback(base: str, expected: dict) -> dict:
    pending = dict(expected["files"])
    last = []
    for _ in range(90):
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda item: fetch_one(base, *item), pending.items()))
        bad = {rel: pending[rel] for rel, error in results if error is not None}
        last = [error for _, error in results if error is not None]
        if not bad:
            return {
                "base": base,
                "fileCount": expected["fileCount"],
                "treeDigest": expected["distTreeDigest"],
                "status": "PASS",
            }
        pending = bad
        time.sleep(2)
    raise RuntimeError(
        "public byte readback failed: "
        + json.dumps({"base": base, "mismatches": last[:10]}, sort_keys=True)
    )


def chrome_path() -> str:
    explicit = os.environ.get("CHROMIUM_PATH") or os.environ.get("CHROME_BIN")
    if explicit:
        return explicit
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError("Chrome/Chromium not found")


def prove(base: str, examples: pathlib.Path, out: pathlib.Path, chrome: str) -> dict:
    env = dict(os.environ, CHROMIUM_PATH=chrome)
    run(
        "python3",
        "verification/mobile-agent-url-only-runtime/tests/browser_compiler.py",
        base,
        str(examples),
        str(out),
        env=env,
    )
    proof = load(out)
    if proof["urlGeneration"] != "PASS" or proof["urlRendering"] != "PASS":
        raise RuntimeError("URL generation/render proof failed")
    return proof


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--github-output")
    args = parser.parse_args()

    staged = pathlib.Path(args.staged)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = load(staged / "manifest.json")
    expected = load(staged / "expected.json")
    publication = load(staged / "publication.json")
    project = manifest["provider"]["project"]
    stable = f"https://{project}.pages.dev/"

    if not os.environ.get("CLOUDFLARE_ACCOUNT_ID") or not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise RuntimeError("Cloudflare credentials are required")

    output = capture(
        "npx",
        "--yes",
        "wrangler@4.112.0",
        "pages",
        "deploy",
        str(staged / "site"),
        "--project-name",
        project,
        "--branch",
        "proposals",
        "--commit-hash",
        args.source_sha,
        "--commit-message",
        "Mobile Agent deploy-once business-model/1 URL runtime",
    )
    print(output)
    candidates = re.findall(r"https://[A-Za-z0-9.-]+\.pages\.dev", output)
    deployment = next(
        (url.rstrip("/") + "/" for url in candidates if url.rstrip("/") + "/" != stable),
        None,
    )
    if not deployment:
        raise RuntimeError(f"deployment-specific Pages URL not found in: {candidates}")

    dump(
        out / "readback.json",
        {
            "schema": "mobile-agent-url-only-runtime-readback/4",
            "status": "PASS",
            "proofs": [readback(stable, expected), readback(deployment, expected)],
        },
    )

    chrome = chrome_path()
    examples = pathlib.Path.cwd() / "verification/mobile-agent-business-model-presentation/examples"
    stable_proof = prove(stable, examples, out / "stable.json", chrome)
    immutable_proof = prove(deployment, examples, out / "immutable.json", chrome)

    cases = []
    for stable_case, immutable_case in zip(stable_proof["cases"], immutable_proof["cases"]):
        assert stable_case["actorCount"] == immutable_case["actorCount"]
        assert stable_case["payloadSha256"] == immutable_case["payloadSha256"]
        assert stable_case["generated"] == stable_case["rendered"] == "PASS"
        assert immutable_case["generated"] == immutable_case["rendered"] == "PASS"
        cases.append(
            {
                "actorCount": stable_case["actorCount"],
                "stableUrl": stable_case["url"],
                "immutableUrl": immutable_case["url"],
                "urlGeneration": "PASS",
                "urlRendering": "PASS",
                "roundTripExact": True,
            }
        )

    receipt = {
        "schema": "ops.mobileAgentUrlOnlyRuntimeReceipt/4",
        "status": "PASS",
        "authority": False,
        "repository": os.environ["GITHUB_REPOSITORY"],
        "candidateSha": args.source_sha,
        "acceptedRef": manifest["publication"]["acceptedRef"],
        "pattern": "business-model/1",
        "provider": {
            "kind": "cloudflare-pages",
            "project": project,
            "stableBase": stable,
            "deploymentBase": deployment,
        },
        "publication": {
            "tag": publication["publication"]["tag"],
            "fileCount": expected["fileCount"],
            "treeDigest": expected["distTreeDigest"],
        },
        "compiler": {
            "module": manifest["compiler"]["module"],
            "stable": "PASS",
            "immutable": "PASS",
        },
        "cases": cases,
        "proof": {
            "stableReadback": "PASS",
            "immutableReadback": "PASS",
            "stableChrome": "PASS",
            "immutableChrome": "PASS",
            "urlGeneration": "PASS",
            "urlRendering": "PASS",
        },
    }
    dump(out / "accepted-public-url-receipt.json", receipt)

    if args.github_output:
        with pathlib.Path(args.github_output).open("a", encoding="utf-8") as handle:
            handle.write(f"stable_base={stable}\n")
            handle.write(f"deployment_base={deployment}\n")

    print(
        json.dumps(
            {
                "status": "PASS",
                "urlGeneration": "PASS",
                "urlRendering": "PASS",
            }
        )
    )


if __name__ == "__main__":
    main()
