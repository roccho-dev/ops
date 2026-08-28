# ADRS #322 / OPS #343 — semantic bundle evolution proof

This bounded proof closes the second progress axis of the accepted log-projected application kernel.

```text
same immutable event bytes
├─ semantic bundle v1 → surface v1
└─ semantic bundle v2 → surface v2

v1 → v2 → exact v1 replay → rollback to v1
```

## Reuse

The proof extends and imports the exact shared kernel at:

```text
verification/adrs-322-log-projected-application/src/kernel.mjs
```

The existing default bundle path remains backward-compatible. This child adds a validated bundle-parameterized projection path; it does not create a second event validator, current-state authority, or product repository.

## Physical boundary

```text
one candidate-scoped Worker + Static Assets
existing staging R2 bucket
candidate-scoped R2 prefix
  events/base.json                 immutable
  bundles/<digest>.json            immutable
  current.json                     mutable discovery pointer, non-authority
```

The Worker/static shell is deployed once. Only `current.json` changes during v1 → v2 → v1. The exact v1 surface remains replayable by bundle digest after v2 exists.

## Local proof

```text
node verification/adrs-322-semantic-bundle-evolution/local-proof.mjs /tmp/receipt.json
```

It proves at least:

- backward compatibility with the prior kernel digest;
- current-missing fail-closed behavior;
- v1 selection;
- v1 → v2 CAS;
- same event-state digest under both bundles;
- different surface/action projection under v2;
- exact v1 historical replay;
- stale writer and unadmitted bundle rejection;
- idempotent repeated selection;
- closed request shape rejecting a PII-shaped extra field;
- v2 → v1 rollback with exact original surface digest;
- byte-identical event preservation;
- events + immutable bundles + one non-authority pointer only;
- malformed/missing bundle rejection.

## Provider proof

The PR workflow:

1. runs the local proof;
2. writes the event and two bundles under immutable digest-bound R2 keys;
3. reads each object back byte-identically;
4. deploys one candidate-scoped Worker/static shell;
5. selects v1, then v2 with expected-current CAS;
6. proves v2 without Worker/static redeploy;
7. replays v1 by exact digest;
8. rejects stale and unadmitted selection;
9. rolls back to exact v1;
10. repeats the evolution and rollback in real Chromium;
11. emits one secret-free receipt.

## Claim ceiling

A PASS proves only that the same immutable event set can be reprojected through two exact semantic-bundle versions, while retaining exact historical replay and rollback without a Worker/static-shell redeploy.

It does not accept either fixture bundle as company meaning, prove arbitrary-domain generality, customer value, market demand, mail, payment, identity/consent, or production cutover.
