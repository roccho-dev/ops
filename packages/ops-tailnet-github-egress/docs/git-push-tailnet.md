# git push-tailnet

`git push-tailnet` is the human entrypoint for GitHub pushes that must use the
`tag:github` Tailscale App Connector.

Use it instead of teaching every operator the low-level command:

```bash
git push-tailnet
git push-tailnet HEAD:refs/heads/cdp-error-handling-todo
git push-tailnet --remote git@github.com:roccho-dev/flakes.git HEAD:refs/heads/cdp-error-handling-todo
git push-tailnet --refs-vault --repo-id flakes --branch cdp-error-handling-todo
```

## Responsibility split

`git-push-tailnet` is intentionally thin. It resolves:

- current Git repo root
- local ref, defaulting to `HEAD`
- remote URL, preferring `--remote`, then `tailnet-github`, then `origin` fetch URL
- destination ref, defaulting to the current branch
- refs-vault destination `refs/heads/repos/<repoId>/<branch>`

The actual GitHub push is delegated to:

```bash
ops-tailnet-github-egress push-local --long-transfer
```

`ops-tailnet-github-egress` owns the route gate, GitHub IPv4 resolution, stable
SSH command, long-transfer mode, temporary `tcp_mtu_probing`, restore, and
remote head verification.

## Safety rules

- Detached `HEAD` without an explicit refspec fails.
- Non-GitHub remotes fail.
- GitHub push always goes through the low-level route-gated command.
- Non-tiny push uses `--long-transfer` by default.
- After push, `push-local` verifies the destination with `git ls-remote`.
- `origin` pushurl values such as `DISABLED-use-git-push-tailnet` are treated as
  an accident-prevention sentinel; the wrapper uses the fetch URL or requires an
  explicit remote.

Do not make plain `git push origin` the normal GitHub path. Repos may disable
GitHub pushurl to prevent accidental non-gated pushes, but this package does not
rewrite existing repo remotes automatically.
