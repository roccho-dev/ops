# shiftleft-admission

Language-neutral Shift Left admission for both Chat Pro local implementation and optional GitHub adoption.

```text
exact or local policy source
→ policyctl intake
→ local Python / JavaScript / Go workspace
→ policyctl run
→ native tests + evidence providers + package contract
→ local completion Receipt

optional formal adoption
→ policyctl verify-worktree
→ ops-git-write-closure
```

## Completion rule

> No local completion Receipt means the implementation is draft.

A `COMPLETE / PASS` Receipt is bound to the exact policy, intake source, task contract, toolchain, workspace base, and candidate content. Missing tools, skipped tests, unmet rules, policy tampering, or candidate drift never become complete.

## Local entry

### 1. Intake an accepted artifact

The extracted source directory contains `policyctl`, `policy/`, `adapters/`, and a sorted `SHA256SUMS`. `--source-sha256` is the SHA-256 of the exact manifest bytes.

```bash
./policyctl intake \
  --source-dir ./artifact \
  --source-kind actions-artifact \
  --source-id 123456789 \
  --source-sha256 sha256:<manifest-sha256> \
  --policy-ref <40-hex-commit> \
  --policy-sha256 sha256:<policy-hash> \
  --out-dir ./session
```

Formal source kinds are `actions-artifact`, `git-commit`, and `release`. They require an exact commit policy ref, expected policy hash, and verified manifest.

### 2. Run a local implementation

```bash
./session/bin/policyctl run \
  --session ./session \
  --workspace ./candidate \
  --contract ./task.json \
  --out-dir ./evidence
```

The task contract declares:

```text
task ID
language + provider profile
changed source scope
Package in / parsed-in / out / error / effect
one golden route + negative routes
current consumer
native test argv
```

Outputs:

```text
observations.jsonl
tests.json
diagnostics/*
completion-receipt.json
```

The same command and Receipt schema apply to non-Git directories and arbitrary Git worktrees. Git worktrees use actual HEAD/candidate Git trees; plain directories use a deterministic `sha256-tree` identity.

## Local policy experiment

A policy may be changed and tested without updating GitHub:

```bash
policyctl intake \
  --source-dir ./local-policy-source \
  --source-kind local-experiment \
  --out-dir ./local-session
```

The Receipt uses `local-policy-sha256:<hash>`. This is valid for local completion but is intentionally rejected by `policyctl verify-worktree`; formal GitHub adoption requires a new exact Git policy identity.

## Evidence providers

| Provider | Observation | Current profiles |
|---|---|---|
| `language-import-provider` | Core does not import runtime/effect adapters | Go, JavaScript, Python |
| `diagnostic-process-provider` | Primary output separation and `diagnostic/1` conformance | JavaScript executable boundary |
| native test adapter | Declared golden and negative routes actually execute | Task-local Python / JavaScript / Go commands |
| package contract adapter | Parse boundary, in/out/error/effect, routes, current consumer | Language-neutral |

Native test runners remain native. Test commands are argv arrays, not shell strings. The common gate owns no language AST or runtime feature.

`diagnostic-process-provider` does not implement the `structured-diagnostic` runtime. It reads the exact contract, executes the target as a separate process, and externally observes stdout/stderr.

## Existing lower-level commands

```bash
policyctl hash --bundle policy
policyctl observe --bundle policy --fixtures fixtures --out observations.jsonl
policyctl admit --bundle policy --policy-ref <ref> --policy-sha256 <hash> \
  --base-tree <tree> --candidate-tree <tree> --observations observations.jsonl --out receipt.json
policyctl verify --receipt receipt.json --policy-sha256 <hash> \
  --base-tree <tree> --candidate-tree <tree>
policyctl verify-worktree --receipt receipt.json --policy-sha256 <hash> --repo <worktree>
policyctl proof ...
```

`verify-worktree` only accepts a formal exact-commit policy Receipt. It computes the actual HEAD/candidate trees with a temporary Git index and performs no worktree, ref, or network mutation.

## Boundaries

- This package owns policy intake, evidence normalization, four-state folding, local completion Receipts, and formal worktree Receipt verification.
- `structured-diagnostic` remains an independent runtime and does not depend on this package.
- #117 transports exact runtime/policy bytes into Chat Pro.
- #114 owns optional authenticated GitHub effects and authoritative readback.
- #115 owns durable Rule/Condition and Outcome Fact semantics.
- GitHub is not required for local implementation completion.
- No server, database, daemon, common AST, hidden global policy, or second policy engine is introduced.

## Proof

The integrated proofs cover:

- Python plain-directory implementation
- JavaScript arbitrary Git repository implementation
- formal artifact intake with exact manifest, runtime, policy, and artifact identity
- local policy experimentation without GitHub update
- byte-identical rerun for the same policy/candidate/toolchain/task
- artifact-only replay without repository checkout or source build
- tampered source, missing tool, missing test, unmet rule, and candidate drift fail closed
- existing language, diagnostic, package-contract, and #114 worktree admission proofs
