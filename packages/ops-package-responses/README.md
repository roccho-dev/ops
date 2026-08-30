# ops-package-responses

Executes every `roccho-dev/ops` package obligation from one exact gov release and
emits actual package receipts.

## Exact input directory

```text
<release-dir>/
├─ gov-release-manifest.json
├─ accepted-decision.json
├─ gov-engine-descriptor.json
├─ gov-nix-output-descriptor.json
├─ gov-release-readback-receipt.json
└─ gov-package-output/
   └─ package-obligations.jsonl
```

The governance source must resolve to the exact commit in
`gov-engine-descriptor.json`. A local carry passes `path:<repo>`; GitHub CI may
pass the exact content-addressed GitHub flake reference. No ambient lock-file
fallback is accepted.

The materialized `gov-package-output` tree must match the `narHash` in the exact
`govNixOutputDescriptor.v1`. Its descriptor and accepted decision must match the
release manifest, and the readback receipt must bind the same release digest.

## Execution

```text
ops-package-responses execute \
  --release-dir <release-dir> \
  --repo-root <ops-worktree> \
  --governance-source <path:exact-git-repo|github:roccho-dev/governance/<commit>> \
  --out-dir <receipt-dir>
```

For every package in the union of the ops inventory and exact obligations, the
command emits exactly one response and one receipt. Required tests execute as real
Nix checks. Their output paths are hashed with `nix hash path` and bound to the
release, obligation, clean ops commit/tree, exact package Git objects, and entrypoint
digests. The command refuses a dirty worktree and writes receipts outside the repo.

The final packet retains stdout and stderr as digest-bound files. A packet whose
execution log is missing or changed does not validate.

Missing obligation, package, path, entrypoint, required test, successful Nix output,
or receipt becomes `blocked` with a returned residual. It is never omitted or
converted to Green.

`validate` checks packet integrity. `validate --strict` additionally fails whenever
any package receipt is blocked.

## Package-owned governance fixture

`examples/governance-package-obligations-v1/` is the golden input for the
current Ops package universe. It contains all 123 package obligations from the
Governance merge train, with three selected package checks and 120 explicit
out-of-scope rows. The E2E test verifies the source inventory digests, replays the
real package entrypoint through a deterministic Nix adapter, and requires:

```text
123 responses + 123 receipts
3 pass + 120 out-of-scope
0 findings
organization-active = false
```

An explicit out-of-scope obligation does not require an implementation
entrypoint. Missing obligations, selected-package entrypoints, selected checks,
or evidence remain blocking.
