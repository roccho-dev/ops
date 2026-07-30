# home-convergence

`home-convergence` is the public, fail-closed receipt boundary for `roccho-dev/ops#93`.

It does not define desired state, package recipes, host identity, credentials, apply commands, rollback commands, or accepted architecture. It consumes sanitized, signed evidence and emits `OPS_HOMELESS_CONVERGENCE_001` only when every required claim is bound to exact accepted inputs.

## Boundary

```text
merged envs ops requests
+ signed request attestation
+ merged flakes identity
+ signed private-wrapper PASS projection
+ signed per-target execution results
+ signed exact Ops source audit
+ separately signed independent review
+ accepted execution/review authority digests
  -> home-convergence receipt validator
  -> OPS_HOMELESS_CONVERGENCE_001
```

The package never performs the private host effect. The private wrapper translates each exact `envs.opsRequestedState.v1` request into explicit existing `gosh` intents and target-native observation/rollback adapters. This package only verifies and projects sanitized evidence.

## Evidence authorities

Two distinct Ed25519 public authority records are required:

```text
execution-evidence
independent-review
```

Each record is self-digested as `ops.homeEvidenceAuthority.v1`. The expected record digests must come from the accepted authority source used by ADRS #269. Supplying an arbitrary public key and its matching digest is not sufficient for final admission; the emitted receipt retains both authority identities so ADRS can reject an unaccepted or superseded record.

The execution key signs:

```text
request attestation
private-wrapper receipt
source audit
all three target results
```

The review key must be different and signs a review bound to:

```text
exact Ops / Envs / Flakes revisions
target-set digest
request-attestation digest
wrapper digest
all three target-result identities
source-audit evidence digest
```

## Required targets

Exactly these target classes are required:

```text
linux-vm-system-user
wsl-system
wsl-user
```

A target cannot pass without signed evidence for:

```text
prepare
apply
native observe
expected-state match
second apply
second apply change_count = 0
bounded failure observed
rollback
post-rollback observe
post-rollback safe-state match
home reference count = 0
ambient PATH dependency count = 0
raw secret output count = 0
unclassified effect count = 0
```

Each result is bound to the exact Ops, Envs, and Flakes revisions, target-set digest, private-wrapper digest, pre-effect plan digest, and request identity.

## Source audit

Generate the unsigned deterministic audit from the exact checked-out Ops revision:

```text
home-convergence source-audit \
  --root packages/home-convergence \
  --ops-revision <40-hex-revision> \
  > source-audit.json
```

The audit hashes all four public runtime/audit files and scans the three execution-path files. It fails if they introduce desired-state construction, product acquisition/build behavior, raw-secret schema fields, process execution, network access, filesystem mutation, or another unclassified effect.

`--details` emits the file digests and counter preimage. The private execution authority signs the summary before receipt construction. The audit is a bounded static check, not a substitute for review of the exact Ops revision.

## Receipt

```text
home-convergence receipt \
  --requests ops-requests.json \
  --request-attestation request-attestation.json \
  --wrapper private-wrapper-receipt.json \
  --results target-results.json \
  --source-audit source-audit.json \
  --review independent-review.json \
  --execution-authority execution-authority.json \
  --execution-authority-digest <accepted-sha256:...> \
  --review-authority review-authority.json \
  --review-authority-digest <accepted-sha256:...> \
  --ops-revision <ops-sha> \
  --envs-revision <envs-sha> \
  --flakes-revision <flakes-sha> \
  --target-set-digest <sha256:...>
```

Successful stdout is one compact JSON object. Invalid signatures, unaccepted authority digests, same-key review, unrelated review, stale inputs, or incomplete evidence are rejected on stderr with a stable error code.

## Public disclosure ceiling

Public inputs and output may contain only public verification keys, opaque target IDs, exact public revisions, self-digests, signatures, counters, statuses, and private evidence digests.

They must not contain:

```text
host names
private IP or domain values
user names
private keys
credential values
secret paths
private wrapper contents
customer identifiers
raw command lines containing private values
```

SHA-256 supplies deterministic identity. Ed25519 signatures prove that the accepted key produced the exact envelope. Neither proves that the accepted authority was wisely selected, uncompromised, or still current; ADRS admission and independent review remain required.

## Non-claims

A fixture PASS is not real target evidence. A merged PR is not `ops#93` completion. The Issue can close only after exact merged inputs are used on all required target classes, private evidence is retained, accepted authority records are used, the public receipt is read back anonymously, and ADRS #269 accepts the terminal receipt.
