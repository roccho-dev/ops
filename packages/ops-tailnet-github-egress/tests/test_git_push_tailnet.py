#!/usr/bin/env python3
"""Offline tests for git-push-tailnet default resolution and safety."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path


SCRIPT = Path(os.environ.get("GIT_PUSH_TAILNET_SCRIPT", Path(__file__).resolve().parents[1] / "bin" / "git-push-tailnet"))


def run(cmd, cwd=None, check=True, env=None, timeout=20):
    result = subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, env=env, timeout=timeout)
    if check and result.returncode != 0:
        raise AssertionError(f"failed: {' '.join(map(str, cmd))}\nstdout={result.stdout}\nstderr={result.stderr}")
    return result


def init_repo(root: Path) -> Path:
    repo = root / "repo"
    repo.mkdir()
    run(["git", "init", "-q", "-b", "main", str(repo)])
    run(["git", "config", "user.email", "git-push-tailnet@example.invalid"], cwd=repo)
    run(["git", "config", "user.name", "git-push-tailnet"], cwd=repo)
    (repo / "README.md").write_text("ok\n", encoding="utf-8")
    run(["git", "add", "README.md"], cwd=repo)
    run(["git", "commit", "-q", "-m", "init"], cwd=repo)
    return repo


def json_run(repo: Path, *args: str, check=True):
    result = run(["python3", str(SCRIPT), "--repo-dir", str(repo), "--json", *args], check=check)
    return result, json.loads(result.stdout)


def test_default_origin_fetch_when_pushurl_disabled():
    with tempfile.TemporaryDirectory() as td:
        repo = init_repo(Path(td))
        run(["git", "remote", "add", "origin", "git@github.com:roccho-dev/flakes.git"], cwd=repo)
        run(["git", "remote", "set-url", "--push", "origin", "DISABLED-use-git-push-tailnet"], cwd=repo)
        result, data = json_run(repo, "--dry-run")
        assert result.returncode == 0
        assert data["remote"] == "git@github.com:roccho-dev/flakes.git"
        assert data["remoteSource"] == "origin-fetch-because-pushurl-disabled"
        assert data["refspec"] == "HEAD:refs/heads/main"
        assert "--long-transfer" in data["command"]


def test_refspec_and_refs_vault():
    with tempfile.TemporaryDirectory() as td:
        repo = init_repo(Path(td))
        result, data = json_run(repo, "--remote", "git@github.com:roccho-dev/flakes.git", "HEAD:refs/heads/topic", "--dry-run")
        assert result.returncode == 0
        assert data["dstRef"] == "refs/heads/topic"

        result, data = json_run(repo, "--remote", "git@github.com:roccho-dev/refs.git", "--refs-vault", "--repo-id", "flakes", "--branch", "topic", "--dry-run")
        assert result.returncode == 0
        assert data["dstRef"] == "refs/heads/repos/flakes/topic"


def test_non_github_and_detached_fail():
    with tempfile.TemporaryDirectory() as td:
        repo = init_repo(Path(td))
        result, data = json_run(repo, "--remote", "ssh://git@example.invalid/repo.git", "--dry-run", check=False)
        assert result.returncode != 0
        assert "non-GitHub" in data["error"]

        head = run(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
        run(["git", "checkout", "-q", "--detach", head], cwd=repo)
        result, data = json_run(repo, "--remote", "git@github.com:roccho-dev/flakes.git", "--dry-run", check=False)
        assert result.returncode != 0
        assert "detached HEAD" in data["error"]


if __name__ == "__main__":
    test_default_origin_fetch_when_pushurl_disabled()
    test_refspec_and_refs_vault()
    test_non_github_and_detached_fail()
    print("ok")
