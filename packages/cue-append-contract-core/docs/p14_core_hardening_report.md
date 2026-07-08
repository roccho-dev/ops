# P14 Core Hardening / No Degrade Report

## Goal

P14 hardens the P13 package split without adding new product scope.

The phase addresses these P13 residual risks:

- dot imports hiding dependencies
- oversized validate/artifacts packages
- P10 manual or timeout-oriented scale assertions
- weak physical append-only enforcement
- stale receipt risk

## Changes

- Split `internal/core/validate` into focused files:
  - types
  - ledger validation
  - index / semantic checks
  - fast row validation
  - synthetic ledger generation
  - IO / hashing
  - utility helpers
- Split `internal/core/artifacts` into focused files:
  - types / manifest model
  - artifact generation
  - JSON Schema generation
  - TypeScript accessor generation
  - manifest / diff
  - utility helpers
  - generated JSON Schema parity validation
- Removed dot imports from runtime packages.
- Added `internal/core/appendonly` and CLI command `append-only-check`.
- Updated P10 to validate the gzip ledger directly via Go logical text reader instead of a manual `gzip -dc` staging step.
- Added P14 architecture tests and proof script.

## Non-goals

P14 does not claim to solve truth, semantic drift, source trust, legal safety, PII/secret safety, market value, or business success.

## Completion criteria

- `go test ./...` passes.
- P0-P10 regression scripts pass.
- P14 script passes.
- no dot imports under `cmd` or `internal`.
- validate/artifacts implementation files remain below the P14 line limit.
- append-only rewrite is rejected.
- P10 is fully automated by script.

## Remaining work

- expand ports for admission, authority, receipt, lineage, and append-only storage
- reduce shell/Python assertion snippets where they are no longer useful
- add real DuckDB projection/read adapter only when projection reads require it
- implement true incremental validation beyond partition snapshot verification
