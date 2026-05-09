# App Connector local GitHub push

This note records the reusable local push path for GitHub operations that must
use the `tag:github` Tailscale App Connector.

## What this mode is

Run `git push` on the local WSL host.
Keep the remote URL as GitHub.
Let Tailscale route the GitHub IP through `tailscale0` to the App Connector.

Expected path:

```text
local WSL -> tailscale0 -> tag:github App Connector -> GitHub
```

This is not the relay mode:

```text
local WSL -> nixos-vm git remote -> GitHub
```

Relay mode can be useful, but it is not needed for the App Connector proof.

## Required gate

Before pushing, check that every resolved IPv4 address for `github.com` routes through
`tailscale0`. Do not validate only the first DNS answer. A single non-`tailscale0`
GitHub IPv4 is a route-gate failure.

```bash
ops-tailnet-github-egress route-check --domain github.com --json
```

The shell snippets follow the same rule. `github-route-check.sh github.com tailscale0`
prints every checked route and fails if any resolved IPv4 is outside `tailscale0`.
Long-transfer snippets call `github-route-check.sh github.com tailscale0 --print-selected-ip`
and pin SSH to one IPv4 that came from that all-IP gate.

If the route is not `tailscale0`, do not push. That would be a normal local
internet GitHub push, not an App Connector push.

## Stable SSH command

Use this exact SSH shape for GitHub Git operations:

```bash
export GIT_SSH_COMMAND='ssh -4 -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=1 -o StrictHostKeyChecking=accept-new -o KexAlgorithms=curve25519-sha256 -o HostKeyAlgorithms=ssh-ed25519'
```

The key part is `KexAlgorithms=curve25519-sha256`.
The default `sntrup761x25519-sha512` exchange stalled during the live proof.

## Reusable command

For normal proof refs:

```bash
ops-tailnet-github-egress push-local \
  --repo-dir /path/to/local/repo \
  --remote git@github.com:roccho-dev/refs.git \
  --refspec HEAD:refs/heads/repos/<repoId>/main \
  --json
```

The command performs the route gate first and then runs local `git push` with
the stable `GIT_SSH_COMMAND`.

For real repository heads or any non-tiny pack upload, use long-transfer mode:

```bash
ops-tailnet-github-egress push-local \
  --long-transfer \
  --timeout 600 \
  --repo-dir /path/to/local/repo \
  --remote git@github.com:roccho-dev/refs.git \
  --refspec HEAD:refs/heads/repos/<repoId>/main \
  --json
```

Long-transfer mode does four extra things:

- pins SSH `HostName` to the route-checked GitHub IPv4 and keeps `HostKeyAlias=github.com`
- forces IPv4 SSH with `-4` and the stable `curve25519-sha256` / `ssh-ed25519` algorithms
- temporarily sets `net.ipv4.tcp_mtu_probing=2` with `sudo -n`
- restores the previous `tcp_mtu_probing` value after the push
- uses longer SSH keepalive and `git push --progress`

This is required because the live App Connector route used `tailscale0` with
MTU 1280. Without TCP MTU probing, small commits could push, but real pack
uploads stalled after `Writing objects`.

## What is still forbidden

Do not use local `gh auth login`.
Do not use local `gh api`.
Do not mutate GitHub through the local GitHub API.
Do not run local GitHub push if the route gate fails.
Do not use local `gh auth login` or `gh api` to work around a failed route gate.

## When bundle is needed

Bundle is not part of this push mode.

Use a bundle only when the commit exists on one host but must be transported to
another host before Git can push it. If the local repo already has the commit,
use route-gated local `git push`.

## Restore from one remote repo

To restore one logical repo/branch from `roccho-dev/refs` into a fresh local
repo, fetch only that remote ref into the local branch you want:

```bash
github-restore-ref-app-connector-long.sh \
  /home/nixos/repos/restored/specs \
  git@github.com:roccho-dev/refs.git \
  refs/heads/refs-test/app-connector-local-push-reuse-20260507T203530Z/specs-ops-tailnet-github-egress-spec-96934b2 \
  task/ops-tailnet-github-egress-spec
```

This keeps the remote as one GitHub repo while restoring local repos separately.
Use one call per repoId/branch pair.

## Proof record

Live proof:

```text
/home/nixos/repos/cdp-ops-poc/app-connector-push-test-20260507T191701Z/RUN_REPORT.md
/home/nixos/repos/cdp-ops-poc/branch-name-proof-20260507T203530Z/RUN_REPORT.md
/home/nixos/repos/cdp-ops-poc/single-remote-restore-proof-20260507T234133Z/RUN_REPORT.md
```

The proof pushed:

```text
refs/heads/refs-test/app-connector-push-test-20260507T191701Z/local
```

and GitHub reported:

```text
116ff1e4d8603367d9d1883385ad1952fc525582 refs/heads/refs-test/app-connector-push-test-20260507T191701Z/local
```

The later long-transfer proof pushed the real task heads:

```text
704488731dfd8bcc860aae115ef5a4f6866f2e84 refs/heads/refs-test/app-connector-local-push-reuse-20260507T203530Z/specs-ops-tailnet-github-egress-spec-7044887
b83525e420f360240df182ad178c018ce544e327 refs/heads/refs-test/app-connector-local-push-reuse-20260507T203530Z/ops-ops-tailnet-github-egress-impl-b83525e
```

## Troubleshooting

See `docs/troubleshooting.md` for DNS retry, GitHub SSH exit code handling,
MTU/PMTU long-transfer mode, and the App Connector device egress loop case where
`accept-routes=false` was required.
