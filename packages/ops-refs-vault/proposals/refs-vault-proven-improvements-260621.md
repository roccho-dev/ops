# refs-vault proven improvements proposal 260621

## Status

Proposal only. This file records already-discussed and locally-demonstrated improvements for `ops-refs-vault`.

This proposal does not modify `roccho-dev/refs` and does not treat refs as a worktree or source of authority. `refs` is a generated backup artifact only.

## Base observation

The available GitHub repository default branch is currently `proposal/v-o-follow-refs-backup-env-260621` at commit `f3dac8ae5f6e00c1039c0b5d0f5fcc2ed36b42ac`.

No `main`, `master`, or `repos/ops/main` branch was available through the GitHub connector at proposal creation time. Therefore this proposal is intentionally additive documentation only and should be reviewed as a proposed continuation from the current visible ops head, not as a claim of canonical merge.

## Final role declaration

| item | role | work target |
|---|---|---|
| `/home/nixos/repos/.bare/**/*.git` | data canonical / SSOT | operational update target |
| `roccho-dev/ops` | implementation canonical for `ops-refs-vault` | development and proposal target |
| `proposal/*` in ops | proposal and verification branches | merge into ops canonical after review |
| `/home/nixos/git/refs.git` | generated local backup artifact / local forge stand-in | not manually edited |
| `roccho-dev/refs` | generated remote forge backup artifact | not a worktree, not a proposal target, not SSOT |
| any other Git remote forge | replaceable destination for generated refs backup | URL substitution only |

## Accepted intent

The package backs up selected refs from repo-specific bare SSOT repositories to any Git remote forge.

Default scope is `refs/heads/*`, not all refs. The source of backup truth is the refs already present in the source bare repositories.

The repo identity must be derived from the bare placement path under the bare root filesystem schema. The identity must be stable, deterministic, and reversible enough for audit and restore operations.

Future expansion to wiki or issue data should be possible without putting GitHub API logic into `ops-refs-vault` itself. Wiki or issue data should enter as normal bare repositories or producer-generated bare repositories, then follow the same Git transport path.

## Demonstrated conclusions

| id | conclusion | proposal effect |
|---|---|---|
| P1 | local bare can stand in for any remote forge for backup/restore proof | keep Git-remote-only design |
| P2 | raw path plus branch concatenation can collide | introduce repo path codec |
| P3 | one-component reversible repo key prevents path/branch boundary collision | derive remote ref from encoded repo key |
| P4 | default heads-only is sufficient now while optional ref profiles remain possible | avoid Git namespace/default-all-refs overreach |
| P5 | repo-level atomic push avoids partial multi-ref adoption | add atomic where multi-ref operations exist |
| P6 | current orphan audit can miss unknown repo-key refs when it scans only manifest repo prefixes | scan managed remote root, then classify extras |
| P7 | current direct-child discovery is insufficient for filesystem-schema bare paths | add recursive discovery under bare root |
| P8 | remote-ahead can be adopted or discarded safely using staged candidate plus exact source/remote leases | replace generic force path with candidate resolution |
| P9 | restore must set/verify HEAD and run fsck to prove usability, not just OID equality | add restore integrity gate |

## Proposed implementation worktrees

All work must target `roccho-dev/ops`. No work should target `roccho-dev/refs`.

| order | proposal branch | purpose | dependency |
|---:|---|---|---|
| 1 | `proposal/refs-vault-path-identity-v1-260621` | recursive bare discovery, `repoPath`, `repoKey`, managed-root audit | none |
| 2 | `proposal/refs-vault-remote-candidate-v1-260621` | remote-ahead candidate staging, adopt/discard/defer, exact leases, atomic multi-ref update | path identity decision |
| 3 | `proposal/refs-vault-restore-integrity-v1-260621` | HEAD restore, full fsck, staging restore, clone usability proof | path identity decision |
| 4 | `proposal/refs-vault-integration-v1-260621` | integrate reviewed path identity, remote candidate, and restore integrity changes | review of 1-3 |

## Proposed behavior

### Normal backup

```text
nixos-vm bare SSOT -> selected refs -> encoded remote refs -> remote forge artifact
```

### Remote ahead

Remote ahead is a candidate, not authority.

```text
remote forge ref
  -> staged candidate
  -> classify relation against nixos-vm bare
  -> adopt / discard / defer
```

Adopt means:

```text
candidate remote OID -> nixos-vm bare, only if source OID still equals observed source OID
```

Discard means:

```text
nixos-vm bare OID -> remote forge ref, only if remote OID still equals observed remote OID
```

Diverged means direct adoption is forbidden; reconciliation must happen in an isolated worktree/staging path and then be promoted to nixos-vm bare by the normal approved path.

## Required source changes

| area | required change |
|---|---|
| discovery | replace direct-child `.git` discovery with recursive bare discovery under configured bare root |
| identity | add `repoPath` and encoded `repoKey` with explicit codec version |
| ref projection | keep default `heads` projector: `refs/heads/<repoKey>/<branch>` |
| optional refs | reserve future projector/profile boundary; do not enable by default |
| audit | scan the managed remote root and classify missing, mismatch, extra-known, extra-unknown |
| force | do not use generic `--force` for normal ahead resolution; require candidate and exact lease |
| restore | after restore, set or verify HEAD, run `git fsck --full`, and prove normal clone usability |
| docs | replace `full-ref verification` wording with `selected-ref verification` unless full-ref profile is explicitly enabled |

## Non-goals

| non-goal | reason |
|---|---|
| editing `roccho-dev/refs` | refs is generated artifact, not a worktree |
| GitHub issue API inside core | would break any-remote-forge design |
| default all-refs backup | current intent is selected heads-first backup |
| Git namespaces by default | useful future option but unnecessary for default heads projection |
| mirror push | can delete remote-only refs and is unsafe for this artifact repository |
| automatic remote-to-SSOT authority transfer | adoption requires explicit decision and exact source lease |

## Review gates

| gate | expected proof |
|---|---|
| path collision | `a.git` branch `b/main` and `a/b.git` branch `main` do not collide |
| path codec | spaces, unicode, `%`, `~`, hidden paths round-trip or fail closed |
| recursive discovery | nested `.git` bare repositories are discovered under bare root |
| unknown extra audit | remote refs outside expected repo keys are reported |
| remote ahead adopt | source advances to candidate only when observed source OID still matches |
| remote ahead discard | remote is reset to source only when observed remote OID still matches |
| source race | adoption fails if source changed after observation |
| remote race | discard fails if remote changed after observation |
| diverged | direct adoption is blocked and reconciliation is required |
| multi-ref atomic | stale one-ref condition rejects the whole repo-level update |
| restore integrity | staging restore passes OID check, HEAD check, fsck, and clone usability |

## Decision

Proceed with proposal work in `roccho-dev/ops` only. Treat `refs` as a generated artifact throughout.

The immediate next branch should be `proposal/refs-vault-path-identity-v1-260621`, because candidate records and restore proofs depend on stable `repoPath` / `repoKey` identity.
