# ops-refs-vault local verification report

## Result

| gate | result |
|---|---:|
| final requirements | 60 |
| requirements fully exercised or statically proved here | 59 PASS |
| Nix check definition inspected but not executed | 1 |
| Node syntax checks | PASS, 3 files |
| Node tests | PASS, 19 / 19 |
| line coverage | 83.67% |
| branch coverage | 70.86% |
| function coverage | 91.30% |
| smoke proofs | PASS, P01-P15 |
| `--mirror` in core | absent |
| GitHub API dependency in core | absent |
| `git diff --check` | PASS |

Environment:

```text
node v22.16.0
git 2.47.3
nix unavailable
```

## Demonstrated behaviors

- recursive filesystem-schema bare discovery;
- versioned, reversible, non-colliding repo path projection;
- current, legacy, and unknown remote ref parsing;
- managed `refs/heads/*` full scan independent of manifest prefixes;
- full outer expected/observed reconciliation;
- equal, missing, source-ahead, remote-ahead, diverged, current-extra, legacy-extra, and unknown-extra states;
- read-only audit preserving injected legacy and unknown refs;
- preflight blocking before any partial multi-ref update;
- per-repository atomic push;
- generic force rejection;
- remote-only and remote-ahead candidate adopt/discard;
- exact remote lease race rejection;
- exact source compare-and-swap race rejection;
- diverged direct-adoption rejection;
- staged restore with OID, HEAD, full fsck, and clone-usability proof;
- confirmed atomic promotion.

## Deliberately not executed

| gate | reason |
|---|---|
| `nix build` / `nix flake check` | Nix executable is not installed in this execution environment. The flake gate was updated and inspected statically. |
| live GitHub/other-forge mutation | The core uses only Git transport. A local bare remote was used as a protocol-equivalent, non-destructive forge stand-in. Live mutation remains a separate integration gate. |

The local proof is sufficient to demonstrate implementation semantics without changing `roccho-dev/refs` or any other remote forge.
