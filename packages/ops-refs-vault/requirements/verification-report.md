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
