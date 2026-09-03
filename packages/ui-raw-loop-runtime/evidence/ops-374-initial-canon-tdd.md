# ops#374 initial Canon TDD evidence

## Exact base

```text
roccho-dev/ops proposals@7da6dc51cd53bb807447f4db053f7b1d31a7f0db
```

## RED

The initial contract tests, published schema, package documentation, consumer
inventory, and explicit Nix check were committed before production Go files.

Observed locally with Go 1.23.2:

```text
go test ./...
exit: 1

undefined: Intent
undefined: Ledger
undefined: DecodeIntent
undefined: ErrInvalidIntent
```

This was the intended RED: the frozen semantic/local contract had no
implementation. No existing Node file, endpoint, external provider, Release,
or deployment was changed.

## GREEN

After adding only `intent.go` and `ledger.go`, the exact authored package file
set passed locally:

```text
go test ./...            PASS
go test -race ./...      PASS
go vet ./...             PASS
go test -count=20 ./...  PASS
```

The Green implementation closes only:

- closed `semantic.intent.v1` decoding;
- `event_id` as the sole idempotency identity;
- deterministic canonical SHA-256 digest;
- durable append-first authoring ledger;
- same-event no-change/conflict behavior;
- canonical/torn/corrupt ledger fail-closed behavior;
- concurrent writer row integrity;
- published-schema/runtime drift checks.

## Claim ceiling

```text
INITIAL_CORE_LOCAL_GREEN
```

Not yet proven here:

- exact PR-head `nix flake check`;
- Caddy/static-file/HTTP behavior;
- GitHub Issue/comment projection;
- Cloudflare, dist, Release, VM, or production effects.
