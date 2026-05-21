#!/usr/bin/env python3
import argparse
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


DEFAULT_REMOTE = "git@github.com:roccho-dev/refs.git"
REPO_ID_RE = re.compile(r"^(?!\.)(?!.*\.\.)(?!.*\.lock$)(?!.*@\{)[A-Za-z0-9._-]+$")


class VaultError(RuntimeError):
    pass


def run(cmd, cwd=None, check=True, capture=False):
    result = subprocess.run(
        cmd,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if check and result.returncode != 0:
        detail = ""
        if capture:
            detail = f"\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        raise VaultError(f"command failed rc={result.returncode}: {' '.join(cmd)}{detail}")
    return result


def validate_repo_id(repo_id):
    if not repo_id or "/" in repo_id or not REPO_ID_RE.match(repo_id):
        raise VaultError(f"invalid repoId: {repo_id}")


def validate_branch(branch):
    if not branch or branch.startswith("/") or branch.endswith("/") or ".." in branch or "@{" in branch:
        raise VaultError(f"invalid branch: {branch}")


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def vault_remote(manifest, override=None):
    if override:
        return override
    target = manifest.get("targetForgeRepo", {})
    return target.get("sshUrl") or target.get("url") or DEFAULT_REMOTE


def manifest_repos(manifest):
    for repo in manifest.get("repos", []):
        repo_id = repo.get("repoId")
        if not repo_id:
            continue
        validate_repo_id(repo_id)
        yield repo_id, repo


def manifest_repo(manifest, repo_id):
    validate_repo_id(repo_id)
    for current_id, repo in manifest_repos(manifest):
        if current_id == repo_id:
            return repo
    raise VaultError(f"repoId not found in manifest: {repo_id}")


def source_bare(repo):
    path = repo.get("sourceBarePath") or repo.get("sourceBare") or repo.get("barePath")
    if not path:
        raise VaultError(f"manifest repoId={repo.get('repoId')} is missing sourceBarePath")
    return path


def namespaced_head(repo_id, branch):
    validate_repo_id(repo_id)
    validate_branch(branch)
    return f"refs/heads/repos/{repo_id}/{branch}"


def ls_remote(remote, pattern):
    result = run(["git", "ls-remote", remote, pattern], capture=True)
    rows = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        sha, ref = line.split("\t", 1)
        rows.append((sha, ref))
    return rows


def one_remote_hash(remote, ref):
    rows = ls_remote(remote, ref)
    if not rows:
        return None
    if len(rows) > 1:
        raise VaultError(f"remote ref matched more than once: {ref}")
    return rows[0][0]


def is_local_bare(remote):
    path = Path(remote)
    return path.exists() and (path / "HEAD").is_file() and (path / "objects").is_dir()


def push_ref_to_vault(source, vault, src_ref, dst_ref, force=False):
    refspec = f"{'+' if force else ''}{src_ref}:{dst_ref}"
    if is_local_bare(source):
        run(["git", "--git-dir", source, "push", vault, refspec], capture=True)
        return refspec
    tmp = Path(tempfile.mkdtemp(prefix="ops-refs-vault-source-"))
    try:
        run(["git", "init", "-q", "--bare", str(tmp)])
        run(["git", "--git-dir", str(tmp), "fetch", "--no-tags", source, f"+{src_ref}:{src_ref}"], capture=True)
        run(["git", "--git-dir", str(tmp), "push", vault, refspec], capture=True)
        return refspec
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def list_source_heads(source):
    rows = ls_remote(source, "refs/heads/*")
    out = []
    for sha, ref in rows:
        branch = ref[len("refs/heads/") :]
        if branch:
            validate_branch(branch)
            out.append((sha, branch, ref))
    return out


def ensure_empty_or_new_bare(path):
    bare = Path(path).resolve()
    if bare.exists():
        if not (bare / "HEAD").is_file() or not (bare / "objects").is_dir():
            raise VaultError(f"staging path exists but is not a bare git repo: {bare}")
        refs = run(["git", "--git-dir", str(bare), "for-each-ref", "--format=%(refname)"], capture=True).stdout.strip()
        if refs:
            raise VaultError(f"staging bare is not empty: {bare}")
    else:
        bare.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "init", "-q", "--bare", str(bare)])
    return bare


def init_bare_if_missing(path):
    bare = Path(path).resolve()
    if not bare.exists():
        bare.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "init", "-q", "--bare", str(bare)])
    if not (bare / "HEAD").is_file() or not (bare / "objects").is_dir():
        raise VaultError(f"target path is not a bare git repo: {bare}")
    return bare


def push_source_ref_to_vault(source, vault, repo_id, branch, force=False, dry_run=False):
    src_ref = f"refs/heads/{branch}"
    dst_ref = namespaced_head(repo_id, branch)
    source_sha = one_remote_hash(source, src_ref)
    if not source_sha:
        raise VaultError(f"source branch missing: {source} {src_ref}")
    refspec = f"{'+' if force else ''}{src_ref}:{dst_ref}"
    if not dry_run:
        push_ref_to_vault(source, vault, src_ref, dst_ref, force)
    return {"sourceRef": src_ref, "sourceHash": source_sha, "vaultRef": dst_ref, "refspec": refspec}


def cmd_backup_one(args):
    manifest = load_manifest(args.manifest)
    repo = manifest_repo(manifest, args.repo_id)
    source = source_bare(repo)
    vault = vault_remote(manifest, args.remote)
    result = push_source_ref_to_vault(source, vault, args.repo_id, args.branch, args.force, args.dry_run)
    remote_hash = None if args.dry_run else one_remote_hash(vault, result["vaultRef"])
    ok = args.dry_run or result["sourceHash"] == remote_hash
    print(json.dumps({
        "ok": ok,
        "mode": "backup-one",
        "repoId": args.repo_id,
        "sourceBarePath": source,
        "vaultRemote": vault,
        "dryRun": args.dry_run,
        "remoteHash": remote_hash,
        **result,
    }, ensure_ascii=False, indent=2))
    if not ok:
        raise VaultError("post-push vault hash differs from source")


def cmd_backup_all(args):
    manifest = load_manifest(args.manifest)
    vault = vault_remote(manifest, args.remote)
    results = []
    for repo_id, repo in manifest_repos(manifest):
        source = source_bare(repo)
        branches = [(sha, args.branch, f"refs/heads/{args.branch}")] if args.branch else list_source_heads(source)
        for _sha, branch, _ref in branches:
            item = {"repoId": repo_id, "sourceBarePath": source, "branch": branch}
            try:
                item.update(push_source_ref_to_vault(source, vault, repo_id, branch, args.force, args.dry_run))
                item["remoteHash"] = None if args.dry_run else one_remote_hash(vault, item["vaultRef"])
                item["ok"] = args.dry_run or item["sourceHash"] == item["remoteHash"]
                item["status"] = "dry-run" if args.dry_run else "backed-up"
            except Exception as exc:
                item.update(ok=False, status="failed", error=str(exc))
            results.append(item)
    print(json.dumps({
        "ok": all(item.get("ok") for item in results),
        "mode": "backup-all",
        "vaultRemote": vault,
        "dryRun": args.dry_run,
        "results": results,
    }, ensure_ascii=False, indent=2))
    if not all(item.get("ok") for item in results):
        raise VaultError("one or more refs failed backup")


def cmd_restore_bare_one(args):
    manifest = load_manifest(args.manifest)
    manifest_repo(manifest, args.repo_id)
    vault = vault_remote(manifest, args.remote)
    staging = ensure_empty_or_new_bare(args.staging_bare)
    src_ref = namespaced_head(args.repo_id, args.branch)
    dst_ref = f"refs/heads/{args.branch}"
    fetch = run(["git", "--git-dir", str(staging), "fetch", "--no-tags", vault, f"+{src_ref}:{dst_ref}"], capture=True, check=False)
    if fetch.returncode != 0:
        raise VaultError(f"missing vault branch: {src_ref}")
    restored_hash = one_remote_hash(str(staging), dst_ref)
    vault_hash = one_remote_hash(vault, src_ref)
    ok = restored_hash == vault_hash and bool(restored_hash)
    print(json.dumps({
        "ok": ok,
        "mode": "restore-bare-one",
        "repoId": args.repo_id,
        "branch": args.branch,
        "vaultRemote": vault,
        "vaultRef": src_ref,
        "stagingBare": str(staging),
        "restoredRef": dst_ref,
        "restoredHash": restored_hash,
        "vaultHash": vault_hash,
    }, ensure_ascii=False, indent=2))
    if not ok:
        raise VaultError("restored hash differs from vault")


def cmd_promote_staging_bare(args):
    if not args.confirm:
        raise VaultError("promote-staging-bare requires --confirm")
    staging = Path(args.staging_bare).resolve()
    if not (staging / "HEAD").is_file() or not (staging / "objects").is_dir():
        raise VaultError(f"staging path is not a bare git repo: {staging}")
    target = init_bare_if_missing(args.target_bare)
    heads = run(["git", "--git-dir", str(staging), "for-each-ref", "--format=%(refname)", "refs/heads"], capture=True).stdout.splitlines()
    if not heads:
        raise VaultError("staging bare has no heads to promote")
    promoted = []
    for ref in heads:
        run(["git", "--git-dir", str(staging), "push", str(target), f"{ref}:{ref}"], capture=True)
        promoted.append({"ref": ref, "hash": one_remote_hash(str(target), ref)})
    print(json.dumps({
        "ok": True,
        "mode": "promote-staging-bare",
        "repoId": args.repo_id,
        "stagingBare": str(staging),
        "targetBare": str(target),
        "promoted": promoted,
    }, ensure_ascii=False, indent=2))


def cmd_verify_one(args):
    manifest = load_manifest(args.manifest)
    repo = manifest_repo(manifest, args.repo_id)
    source = source_bare(repo)
    vault = vault_remote(manifest, args.remote)
    source_ref = f"refs/heads/{args.branch}"
    vault_ref = namespaced_head(args.repo_id, args.branch)
    source_hash = one_remote_hash(source, source_ref)
    vault_hash = one_remote_hash(vault, vault_ref)
    ok = bool(source_hash) and source_hash == vault_hash
    print(json.dumps({
        "ok": ok,
        "mode": "verify-one",
        "repoId": args.repo_id,
        "branch": args.branch,
        "sourceBarePath": source,
        "vaultRemote": vault,
        "sourceRef": source_ref,
        "vaultRef": vault_ref,
        "sourceHash": source_hash,
        "vaultHash": vault_hash,
    }, ensure_ascii=False, indent=2))
    if not ok:
        raise VaultError("source and vault hashes differ")


def cmd_audit(args):
    manifest = load_manifest(args.manifest)
    vault = vault_remote(manifest, args.remote)
    seen = {}
    for sha, ref in ls_remote(vault, "refs/heads/repos/*"):
        mo = re.match(r"refs/heads/repos/([^/]+)/(.+)$", ref)
        if mo:
            seen.setdefault(mo.group(1), []).append({"branch": mo.group(2), "hash": sha})
    expected = [repo_id for repo_id, _repo in manifest_repos(manifest)]
    missing = [repo_id for repo_id in expected if repo_id not in seen]
    print(json.dumps({
        "ok": not missing,
        "mode": "audit",
        "vaultRemote": vault,
        "expectedRepoIds": expected,
        "seenRepoIds": sorted(seen),
        "missing": missing,
        "extra": sorted(set(seen) - set(expected)),
        "seen": seen,
    }, ensure_ascii=False, indent=2))
    if missing:
        raise VaultError("vault missing expected repo namespaces")


def write_tsv(path, rows, fields):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\t".join(fields) + "\n")
        for row in rows:
            fh.write("\t".join(str(row.get(field, "")) for field in fields) + "\n")


def cmd_inventory(args):
    manifest = load_manifest(args.manifest)
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for repo_id, repo in manifest_repos(manifest):
        source = source_bare(repo)
        try:
            heads = list_source_heads(source)
            if not heads:
                rows.append({"repoId": repo_id, "sourceBarePath": source, "status": "empty"})
            for sha, branch, ref in heads:
                rows.append({"repoId": repo_id, "sourceBarePath": source, "status": "ok", "branch": branch, "ref": ref, "hash": sha})
        except Exception as exc:
            rows.append({"repoId": repo_id, "sourceBarePath": source, "status": "failed", "error": str(exc)})
    fields = ["repoId", "sourceBarePath", "status", "branch", "ref", "hash", "error"]
    write_tsv(out_dir / "bare-inventory.tsv", rows, fields)
    print(json.dumps({"ok": all(row["status"] in {"ok", "empty"} for row in rows), "mode": "inventory", "outDir": str(out_dir), "rows": len(rows)}, ensure_ascii=False, indent=2))


def init_work_repo(path, branch, text):
    path.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q", "-b", branch, str(path)])
    run(["git", "config", "user.email", "ops-refs-vault@example.invalid"], cwd=path)
    run(["git", "config", "user.name", "ops-refs-vault"], cwd=path)
    (path / "README.txt").write_text(text + "\n", encoding="utf-8")
    run(["git", "add", "README.txt"], cwd=path)
    run(["git", "commit", "-q", "-m", "init"], cwd=path)


def push_work_to_bare(work, bare, branch):
    run(["git", "remote", "add", "ssot", str(bare)], cwd=work)
    run(["git", "push", "ssot", f"refs/heads/{branch}:refs/heads/{branch}"], cwd=work)


def cmd_smoke_local(_args):
    root = Path(tempfile.mkdtemp(prefix="ops-refs-vault-bare-ssot-"))
    proofs = []

    def proof(proof_id, requirement, evidence):
        proofs.append({"id": proof_id, "requirement": requirement, "status": "pass", "evidence": evidence})

    try:
        vault = root / "refs.git"
        alpha_bare = root / "ssot" / "alpha.git"
        beta_bare = root / "ssot" / "beta.git"
        alpha_work = root / "work" / "alpha"
        beta_work = root / "work" / "beta"
        branch = "main"
        run(["git", "init", "-q", "--bare", str(vault)])
        run(["git", "init", "-q", "--bare", str(alpha_bare)])
        run(["git", "init", "-q", "--bare", str(beta_bare)])
        init_work_repo(alpha_work, branch, "alpha")
        init_work_repo(beta_work, branch, "beta")
        push_work_to_bare(alpha_work, alpha_bare, branch)
        push_work_to_bare(beta_work, beta_bare, branch)
        proof("P01", "local working clones can update repo-specific bare SSOT repos by normal git push", [str(alpha_bare), str(beta_bare)])
        manifest = root / "manifest.json"
        manifest.write_text(json.dumps({
            "targetForgeRepo": {"sshUrl": str(vault)},
            "repos": [
                {"repoId": "alpha", "sourceBarePath": str(alpha_bare)},
                {"repoId": "beta", "sourceBarePath": str(beta_bare)},
            ],
        }, indent=2), encoding="utf-8")

        class Args:
            pass

        backup = Args()
        backup.manifest = str(manifest)
        backup.remote = None
        backup.branch = None
        backup.force = False
        backup.dry_run = False
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_backup_all(backup)
        proof("P02", "backup-all reads manifest sourceBarePath and backs up repo-specific bare SSOT repos", [str(manifest)])

        vault_alpha_ref = namespaced_head("alpha", branch)
        vault_beta_ref = namespaced_head("beta", branch)
        if not one_remote_hash(str(vault), vault_alpha_ref) or not one_remote_hash(str(vault), vault_beta_ref):
            raise VaultError("namespaced vault refs missing after backup-all")
        proof("P03", "repoId and branch map to refs/heads/repos/<repoId>/<branch>", [vault_alpha_ref, vault_beta_ref])

        audit = Args()
        audit.manifest = str(manifest)
        audit.remote = None
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_audit(audit)
        proof("P04", "audit sees expected repoId namespaces in the single forge backup", ["audit"])

        verify = Args()
        verify.manifest = str(manifest)
        verify.remote = None
        verify.repo_id = "alpha"
        verify.branch = branch
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_verify_one(verify)
        proof("P05", "verify-one compares source bare hash with forge backup hash", ["verify-one alpha/main"])

        inventory = Args()
        inventory.manifest = str(manifest)
        inventory.out_dir = str(root / "inventory")
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_inventory(inventory)
        if not (root / "inventory" / "bare-inventory.tsv").is_file():
            raise VaultError("inventory did not write bare-inventory.tsv")
        proof("P06", "inventory emits machine-readable bare SSOT rows", [str(root / "inventory" / "bare-inventory.tsv")])

        staging = root / "staging" / "alpha.git"
        restore = Args()
        restore.manifest = str(manifest)
        restore.remote = None
        restore.repo_id = "alpha"
        restore.branch = branch
        restore.staging_bare = str(staging)
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_restore_bare_one(restore)
        proof("P07", "restore-bare-one restores exact repoId/branch into staging bare", [str(staging)])

        restore_missing = Args()
        restore_missing.manifest = str(manifest)
        restore_missing.remote = None
        restore_missing.repo_id = "alpha"
        restore_missing.branch = "missing"
        restore_missing.staging_bare = str(root / "staging" / "missing.git")
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                cmd_restore_bare_one(restore_missing)
            raise VaultError("missing branch restore unexpectedly passed")
        except VaultError as exc:
            if "missing vault branch" not in str(exc):
                raise
        proof("P08", "missing branch restore fails instead of falling back to main", ["restore-bare-one alpha/missing"])

        promoted = root / "promoted" / "alpha.git"
        promote = Args()
        promote.repo_id = "alpha"
        promote.staging_bare = str(staging)
        promote.target_bare = str(promoted)
        promote.confirm = True
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_promote_staging_bare(promote)

        promoted_hash = one_remote_hash(str(promoted), "refs/heads/main")
        alpha_hash = one_remote_hash(str(alpha_bare), "refs/heads/main")
        if promoted_hash != alpha_hash:
            raise VaultError("promoted bare hash differs from source bare")
        proof("P09", "promote-staging-bare updates target bare only after --confirm", [str(promoted)])

        old_manifest = root / "old-working-clone-manifest.json"
        old_manifest.write_text(json.dumps({
            "targetForgeRepo": {"sshUrl": str(vault)},
            "repos": [{"repoId": "old", "localPath": "work/old"}],
        }, indent=2), encoding="utf-8")
        old_inventory = Args()
        old_inventory.manifest = str(old_manifest)
        old_inventory.out_dir = str(root / "old-inventory")
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                cmd_inventory(old_inventory)
            raise VaultError("manifest without sourceBarePath unexpectedly passed")
        except VaultError as exc:
            if "sourceBarePath" not in str(exc):
                raise
        proof("P10", "local working clone paths are not accepted as canonical backup source", [str(old_manifest)])

        gamma_source = root / "ssot" / "gamma.git"
        gamma_other = root / "ssot" / "gamma-other.git"
        gamma_work = root / "work" / "gamma"
        gamma_other_work = root / "work" / "gamma-other"
        run(["git", "init", "-q", "--bare", str(gamma_source)])
        run(["git", "init", "-q", "--bare", str(gamma_other)])
        init_work_repo(gamma_work, branch, "gamma-source")
        init_work_repo(gamma_other_work, branch, "gamma-other")
        push_work_to_bare(gamma_work, gamma_source, branch)
        push_work_to_bare(gamma_other_work, gamma_other, branch)
        push_ref_to_vault(str(gamma_other), str(vault), "refs/heads/main", namespaced_head("gamma", "main"), force=True)
        try:
            push_source_ref_to_vault(str(gamma_source), str(vault), "gamma", "main", force=False, dry_run=False)
            raise VaultError("non-fast-forward backup unexpectedly passed")
        except VaultError as exc:
            if "command failed" not in str(exc):
                raise
        proof("P11", "default backup is no-force and rejects diverged forge refs", ["gamma/main"])

        print(json.dumps({
            "ok": True,
            "mode": "smoke-local",
            "root": str(root),
            "proofs": proofs,
        }, ensure_ascii=False, indent=2))
    finally:
        if os.environ.get("OPS_REFS_VAULT_KEEP_SMOKE") != "1":
            shutil.rmtree(root, ignore_errors=True)


def build_parser():
    parser = argparse.ArgumentParser(description="Back up repo-specific bare SSOT repos into one namespaced forge vault.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("backup-one")
    p.add_argument("--manifest", required=True)
    p.add_argument("--repo-id", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--remote")
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_backup_one)

    p = sub.add_parser("backup-all")
    p.add_argument("--manifest", required=True)
    p.add_argument("--remote")
    p.add_argument("--branch")
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_backup_all)

    p = sub.add_parser("restore-bare-one")
    p.add_argument("--manifest", required=True)
    p.add_argument("--repo-id", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--staging-bare", required=True)
    p.add_argument("--remote")
    p.set_defaults(func=cmd_restore_bare_one)

    p = sub.add_parser("promote-staging-bare")
    p.add_argument("--repo-id", required=True)
    p.add_argument("--staging-bare", required=True)
    p.add_argument("--target-bare", required=True)
    p.add_argument("--confirm", action="store_true")
    p.set_defaults(func=cmd_promote_staging_bare)

    p = sub.add_parser("audit")
    p.add_argument("--manifest", required=True)
    p.add_argument("--remote")
    p.set_defaults(func=cmd_audit)

    p = sub.add_parser("verify-one")
    p.add_argument("--manifest", required=True)
    p.add_argument("--repo-id", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--remote")
    p.set_defaults(func=cmd_verify_one)

    p = sub.add_parser("inventory")
    p.add_argument("--manifest", required=True)
    p.add_argument("--out-dir", required=True)
    p.set_defaults(func=cmd_inventory)

    p = sub.add_parser("smoke-local")
    p.set_defaults(func=cmd_smoke_local)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except VaultError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
