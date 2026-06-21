# ops-refs-vault verification report

## Result

| gate | result |
|---|---:|
| final requirements | 60 |
| requirements exercised or statically proved | 60 PASS |
| Node syntax checks | PASS |
| Node tests | PASS, 13 / 13 |
| smoke proofs | PASS, P01-P15 |
| Nix check | PASS, `nix build .#checks.x86_64-linux.ops-refs-vault --no-link --no-write-lock-file` |
| `--mirror` in CLI | absent |
| GitHub API dependency in core | absent |
| live GitHub refs read-only audit | PASS, stopped unsafe state |

## Demonstrated behaviors

- recursive filesystem-schema bare discovery;
- versioned, reversible, non-colliding repo path projection;
- current, legacy, and unknown remote ref parsing;
- managed `refs/heads/*` full scan independent of manifest prefixes;
- full outer expected/observed reconciliation;
- equal, missing, source-ahead, remote-ahead, diverged, current-extra, legacy-extra, and unknown-extra states;
- read-only audit preserving injected legacy and unknown refs;
- preflight blocking before unsafe backup writes;
- repo-level atomic multi-ref push;
- generic force rejection;
- remote-only and remote-ahead candidate planning;
- exact remote lease race rejection;
- exact source compare-and-swap race rejection;
- diverged direct-adoption rejection;
- staged restore with OID, HEAD, full fsck, and clone-usability proof;
- confirmed atomic promotion with target fsck.

## Live read-only audit

The repaired CLI was copied to the SSOT host under `/tmp/ops-refs-vault-fixed-260621` and run against:

```text
source: /home/nixos/repos/.bare
remote: git@github.com:roccho-dev/refs.git
```

Result:

| field | value |
|---|---:|
| exit code | 1 |
| ok | false |
| expected current-r1 refs | 274 |
| observed remote heads | 301 |
| missing current-r1 refs | 274 |
| legacy/extra remote refs | 301 |
| source failures | 0 |

Interpretation: current GitHub `refs` content is still the older flat layout relative to this proposal's `=r1-` projection. The repaired audit fails closed and does not mutate SSOT or the remote.

## Merge judgment

| requirement area | before this continuation | after this continuation | evidence |
|---|---|---|---|
| CLI integration | projection/reconcile libs existed but CLI still used prefix scans | CLI uses the shared projection/reconcile path for audit, verify, backup, restore, and candidate flows | `bin/ops-refs-vault.mjs` |
| managed-root scan | `orphan-audit` scanned manifest repo prefixes only | audit observes full `refs/heads/*` and classifies legacy/unknown extras | e2e managed-root extra test; live read-only audit |
| candidate states | remote-ahead/diverged handling was documented but not executable | candidate-plan/adopt/discard enforce classification and leases | e2e candidate tests |
| exact leases | generic force path remained exposed | normal backup rejects `--force`; adopt/discard require source and remote observed OIDs | e2e race tests |
| restore integrity | restore checked OID only | restore proves OID, HEAD, `git fsck --full`, and clone usability | e2e restore test |
| build gate | flake check only ran smoke-local | flake check runs syntax, unit, e2e, smoke, proof IDs, and no-mirror gate | `nix build .#checks.x86_64-linux.ops-refs-vault` |
| refs boundary | `refs` role was present but easy to confuse with proposal target | runbook says `roccho-dev/refs` is generated artifact and proposals belong in `roccho-dev/ops` | `docs/runbook.md` |

| residual risk | merge impact | required follow-up |
|---|---|---|
| GitHub `roccho-dev/refs` still contains older flat refs | normal backup will fail closed instead of publishing current-r1 refs | make an explicit migration/adopt/discard decision; do not auto-delete |
| SSOT main and GitHub main currently differ | merge target must be chosen explicitly | merge the proposal against the intended canonical main, then re-run check |
