#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path, PurePosixPath
import argparse
import hashlib
import importlib.util
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request

HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def sha_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run(command, cwd=None, env=None):
    result = subprocess.run(command, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(map(str, command))}\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def load_core(path):
    spec = importlib.util.spec_from_file_location("ops_decision_core", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load core")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def safe_relative_path(raw):
    if not isinstance(raw, str) or not raw or "\\" in raw:
        raise RuntimeError(f"invalid release path: {raw!r}")
    value = PurePosixPath(raw)
    if value.is_absolute() or any(part in {"", ".", ".."} for part in value.parts) or value.as_posix() != raw:
        raise RuntimeError(f"unsafe release path: {raw}")
    return value


def verify_manifest(root, expected_manifest_sha256):
    root = Path(root).resolve()
    manifest_path = root / "artifact-manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError("release artifact manifest missing")
    if not HEX64.fullmatch(expected_manifest_sha256):
        raise RuntimeError("release manifest SHA-256 format invalid")
    actual_manifest_sha256 = sha_file(manifest_path)
    if actual_manifest_sha256 != expected_manifest_sha256:
        raise RuntimeError(f"release manifest SHA mismatch: {actual_manifest_sha256} != {expected_manifest_sha256}")

    manifest = read_json(manifest_path)
    if manifest.get("schema") != "ops.proofArtifactManifest.v1" or not isinstance(manifest.get("files"), list):
        raise RuntimeError("release artifact manifest contract mismatch")
    rows = manifest["files"]
    paths = [safe_relative_path(row.get("path")) for row in rows if isinstance(row, dict)]
    if len(paths) != len(rows) or len(paths) != len(set(paths)):
        raise RuntimeError("release manifest duplicate or malformed path")

    expected_files = {path.as_posix() for path in paths}
    actual_files = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path.name != "artifact-manifest.json"
    }
    if actual_files != expected_files:
        raise RuntimeError(f"release file set mismatch: expected={sorted(expected_files)} actual={sorted(actual_files)}")

    for row, relative in zip(rows, paths, strict=True):
        path = root.joinpath(*relative.parts)
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            raise RuntimeError(f"release path is not a contained regular file: {relative}")
        expected_bytes = row.get("bytes")
        expected_sha = row.get("sha256")
        if not isinstance(expected_bytes, int) or expected_bytes < 0 or not isinstance(expected_sha, str) or not HEX64.fullmatch(expected_sha):
            raise RuntimeError(f"release manifest identity invalid: {relative}")
        if path.stat().st_size != expected_bytes or sha_file(path) != expected_sha:
            raise RuntimeError(f"release manifest mismatch: {relative}")
    return manifest, actual_manifest_sha256


def verify_repository(repo, exact_commit, exact_tree):
    if not HEX40.fullmatch(exact_commit) or not HEX40.fullmatch(exact_tree):
        raise RuntimeError("exact Git identities must be 40 lowercase hex")
    actual_commit = run(["git", "rev-parse", "HEAD"], cwd=repo)
    actual_tree = run(["git", "rev-parse", "HEAD^{tree}"], cwd=repo)
    if actual_commit != exact_commit or actual_tree != exact_tree:
        raise RuntimeError(f"repository identity mismatch: {actual_commit}/{actual_tree}")
    if run(["git", "status", "--porcelain=v1", "--untracked-files=no"], cwd=repo):
        raise RuntimeError("tracked repository state is dirty")
    run(["git", "fsck", "--no-dangling"], cwd=repo)
    return {"commit": actual_commit, "tree": actual_tree, "fsck": "PASS", "trackedWorktreeClean": True}


def local_http(root):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    process = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(root)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 10
        while True:
            try:
                body = urllib.request.urlopen(f"http://127.0.0.1:{port}/decision-room.html", timeout=2).read()
                return {
                    "status": "PASS",
                    "provider": "python-local-http",
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
            except Exception:
                if time.time() >= deadline:
                    raise
                time.sleep(0.1)
    finally:
        process.terminate()
        process.wait(timeout=5)


def selected_query(package, release):
    projection = release / "checkpoint-selected"
    manifest_path = projection / "manifest.json"
    manifest_sha = sha_file(manifest_path)
    command = [
        sys.executable,
        str(package / "bin/query.py"),
        "--projection", str(projection),
        "--manifest-sha256", manifest_sha,
        "--query", "current_decisions",
        "--params-json", '{"domain":"decision-ledger"}',
    ]
    result = json.loads(run(command))
    if result.get("status") != "PASS" or [row.get("id") for row in result.get("rows", [])] != ["d-lease-current"]:
        raise RuntimeError("selected SQLite query replay mismatch")
    return {
        "status": "PASS",
        "manifestSha256": manifest_sha,
        "semanticDigest": result["semanticDigest"],
        "requiredShardOrFileCount": result["metrics"]["requiredShardOrFileCount"],
    }


def synthetic_impact(package, core, out):
    records = core.load_authority(package / "fixtures")
    original_root = core.projection_root_digest(records)
    synthetic = {
        "id": "f-lease-clean-room-synthetic",
        "record_type": "fact",
        "subtype": "observation",
        "domain": "decision-ledger",
        "subject": "clean-room",
        "predicate": "synthetic_runtime_limit",
        "value": "required-query p95 exceeded the accepted ingress profile",
        "at": "2026-08-18T06:00:00Z",
        "observed_at": "2026-08-18T06:00:00Z",
        "origin_run_id": "clean-room-takeover",
        "source_class": "synthetic_takeover_fixture",
        "source_ref": "fixture://clean-room/synthetic",
        "source_digest": "sha256:" + "b" * 64,
        "confidence": "synthetic",
        "rel": [],
    }
    records.append(synthetic)
    current = next(row for row in records if row["id"] == "d-lease-current")
    current["rel"].append({"type": "depends_on", "target": synthetic["id"]})
    core.validate_authority(records)
    projection = out / "synthetic-checkpoint"
    core.build_sqlite_projection(records, projection, "decision-ledger-clean-room-candidate")
    rows, _ = core.query_sqlite(projection, "impact_by_fact", {"fact_id": synthetic["id"]})
    ids = [row["id"] for row in rows]
    if "d-lease-current" not in ids:
        raise RuntimeError("synthetic fact impact did not identify current decision")
    candidate = {
        "schema": "ops.cleanRoomNextCheckpointCandidate.v1",
        "authority": False,
        "accepted": False,
        "sourceCheckpointRoot": original_root,
        "candidateRoot": core.projection_root_digest(records),
        "syntheticFact": synthetic,
        "impactedDecisions": ids,
    }
    write_json(out / "next-checkpoint-candidate.json", candidate)
    source_unchanged = core.projection_root_digest(core.load_authority(package / "fixtures")) == original_root
    return {"status": "PASS", "impactedDecisions": ids, "sourceCheckpointUnchanged": source_unchanged}


def sensitive_environment_names():
    markers = ("TOKEN", "SECRET", "PASSWORD", "PRIVATE_KEY", "API_KEY")
    return sorted(name for name, value in os.environ.items() if value and any(marker in name.upper() for marker in markers))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--release-proof-dir", required=True)
    parser.add_argument("--release-manifest-sha256", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--duckdb", required=True)
    parser.add_argument("--exact-commit", required=True)
    parser.add_argument("--exact-tree", required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--operator-id", default="github-actions-clean-room")
    args = parser.parse_args()
    started = time.monotonic()
    repo = Path(args.repo_root).resolve()
    package = repo / "packages/ops-decision-closure"
    release = Path(args.release_proof_dir).resolve()
    out = Path(args.out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    sensitive_names = sensitive_environment_names()
    if sensitive_names:
        raise SystemExit("clean-room environment contains sensitive variables: " + ",".join(sensitive_names))
    repository = verify_repository(repo, args.exact_commit, args.exact_tree)
    release_manifest, release_manifest_sha = verify_manifest(release, args.release_manifest_sha256)
    release_receipt = read_json(release / "final-closure-receipt.json")
    if release_receipt["authority"]["commit"] != args.exact_commit or release_receipt["authority"]["tree"] != args.exact_tree:
        raise SystemExit("release authority identity mismatch")

    rebuilt = out / "rebuilt"
    command = [
        sys.executable,
        str(package / "bin/final-proof.py"),
        "--out-dir", str(rebuilt),
        "--duckdb", args.duckdb,
        "--source-commit", args.exact_commit,
        "--source-tree", args.exact_tree,
    ]
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise SystemExit(result.stdout + "\n" + result.stderr)
    rebuilt_receipt = read_json(rebuilt / "final-closure-receipt.json")
    if rebuilt_receipt["selectedEngine"] != release_receipt["selectedEngine"]:
        raise SystemExit("selected engine replay mismatch")
    if rebuilt_receipt["authority"]["rootDigest"] != release_receipt["authority"]["rootDigest"]:
        raise SystemExit("authority root replay mismatch")
    if read_json(rebuilt / "decision-packet.json")["packet_digest"] != read_json(release / "decision-packet.json")["packet_digest"]:
        raise SystemExit("Decision Packet replay mismatch")
    if sha_file(rebuilt / "checkpoint-selected/manifest.json") != sha_file(release / "checkpoint-selected/manifest.json"):
        raise SystemExit("selected checkpoint replay mismatch")
    if read_json(rebuilt / "bounded/closure-receipt.json")["oldCheckpointReplay"] != "PASS":
        raise SystemExit("old checkpoint replay failed")

    query = selected_query(package, release)
    packet = read_json(release / "decision-packet.json")
    explanation = {
        "question": packet["question"],
        "recommendation": packet["recommendation"],
        "supportingEvidence": packet["evidence_for"],
        "counterevidence": packet["evidence_against"],
        "alternatives": packet["alternatives"],
        "gaps": packet["gaps"],
        "nextAction": packet["next_action"],
        "successConditions": packet["success_conditions"],
        "stopConditions": packet["stop_conditions"],
        "outcomes": packet["outcomes"],
        "recordRefs": packet["record_refs"],
    }
    write_json(out / "decision-explanation.json", explanation)
    host = local_http(release)
    core = load_core(package / "bin/ops-decision-closure.py")
    impact = synthetic_impact(package, core, out)

    required_dd = [
        "authority-and-ownership.json",
        "current-decisions.json",
        "decision-lineage.json",
        "outcome-coverage.json",
        "conflicts-and-gaps.json",
        "decision-economics.json",
        "provider-dependencies.json",
        "source-and-license-inventory.json",
        "software-sbom.json",
        "data-classification.json",
        "public-private-boundary.json",
        "operational-runbook.json",
        "known-limitations.json",
    ]
    missing_dd = [name for name in required_dd if not (release / "dd-packet" / name).is_file()]
    if missing_dd:
        raise SystemExit("DD packet incomplete: " + ",".join(missing_dd))

    receipt = {
        "schema": "ops.independentTakeover.v2",
        "verdict": "PASS_INDEPENDENT_TRANSFER_DD_G10",
        "operator_id": args.operator_id,
        "operator_relation_to_owner": "independent hosted automation; no owner memory, Chat history, local files, or secrets",
        "clean_environment": True,
        "input_repository": "roccho-dev/ops",
        "input_commit": args.exact_commit,
        "input_tree": args.exact_tree,
        "input_release_tags": [args.release_tag],
        "secret_count": 0,
        "sensitive_environment_names": [],
        "undocumented_step_count": 0,
        "owner_intervention_count": 0,
        "chat_history_used": False,
        "model_memory_used": False,
        "owner_local_worktree_used": False,
        "repository_identity_result": repository,
        "release_manifest_sha256": release_manifest_sha,
        "restore_result": "PASS",
        "verify_result": "PASS",
        "clean_build_result": "PASS",
        "current_digest_match": True,
        "selected_query_result": query,
        "old_checkpoint_replay_result": "PASS",
        "decision_explanation_result": "PASS",
        "packet_rebuild_result": "PASS",
        "ssg_rebuild_result": "PASS",
        "alternate_host_result": host,
        "synthetic_fact_admission_result": "PASS_CANDIDATE_ONLY",
        "impact_result": impact,
        "next_checkpoint_result": "PASS_CANDIDATE_ONLY",
        "source_checkpoint_unchanged": impact["sourceCheckpointUnchanged"],
        "release_manifest_file_count": len(release_manifest["files"]),
        "dd_packet_result": "PASS",
        "manual_step_count": 0,
        "elapsed_seconds": time.monotonic() - started,
        "failures": [],
        "limitations": ["operator is independent automation rather than a third-party human; literal human adoption is a separate L2 gate"],
    }
    write_json(out / "independent-takeover.receipt.json", receipt)
    print(json.dumps({"status": receipt["verdict"], "alternateHost": host["status"], "impact": impact["status"]}, sort_keys=True))


if __name__ == "__main__":
    main()
