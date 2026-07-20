# gosh v0

`gosh` is a bin-first, shell-never local operation runtime. It reads append-only JSONL intent, reduces it deterministically in physical line order, builds an in-memory plan, resolves tools to validated absolute executables, runs them directly with `argv[]`, and appends bounded execution evidence.

This package implements the v0 scope owned by `roccho-dev/ops#82`. It is not a shell, workflow daemon, HQ endpoint, queue, admission gate, accepted ledger, or decision authority.

## Boundary

| Area | Owner in this package | Not owned here |
|---|---|---|
| core | strict event validation, LWW reduction, indexes, dependency plan, failure taxonomy | policy, admission, accepted meaning |
| ports | Nix output resolution and direct process execution | package-manager abstraction, remote execution |
| adapters | JSON CLI, JSONL append, filesystem effects, direct child processes | shell profiles, PATH discovery, PTY, services |
| evidence | `.gosh/result.jsonl`, bounded stdout/stderr, digests, per-stage status | HQ receipts or production authority |

`.gosh/events.jsonl` is local desired runtime intent. `.gosh/result.jsonl` is append-only evidence. Neither is accepted meaning. ADRS remains the accepted meaning path.

## Persistent layout

```text
.gosh/
  events.jsonl
  result.jsonl
  cache/
    snippets/<cache-key>/source/main.go
    snippets/<cache-key>/run[.exe]
```

Reduced state, resolved state, indexes, DAG, and plan are rebuilt in memory. `gosh init` does not create generated state files, a plan file, a lock file, daemon state, or the optional `.gosh/bin` facade.

## Commands

```text
gosh init

gosh tool require <id> --resolver nix --installable <ref> --program <relative-path>
gosh tool require <id> --resolver absolute --program-abs <absolute-path>
gosh tool remove <id>

gosh target upsert <id> --kind <kind> [--tool <id>] [--main <path>] [--args-json <array>] [--stages-json <array>]
gosh target delete <id>
gosh target input add|remove ...
gosh target output set|remove ...
gosh target env set|remove ...

gosh check upsert <id> --target <target> --tool <tool> --args-json <array>
gosh check delete <id>

gosh list tools|targets|checks
gosh plan <target-or-check>
gosh run <target-or-check>

gosh --go-bin <absolute-go> snippet build <source.go>
gosh --go-bin <absolute-go> snippet run <source.go> -- <args...>
```

Global options precede the command: `--root`, `--nix-bin`, `--go-bin`, and `--capture-limit`.

Machine output is one JSON object. Successful commands write stdout. Rejections write stderr and use exit `1`; CLI misuse uses exit `2`.

## Event contract

- one UTF-8 JSON object per line;
- physical line order is the LWW order;
- optional `rev` must increase when present but does not replace line order;
- unknown kinds, versions, fields, irrelevant known fields, malformed JSON, and invalid payloads fail before planning or execution;
- deletion is explicit;
- target input/output/environment members have stable IDs;
- an invalid latest row fails the whole read and never exposes an older value.

Supported v0 target kinds are `exec`, `go.binary`, `stdio.pipeline`, `native.ensure-dir`, `native.write-file`, and `native.hash-file`.

## Resolution and execution

The absolute backend validates an already absolute executable. It never uses `LookPath` or ambient PATH. The Nix backend requires an explicitly supplied absolute Nix binary, runs `nix build --no-link --print-out-paths`, requires exactly one output, joins the declared `programRel`, rejects path escape, and validates the final executable. Results record the concrete path, output root, binding fingerprint, and executable digest when readable.

Pipeline stages are structured data. `gosh` calls each absolute executable directly, preserves argv boundaries, connects stdout to stdin with OS pipes, drains stderr concurrently, records every stage, fails when any stage fails, applies timeouts through context cancellation, and records that only direct-child cleanup is claimed. The final stage may publish a declared file sink atomically after every stage succeeds. Capture is bounded while full byte counts and SHA-256 digests remain available.

Core contains no `sh -c`, `bash -c`, PowerShell command mode, `cmd /c`, shell grammar, or PATH lookup fallback. Tests include hostile-looking argv, binary streams, high-volume stderr, failed stages, cancellation, and failed-sink non-publication.

## Native operations

The v0 native set is intentionally small: ensure directory, verified atomic file write, and file hash. Paths are resolved explicitly against the requested root. Destructive remove/copy administration is absent until separately specified and proven.

## Snippets and promotion

A snippet is trusted arbitrary local Go code, not a sandbox. `gosh` requires an absolute Go executable, computes a cache key from source, wrapper version, Go identity, GOOS/GOARCH, build flags, and the explicit build environment, invokes `go build -o` directly, and atomically publishes only a successful executable. Failed builds cannot become cache hits. Build and run are separately visible in CLI output; runs are appended to result evidence.

Promotion is explicit:

```text
snippet -> repeated hash-cached bin -> named typed operation -> built-in operation
```

Frequency alone never promotes code or grants safety. A state-changing named operation requires a separate input/output/state contract, risk classification, tests, and Plan/Apply/Verify rules.

## Evidence and failure taxonomy

Run evidence includes input and plan digests, platform, architecture, resolved tool identities, absolute programs, argv arrays, explicit cwd, environment key names only, per-stage start/exit/duration/status, bounded stdout/stderr captures, full digests, sink paths, changed status, diagnostic code, and cleanup claim.

Stable statuses are `unchanged`, `changed`, `succeeded`, `skipped`, `failed`, `unsupported`, `blocked`, `requires_approval`, and `cancelled`. Current failures are grouped as validation/load, plan, resolution, execution, snippet build/run, append, and `audit_append_failed`. A successful operation whose evidence append fails is returned as failure; it cannot become a false audited success.

Environment values are not written to run evidence. Use secret references rather than secret values whenever possible. The CLI redacts environment values from mutation output.

## Platform claim

The repository checks execute the complete Go unit suite and Linux integration proof on the repository-supported Nix systems. Windows path normalization and executable eligibility are implemented, but Windows process-tree and pipeline behavior are not claimed as proven by this PR; the result cleanup field explicitly limits the claim to direct children.

## Checks

- Go tests cover positive and negative event fixtures, deterministic replay, tombstones, dependency planning, cycles, resolver ambiguity/escape, direct execution, argv integrity, binary pipelines, stderr draining, cancellation, sinks, audit failure, native operations, snippet cache/build/run, and static no-shell boundaries.
- `tests/e2e.mjs` exercises the installed binary through the repository package/check catalog.
- `nix flake check` builds the binary, runs `go test ./...`, and executes the installed-binary integration check.
