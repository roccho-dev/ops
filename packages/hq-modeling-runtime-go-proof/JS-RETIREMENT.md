# JavaScript retirement readiness

This document defines the evidence required before deleting `packages/hq-modeling-runtime` and making the Go implementation canonical.

Passing the current parity proof is necessary, but it is not sufficient for deletion. The proof currently covers the serialized `validate`, `work`, `receipts`, `projection`, `admit`, and `promote` CLI surface. It deliberately leaves the Node package canonical.

## Deletion-ready predicate

JavaScript may be deleted only when every term below is true:

```text
serialized JSON/JSONL is the accepted public boundary
AND every required test meaning has a Go owner
AND every runtime capability has a Go implementation or an explicit new owner
AND no production consumer imports or executes the Node package
AND the Go package is the registered, carryable runtime on every supported target
AND retained corpus and dual-run parity have no unexplained difference
AND a JavaScript-deletion branch passes repository admission
AND the last Node release and rollback path are read back successfully
```

A green unit or parity suite alone must not be interpreted as permission to delete JavaScript.

## Required closure

| Gate | Required evidence | Current state |
|---|---|---|
| 1. Public boundary | Record the decision that the supported API is serialized JSON/JSONL bytes. Arbitrary in-process JavaScript objects are not a compatibility surface. | **Open decision** |
| 2. Semantic ownership | Every one of the 154 inventoried behavior groups has a surviving owner. Port or re-home all 35 `deferred-outside-proof` groups. Retire the 24 JavaScript-object-only groups only after Gate 1. Replace the 8 Node-package topology groups with Go package-boundary checks. | **Incomplete** |
| 3. Runtime surface | Implement or re-home CUE append integration, local-root catalog/status, loopback/socket serving, CI receipts, GitHub JSONL readback, and staged-to-canonical promotion. | **Incomplete** |
| 4. Portable diagnostics | Preserve exit classes, stdout/stderr lanes, line identity, row order, and stable error codes. Normalize malformed-JSON evidence so parser wording cannot create runtime-specific identity. | **Partially proven** |
| 5. Package and carry | Register `hq-modeling-runtime` as a Go package, prove Nix builds for every supported architecture, publish immutable static binaries, verify SHA-256 readback, and execute with an empty `PATH`. | **Proof binary only** |
| 6. Consumer closure | Repository-wide search and execution evidence show no production import, subprocess call, package dependency, or documentation entry still requires the Node implementation. Validate editor, UI, source-evidence, reconcile, and governance consumers against the Go binary. | **Not yet proven** |
| 7. Dual-run closure | Run the retained fixture corpus and a predeclared production-like soak corpus through both runtimes. Require zero unexplained differences in status, lanes, JSON/JSONL meaning, order, and compatible digests. | **Fixture parity only** |
| 8. Destructive proof | On a dedicated branch, remove the Node package and Node-only checks, switch package registration, and run all repository, carry, CUE, consumer, and readback gates. No missing import or fallback to Node is allowed. | **Not started** |
| 9. Rollback | Preserve one immutable last-Node artifact and prove an exact registry rollback plus readback before deletion is merged. | **Not started** |

## JavaScript-only meanings

The Node tests cover Proxy traps, accessors, prototypes, non-enumerable properties, sparse arrays, shared references, cycles, and mutation-on-read. These concepts cannot cross a serialized JSON/JSONL byte boundary.

They therefore have two legitimate outcomes only:

1. the public boundary is explicitly narrowed to serialized bytes, and these meanings are retired with that decision; or
2. arbitrary JavaScript object input remains supported, in which case the Node implementation cannot be deleted merely because the Go CLI is green.

Silently dropping these meanings is not an accepted migration.

## Smallest safe sequence

1. Accept the serialized-byte boundary.
2. Implement or re-home the 35 deferred adapter meanings.
3. Add Go package-boundary checks for the 8 Node-package-only meanings.
4. Make malformed-input evidence portable.
5. Prove all consumers against the Go binary.
6. Register and carry the Go runtime on every supported target.
7. Complete a declared dual-run soak with no unexplained difference.
8. Produce one deletion-only commit and run the entire repository without the Node package.
9. Prove rollback from the immutable last-Node artifact.
10. Merge the deletion only after all preceding evidence is read back from GitHub.

Until all ten steps close, the correct statement is: **the Go replacement is increasingly complete, but JavaScript deletion is not yet proven safe**.
