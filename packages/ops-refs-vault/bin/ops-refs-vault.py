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
import urllib.parse
from pathlib import Path


DEFAULT_REMOTE = "git@github.com:roccho-dev/refs.git"
DEFAULT_REMOTE_NAME = "refs-vault"
REPO_ID_RE = re.compile(r"^(?!\.)(?!.*\.\.)(?!.*\.lock$)(?!.*@\{)[A-Za-z0-9._-]+$")


class VaultError(RuntimeError):
    pass


def run(cmd, cwd=None, check=True, capture=False, env=None):
    result = subprocess.run(
        cmd,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        env=env,
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


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def remote_from_manifest(manifest, override=None):
    if override:
        return override
    target = manifest.get("targetForgeRepo", {})
    return target.get("sshUrl") or target.get("httpsUrl") or DEFAULT_REMOTE


def manifest_repos(manifest):
    for repo in manifest.get("repos", []):
        repo_id = repo.get("repoId")
        if not repo_id:
            continue
        validate_repo_id(repo_id)
        yield repo_id, repo.get("localPath") or f"repos/{repo_id}", repo



def remote_host(remote):
    if not remote:
        return None
    remote = remote.strip()
    scp_like = re.match(r"^[^@:/]+@([^:/]+):", remote)
    if scp_like:
        return scp_like.group(1).lower()
    parsed = urllib.parse.urlparse(remote)
    if parsed.hostname:
        return parsed.hostname.lower()
    return None


def is_github_remote(remote):
    return remote_host(remote) == "github.com"


def is_github_ssh_remote(remote):
    remote = (remote or "").strip()
    return remote.startswith("git@github.com:") or (
        urllib.parse.urlparse(remote).scheme == "ssh"
        and remote_host(remote) == "github.com"
    )


def local_refspecs(repo_dir, repo_id, force=False, push_tags=False):
    validate_repo_id(repo_id)
    prefix = "+" if force else ""
    heads = run(["git", "for-each-ref", "--format=%(refname)", "refs/heads"], cwd=repo_dir, capture=True).stdout.splitlines()
    refspecs = []
    for ref in heads:
        if not ref.startswith("refs/heads/"):
            continue
        branch = ref[len("refs/heads/"):]
        if not branch:
            continue
        refspecs.append(f"{prefix}{ref}:refs/heads/repos/{repo_id}/{branch}")
    if push_tags:
        tags = run(["git", "for-each-ref", "--format=%(refname)", "refs/tags"], cwd=repo_dir, capture=True).stdout.splitlines()
        for ref in tags:
            if not ref.startswith("refs/tags/"):
                continue
            tag = ref[len("refs/tags/"):]
            if not tag:
                continue
            refspecs.append(f"{prefix}{ref}:refs/tags/repos/{repo_id}/{tag}")
    return refspecs


def egress_push_command(args, repo_dir, remote, refspec):
    cmd = [
        args.github_egress_command,
        "push-local",
        "--long-transfer",
        "--repo-dir",
        str(repo_dir),
        "--remote",
        remote,
        "--refspec",
        refspec,
        "--timeout",
        str(args.github_push_timeout),
        "--json",
    ]
    return cmd


def push_refspec(args, repo_dir, remote, refspec):
    if is_github_remote(remote):
        if not is_github_ssh_remote(remote):
            raise VaultError("GitHub push requires an SSH remote URL so ops-tailnet-github-egress can pin HostName and HostKeyAlias")
        cmd = egress_push_command(args, repo_dir, remote, refspec)
        return run(cmd, cwd=repo_dir, capture=True)
    return run(["git", "push", remote, refspec], cwd=repo_dir, capture=True)

def git_dir(repo_dir):
    result = run(["git", "rev-parse", "--git-dir"], cwd=repo_dir, capture=True)
    return result.stdout.strip()


def current_branch(repo_dir):
    result = run(["git", "branch", "--show-current"], cwd=repo_dir, capture=True)
    return result.stdout.strip()


def is_dirty(repo_dir):
    result = run(["git", "status", "--porcelain=v1"], cwd=repo_dir, capture=True)
    return bool(result.stdout.strip())


def local_head(repo_dir, ref="HEAD"):
    result = run(["git", "rev-parse", ref], cwd=repo_dir, capture=True)
    return result.stdout.strip()


def configure_remote(repo_dir, repo_id, remote_url, remote_name, force=False, push_tags=False):
    validate_repo_id(repo_id)
    git_dir(repo_dir)
    github_remote = is_github_remote(remote_url)
    if run(["git", "remote", "get-url", remote_name], cwd=repo_dir, check=False, capture=True).returncode == 0:
        run(["git", "remote", "set-url", remote_name, remote_url], cwd=repo_dir)
    else:
        run(["git", "remote", "add", remote_name, remote_url], cwd=repo_dir)

    run(["git", "config", "--unset-all", f"remote.{remote_name}.fetch"], cwd=repo_dir, check=False, capture=True)
    run(["git", "config", "--add", f"remote.{remote_name}.fetch", f"+refs/heads/repos/{repo_id}/*:refs/remotes/{remote_name}/*"], cwd=repo_dir)
    run(["git", "config", f"remote.{remote_name}.tagOpt", "--no-tags"], cwd=repo_dir)

    # Always remove stale direct push refspecs first. For GitHub remotes we do
    # not install new remote.<name>.push entries, because they create a plain
    # `git push <remote-name>` escape hatch around ops-tailnet-github-egress.
    run(["git", "config", "--unset-all", f"remote.{remote_name}.push"], cwd=repo_dir, check=False, capture=True)
    direct_push_refspecs = []
    if not github_remote:
        prefix = "+" if force else ""
        direct_push_refspecs.append(f"{prefix}refs/heads/*:refs/heads/repos/{repo_id}/*")
        if push_tags:
            direct_push_refspecs.append(f"{prefix}refs/tags/*:refs/tags/repos/{repo_id}/*")
        for refspec in direct_push_refspecs:
            run(["git", "config", "--add", f"remote.{remote_name}.push", refspec], cwd=repo_dir)

    return {
        "githubRemote": github_remote,
        "directPushConfigured": bool(direct_push_refspecs),
        "directPushRefspecs": direct_push_refspecs,
        "githubPushRule": "GitHub remotes must be pushed with ops-refs-vault push-all, which delegates to ops-tailnet-github-egress push-local --long-transfer",
    }


def cmd_adopt(args):
    repo_dir = Path(args.repo_dir).resolve()
    remote_config = configure_remote(repo_dir, args.repo_id, args.remote, args.remote_name, args.force, args.push_tags)
    print(json.dumps({
        "ok": True,
        "repoId": args.repo_id,
        "repoDir": str(repo_dir),
        "remoteName": args.remote_name,
        "remote": args.remote,
        "headNamespace": f"refs/heads/repos/{args.repo_id}/*",
        "tagNamespace": f"refs/tags/repos/{args.repo_id}/*",
        "pushTags": args.push_tags,
        "force": args.force,
        **remote_config,
    }, ensure_ascii=False, indent=2))


def cmd_push_all(args):
    manifest = load_manifest(args.manifest)
    remote = remote_from_manifest(manifest, args.remote)
    workspace = Path(args.workspace).resolve()
    github_remote = is_github_remote(remote)
    results = []
    for repo_id, local_path, _repo in manifest_repos(manifest):
        repo_dir = (workspace / local_path).resolve()
        item = {
            "repoId": repo_id,
            "localPath": local_path,
            "repoDir": str(repo_dir),
            "remote": remote,
            "githubRemote": github_remote,
            "pushMode": "egress-long-transfer" if github_remote else "direct-non-github",
        }
        if not repo_dir.exists():
            item.update(status="missing")
            results.append(item)
            continue
        try:
            git_dir(repo_dir)
            branch = current_branch(repo_dir)
            item["branch"] = branch
            item["head"] = local_head(repo_dir)
            item["dirty"] = is_dirty(repo_dir)
            refspecs = local_refspecs(repo_dir, repo_id, args.force, args.push_tags)
            item["refspecs"] = refspecs
            if args.clean_only and item["dirty"]:
                item["status"] = "blocked-dirty"
            elif not branch:
                item["status"] = "blocked-detached"
            elif not refspecs:
                item["status"] = "blocked-no-local-heads"
            elif args.dry_run:
                if github_remote:
                    item["egressCommands"] = [egress_push_command(args, repo_dir, remote, refspec) for refspec in refspecs]
                item["status"] = "dry-run"
            else:
                configure_remote(repo_dir, repo_id, remote, args.remote_name, args.force, args.push_tags)
                push_results = []
                for refspec in refspecs:
                    push = push_refspec(args, repo_dir, remote, refspec)
                    push_results.append({
                        "refspec": refspec,
                        "rc": push.returncode,
                        "stdout": (push.stdout or "").strip(),
                        "stderr": (push.stderr or "").strip(),
                    })
                item["pushResults"] = push_results
                item["status"] = "pushed"
        except Exception as exc:
            item.update(status="failed", error=str(exc))
        results.append(item)
    ok_statuses = {"pushed", "dry-run", "missing", "blocked-dirty", "blocked-detached", "blocked-no-local-heads"}
    print(json.dumps({
        "ok": all(r["status"] in ok_statuses for r in results),
        "remote": remote,
        "githubRemote": github_remote,
        "githubPushRule": "GitHub remotes are pushed only through ops-tailnet-github-egress push-local --long-transfer",
        "results": results,
    }, ensure_ascii=False, indent=2))


def exact_remote_ref(repo_id, branch):
    validate_repo_id(repo_id)
    if not branch or branch.startswith("/") or branch.endswith("/") or ".." in branch or "@{" in branch:
        raise VaultError(f"invalid branch: {branch}")
    return f"refs/heads/repos/{repo_id}/{branch}"


def cmd_materialize(args):
    manifest = load_manifest(args.manifest)
    remote = remote_from_manifest(manifest, args.remote)
    dest = Path(args.dest).resolve()
    remote_ref = exact_remote_ref(args.repo_id, args.branch)
    dest.mkdir(parents=True, exist_ok=True)
    if not (dest / ".git").exists():
        run(["git", "init", "-q", "-b", args.branch, str(dest)])
    if run(["git", "remote", "get-url", args.remote_name], cwd=dest, check=False, capture=True).returncode == 0:
        run(["git", "remote", "set-url", args.remote_name, remote], cwd=dest)
    else:
        run(["git", "remote", "add", args.remote_name, remote], cwd=dest)
    run(["git", "config", f"remote.{args.remote_name}.tagOpt", "--no-tags"], cwd=dest)

    fetch_dst = f"refs/remotes/{args.remote_name}/{args.branch}"
    fetch = run(["git", "fetch", "--no-tags", args.remote_name, f"+{remote_ref}:{fetch_dst}"], cwd=dest, check=False, capture=True)
    if fetch.returncode != 0:
        if not args.allow_any_branch:
            raise VaultError(f"missing remote branch: {remote_ref}")
        run(["git", "fetch", "--no-tags", args.remote_name, f"+refs/heads/repos/{args.repo_id}/*:refs/remotes/{args.remote_name}/*"], cwd=dest)
        first = run(["git", "for-each-ref", "--format=%(refname:short)", f"refs/remotes/{args.remote_name}"], cwd=dest, capture=True).stdout.splitlines()
        if not first:
            raise VaultError(f"no remote branches for repoId={args.repo_id}")
        fetch_dst = first[0]
        branch = fetch_dst.split("/", 1)[1] if "/" in fetch_dst else fetch_dst
    else:
        branch = args.branch

    run(["git", "checkout", "-q", "-B", branch, fetch_dst], cwd=dest)
    remote_config = configure_remote(dest, args.repo_id, remote, args.remote_name, False, False)
    print(json.dumps({
        "ok": True,
        "repoId": args.repo_id,
        "dest": str(dest),
        "branch": current_branch(dest),
        "head": local_head(dest),
        "remoteRef": remote_ref,
        **remote_config,
    }, ensure_ascii=False, indent=2))


def ls_remote(remote, pattern):
    result = run(["git", "ls-remote", remote, pattern], capture=True)
    rows = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        sha, ref = line.split("\t", 1)
        rows.append((sha, ref))
    return rows


def cmd_audit(args):
    manifest = load_manifest(args.manifest)
    remote = remote_from_manifest(manifest, args.remote)
    heads = ls_remote(remote, "refs/heads/repos/*")
    tags = ls_remote(remote, "refs/tags/repos/*")
    seen = {}
    for sha, ref in heads:
        mo = re.match(r"refs/heads/repos/([^/]+)/(.+)$", ref)
        if mo:
            seen.setdefault(mo.group(1), []).append({"branch": mo.group(2), "sha": sha})
    seen_tags = {}
    for sha, ref in tags:
        mo = re.match(r"refs/tags/repos/([^/]+)/(.+)$", ref)
        if mo:
            seen_tags.setdefault(mo.group(1), []).append({"tag": mo.group(2), "sha": sha})
    expected = [repo_id for repo_id, _local_path, _repo in manifest_repos(manifest)]
    print(json.dumps({
        "ok": not [r for r in expected if r not in seen],
        "expectedRepoCount": len(expected),
        "seenRepoCount": len(seen),
        "seenHeadCount": sum(len(v) for v in seen.values()),
        "seenTagRepoCount": len(seen_tags),
        "seenTagCount": sum(len(v) for v in seen_tags.values()),
        "missing": [r for r in expected if r not in seen],
        "extra": sorted(set(seen) - set(expected)),
    }, ensure_ascii=False, indent=2))


def cmd_verify_ref(args):
    remote_ref = exact_remote_ref(args.repo_id, args.branch)
    local_sha = local_head(args.repo_dir, args.local_ref)
    rows = ls_remote(args.remote, remote_ref)
    remote_sha = rows[0][0] if rows else None
    ok = local_sha == remote_sha
    print(json.dumps({"ok": ok, "local": local_sha, "remote": remote_sha, "remoteRef": remote_ref}, ensure_ascii=False, indent=2))
    if not ok:
        raise VaultError("local and remote hashes differ")


def write_tsv(path, rows, fields):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\t".join(fields) + "\n")
        for row in rows:
            fh.write("\t".join(str(row.get(f, "")) for f in fields) + "\n")


def cmd_inventory(args):
    manifest = load_manifest(args.manifest)
    workspace = Path(args.workspace).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for repo_id, local_path, _repo in manifest_repos(manifest):
        repo_dir = (workspace / local_path).resolve()
        row = {"repoId": repo_id, "localPath": local_path, "repoDir": str(repo_dir)}
        if not repo_dir.exists():
            row.update(status="missing")
        else:
            try:
                git_dir(repo_dir)
                row.update(status="git", branch=current_branch(repo_dir), head=local_head(repo_dir), dirty=is_dirty(repo_dir))
                if not row["branch"]:
                    row["status"] = "detached"
                elif row["dirty"]:
                    row["status"] = "dirty"
                else:
                    row["status"] = "clean"
            except Exception as exc:
                row.update(status="failed", error=str(exc))
        rows.append(row)
    fields = ["repoId", "localPath", "repoDir", "status", "branch", "head", "dirty", "error"]
    write_tsv(out_dir / "inventory.tsv", rows, fields)
    write_tsv(out_dir / "push-plan.tsv", rows, fields)
    print(json.dumps({"ok": True, "outDir": str(out_dir), "count": len(rows)}, ensure_ascii=False, indent=2))


def init_repo(path, branch, text):
    path.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q", "-b", branch, str(path)])
    run(["git", "config", "user.email", "ops-refs-vault@example.invalid"], cwd=path)
    run(["git", "config", "user.name", "ops-refs-vault"], cwd=path)
    (path / "README.md").write_text(text + "\n", encoding="utf-8")
    run(["git", "add", "README.md"], cwd=path)
    run(["git", "commit", "-q", "-m", "init"], cwd=path)
    run(["git", "tag", "v1"], cwd=path)


def cmd_smoke_local(_args):
    root = Path(tempfile.mkdtemp(prefix="ops-refs-vault-smoke-"))
    try:
        remote = root / "refs.git"
        run(["git", "init", "-q", "--bare", str(remote)])
        workspace = root / "workspace"
        alpha = workspace / "src" / "alpha"
        beta = workspace / "nested" / "beta"
        branch = "work/test"
        init_repo(alpha, branch, "alpha")
        init_repo(beta, branch, "beta")
        manifest = root / "manifest.json"
        manifest.write_text(json.dumps({
            "targetForgeRepo": {"sshUrl": str(remote)},
            "repos": [
                {"repoId": "alpha", "localPath": "src/alpha"},
                {"repoId": "beta", "localPath": "nested/beta"},
            ],
        }, indent=2), encoding="utf-8")

        for repo_id, repo_dir in [("alpha", alpha), ("beta", beta)]:
            configure_remote(repo_dir, repo_id, str(remote), DEFAULT_REMOTE_NAME, False, True)
            run(["git", "push", DEFAULT_REMOTE_NAME], cwd=repo_dir)

        expected = [
            f"refs/heads/repos/alpha/{branch}",
            f"refs/heads/repos/beta/{branch}",
            "refs/tags/repos/alpha/v1",
            "refs/tags/repos/beta/v1",
        ]
        remote_refs = {ref for _sha, ref in ls_remote(str(remote), "refs/*/repos/*")}
        missing = [ref for ref in expected if ref not in remote_refs]
        if missing:
            raise VaultError(f"missing smoke refs: {missing}")

        github_guard = root / "github-guard"
        init_repo(github_guard, branch, "github guard")
        github_config = configure_remote(github_guard, "github-guard", DEFAULT_REMOTE, DEFAULT_REMOTE_NAME, False, True)
        github_push = run(["git", "config", "--get-all", f"remote.{DEFAULT_REMOTE_NAME}.push"], cwd=github_guard, check=False, capture=True)
        if github_push.returncode == 0 or (github_push.stdout or "").strip():
            raise VaultError("GitHub remote unexpectedly has direct remote.<name>.push refspecs")
        if github_config.get("directPushConfigured"):
            raise VaultError("GitHub remote reported directPushConfigured=true")

        restore = root / "restore-alpha"
        class Args: pass
        mat = Args()
        mat.manifest = str(manifest)
        mat.remote = str(remote)
        mat.remote_name = DEFAULT_REMOTE_NAME
        mat.repo_id = "alpha"
        mat.dest = str(restore)
        mat.branch = branch
        mat.allow_any_branch = False
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_materialize(mat)
        if local_head(alpha) != local_head(restore):
            raise VaultError("restored alpha head differs")

        mat_missing = Args()
        mat_missing.manifest = str(manifest)
        mat_missing.remote = str(remote)
        mat_missing.remote_name = DEFAULT_REMOTE_NAME
        mat_missing.repo_id = "alpha"
        mat_missing.dest = str(root / "restore-missing")
        mat_missing.branch = "missing"
        mat_missing.allow_any_branch = False
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                cmd_materialize(mat_missing)
            raise VaultError("missing branch did not fail")
        except VaultError as exc:
            if "missing remote branch" not in str(exc):
                raise

        print(json.dumps({
            "ok": True,
            "root": str(root),
            "checked": expected,
            "githubDirectPushGuard": {
                "remote": DEFAULT_REMOTE,
                "directPushConfigured": False,
                "remotePushRefspecs": [],
            },
        }, ensure_ascii=False, indent=2))
    finally:
        if os.environ.get("OPS_REFS_VAULT_KEEP_SMOKE") != "1":
            shutil.rmtree(root, ignore_errors=True)


def build_parser():
    parser = argparse.ArgumentParser(description="Manage a single-remote multi-repo refs vault.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("adopt")
    p.add_argument("--repo-id", required=True)
    p.add_argument("--repo-dir", default=".")
    p.add_argument("--remote", default=os.environ.get("REFS_REMOTE_URL", DEFAULT_REMOTE))
    p.add_argument("--remote-name", default=os.environ.get("REFS_REMOTE_NAME", DEFAULT_REMOTE_NAME))
    p.add_argument("--force", action="store_true")
    p.add_argument("--push-tags", action="store_true")
    p.set_defaults(func=cmd_adopt)

    p = sub.add_parser("push-all")
    p.add_argument("--manifest", required=True)
    p.add_argument("--workspace", default=".")
    p.add_argument("--remote")
    p.add_argument("--remote-name", default=os.environ.get("REFS_REMOTE_NAME", DEFAULT_REMOTE_NAME))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--clean-only", action="store_true", default=True)
    p.add_argument("--force", action="store_true")
    p.add_argument("--push-tags", action="store_true")
    p.add_argument("--github-egress-command", default=os.environ.get("OPS_REFS_VAULT_GITHUB_EGRESS", "ops-tailnet-github-egress"))
    p.add_argument("--github-push-timeout", type=int, default=int(os.environ.get("OPS_REFS_VAULT_GITHUB_PUSH_TIMEOUT", "600")))
    p.set_defaults(func=cmd_push_all)

    p = sub.add_parser("materialize")
    p.add_argument("--manifest", required=True)
    p.add_argument("--repo-id", required=True)
    p.add_argument("--dest", required=True)
    p.add_argument("--branch", default="main")
    p.add_argument("--remote")
    p.add_argument("--remote-name", default=os.environ.get("REFS_REMOTE_NAME", DEFAULT_REMOTE_NAME))
    p.add_argument("--allow-any-branch", action="store_true")
    p.set_defaults(func=cmd_materialize)

    p = sub.add_parser("audit")
    p.add_argument("--manifest", required=True)
    p.add_argument("--remote")
    p.set_defaults(func=cmd_audit)

    p = sub.add_parser("verify-ref")
    p.add_argument("--repo-dir", required=True)
    p.add_argument("--remote", required=True)
    p.add_argument("--repo-id", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--local-ref", default="HEAD")
    p.set_defaults(func=cmd_verify_ref)

    p = sub.add_parser("inventory")
    p.add_argument("--manifest", required=True)
    p.add_argument("--workspace", default=".")
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
