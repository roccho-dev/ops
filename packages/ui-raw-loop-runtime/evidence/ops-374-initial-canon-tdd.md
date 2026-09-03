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

This is the intended RED: the frozen semantic/local contract had no
implementation. No existing Node file, endpoint, external provider, Release,
or deployment was changed.

## Current phase state

```text
CANON_RED_OBSERVED
```
