#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, concurrent.futures, hashlib, json, os, pathlib, re, shutil, subprocess, time, urllib.error, urllib.parse, urllib.request

def run(*args, env=None):
    subprocess.run(args, env=env, check=True)

def capture(*args, env=None):
    return subprocess.run(args, env=env, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout

def load(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))

def dump(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def fetch_one(base, rel, spec):
    req = urllib.request.Request(
        urllib.parse.urljoin(base, rel),
        headers={"Cache-Control": "no-cache", "User-Agent": "mobile-agent-url-only-readback/3"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            data = response.read()
        observed = sha(data)
        if len(data) != spec["bytes"] or observed != spec["sha256"]:
            return rel, {"path": rel, "bytes": len(data), "sha256": observed}
        return rel, None
    except Exception as error:
        return rel, {"path": rel, "error": str(error)}

def readback(base, expected):
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
    raise RuntimeError(json.dumps({"base": base, "mismatches": last[:10]}, sort_keys=True))

def preserve_current_site(stable, site, known_manifest_path):
    known = load(known_manifest_path)
    rows = []
    for rel in sorted(known["files"]):
        if rel.startswith("business-model/"):
            continue
        request = urllib.request.Request(
            urllib.parse.urljoin(stable, rel),
            headers={"Cache-Control": "no-cache", "User-Agent": "mobile-agent-url-only-preserve/1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status != 200:
                    continue
                data = response.read()
        except urllib.error.HTTPError as error:
            if error.code in (403, 404):
                continue
            raise
        except urllib.error.URLError:
            raise
        target = site / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        rows.append({"path": rel, "bytes": len(data), "sha256": sha(data)})
    return rows

def repack(staged, source_sha):
    site = staged / "site"
    files = {}
    for path in sorted(item for item in site.rglob("*") if item.is_file()):
        data = path.read_bytes()
        rel = path.relative_to(site).as_posix()
        files[rel] = {"bytes": len(data), "sha256": sha(data)}
    rows = [{"path": rel, **files[rel]} for rel in sorted(files)]
    digest = sha(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode())
    expected = {
        "schema": "mobile-agent-url-only-runtime-site/2",
        "fileCount": len(files),
        "distTreeDigest": "sha256:" + digest,
        "files": files,
    }
    tag = "mobile-agent-url-only-" + digest
    publication = {
        "schema": "ops.mobileAgentUrlOnlyRuntimePublication/3",
        "status": "PASS",
        "sourceCommit": source_sha,
        "publication": {"tag": tag, "fileCount": len(files), "distTreeDigest": "sha256:" + digest},
    }
    dump(staged / "expected.json", expected)
    dump(staged / "publication.json", publication)
    for old in list(staged.glob("mobile-agent-url-only.*.tar.gz")) + list(staged.glob("mobile-agent-url-only.*.tar.gz.b64.txt")):
        old.unlink()
    archive = staged / f"mobile-agent-url-only.{digest}.tar.gz"
    with archive.open("wb") as handle:
        subprocess.run(
            "tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - . | gzip -n",
            cwd=site,
            shell=True,
            stdout=handle,
            check=True,
        )
    carrier = pathlib.Path(str(archive) + ".b64.txt")
    carrier.write_text(base64.b64encode(archive.read_bytes()).decode("ascii"), encoding="ascii")
    return expected, publication, tag

def ensure_release(staged, tag, source_sha):
    if os.environ.get("GITHUB_EVENT_NAME") == "pull_request":
        return
    archive = next(staged.glob("*.tar.gz"))
    carrier = next(staged.glob("*.b64.txt"))
    assets = [archive, carrier, staged / "expected.json", staged / "publication.json", staged / "manifest.json", staged / "local-proof.json"]
    repo = os.environ["GITHUB_REPOSITORY"]
    if subprocess.run(["gh", "release", "view", tag, "--repo", repo], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
        run(
            "gh", "release", "create", tag, "--repo", repo, "--target", source_sha,
            "--title", "Mobile Agent deploy-once URL runtime",
            "--notes", "Existing reachable Mobile Agent routes preserved byte-for-byte; business-model/1 and hosted semantic JSONL compiler overlaid.",
            *(str(item) for item in assets),
        )
    check = staged.parent / "release-check"
    if check.exists():
        shutil.rmtree(check)
    check.mkdir()
    for asset in assets:
        run("gh", "release", "download", tag, "--repo", repo, "--pattern", asset.name, "--dir", str(check))
        if asset.read_bytes() != (check / asset.name).read_bytes():
            raise RuntimeError("Release readback mismatch: " + asset.name)

def prove(base, examples, out, chrome):
    env = dict(os.environ, CHROMIUM_PATH=chrome)
    run("python3", "verification/mobile-agent-url-only-runtime/tests/browser_compiler.py", base, str(examples), str(out), env=env)
    proof = load(out)
    if proof["urlGeneration"] != "PASS" or proof["urlRendering"] != "PASS":
        raise RuntimeError("browser proof failed")
    return proof

def main():
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
    project = manifest["provider"]["project"]
    stable = f"https://{project}.pages.dev/"

    preserved = preserve_current_site(
        stable,
        staged / "site",
        pathlib.Path.cwd() / "verification/mobile-agent-preset-app/expected.json",
    )
    dump(out / "preserved.json", {"schema": "mobile-agent-url-only-preserved/1", "status": "PASS", "files": preserved})
    expected, publication, tag = repack(staged, args.source_sha)
    ensure_release(staged, tag, args.source_sha)

    if not os.environ.get("CLOUDFLARE_ACCOUNT_ID") or not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise RuntimeError("Cloudflare credentials are required")
    output = capture(
        "npx", "--yes", "wrangler@4.112.0", "pages", "deploy", str(staged / "site"),
        "--project-name", project, "--branch", "proposals", "--commit-hash", args.source_sha,
        "--commit-message", "Mobile Agent deploy-once business-model/1 URL runtime",
    )
    print(output)
    candidates = re.findall(r"https://[A-Za-z0-9.-]+\\.pages\\.dev", output)
    deployment = next((url.rstrip("/") + "/" for url in candidates if url.rstrip("/") + "/" != stable), None)
    if not deployment:
        raise RuntimeError("deployment-specific Pages URL not found")

    dump(
        out / "readback.json",
        {
            "schema": "mobile-agent-url-only-runtime-readback/3",
            "status": "PASS",
            "proofs": [readback(stable, expected), readback(deployment, expected)],
        },
    )

    chrome = os.environ.get("CHROMIUM_PATH") or os.environ.get("CHROME_BIN")
    if not chrome:
        for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
            found = shutil.which(name)
            if found:
                chrome = found
                break
    if not chrome:
        raise RuntimeError("Chrome/Chromium not found")

    examples = pathlib.Path.cwd() / "verification/mobile-agent-business-model-presentation/examples"
    stable_proof = prove(stable, examples, out / "stable.json", chrome)
    immutable_proof = prove(deployment, examples, out / "immutable.json", chrome)
    cases = []
    for left, right in zip(stable_proof["cases"], immutable_proof["cases"]):
        assert left["actorCount"] == right["actorCount"]
        assert left["payloadSha256"] == right["payloadSha256"]
        assert left["generated"] == left["rendered"] == right["generated"] == right["rendered"] == "PASS"
        cases.append(
            {
                "actorCount": left["actorCount"],
                "stableUrl": left["url"],
                "immutableUrl": right["url"],
                "urlGeneration": "PASS",
                "urlRendering": "PASS",
                "roundTripExact": True,
            }
        )

    receipt = {
        "schema": "ops.mobileAgentUrlOnlyRuntimeReceipt/3",
        "status": "PASS",
        "authority": False,
        "repository": os.environ["GITHUB_REPOSITORY"],
        "candidateSha": args.source_sha,
        "acceptedRef": manifest["publication"]["acceptedRef"],
        "pattern": "business-model/1",
        "provider": {"kind": "cloudflare-pages", "project": project, "stableBase": stable, "deploymentBase": deployment},
        "publication": {"tag": tag, "fileCount": expected["fileCount"], "treeDigest": expected["distTreeDigest"]},
        "compiler": {"module": manifest["compiler"]["module"], "stable": "PASS", "immutable": "PASS"},
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
            handle.write(f"stable_base={stable}\ndeployment_base={deployment}\ntag={tag}\n")
    print(json.dumps({"status": "PASS", "urlGeneration": "PASS", "urlRendering": "PASS", "stableUrl": cases[0]["stableUrl"]}))

if __name__ == "__main__":
    main()
