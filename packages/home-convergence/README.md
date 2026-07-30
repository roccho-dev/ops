# home-convergence

`home-convergence` is the public, fail-closed receipt boundary for `roccho-dev/ops#93`.

It does not define desired state, package recipes, host identity, credentials, apply commands, rollback commands, or accepted architecture. It consumes sanitized evidence produced by an authorized private wrapper and emits `OPS_HOMELESS_CONVERGENCE_001` only when every required claim is bound to exact inputs and passes.

## Boundary

```text
merged envs ops requests
+ merged flakes identity
+ private-wrapper PASS projection
+ per-target private execution results
+ exact ops source audit
+ independent review
  -> home-convergence receipt validator
  -> OPS_HOMELESS_CONVERGENCE_001
```

The package never performs the private host effect. The private wrapper translates each exact `envs.opsRequestedState.v1` request into explicit `gosh` intents and target-native observation/rollback adapters. This package only validates the sanitized result projection.

## Required targets

Exactly these target classes are required:

```text
linux-vm-system-user
wsl-system
wsl-user
```

A target cannot pass without evidence for:

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

Generate the source audit from the exact checked-out Ops revision:

```text
home-convergence source-audit \
  --root packages/home-convergence \
  --ops-revision <40-hex-revision> \
  > source-audit.json
```

The audit checks the two public runtime files and fails if they introduce desired-state construction, product acquisition/build behavior, raw-secret schema fields, process execution, network access, filesystem mutation, or another unclassified effect.

`--details` emits the retained file digests and counter preimage. The summary digest is the public input.

## Receipt

```text
home-convergence receipt \
  --requests ops-requests.json \
  --wrapper private-wrapper-receipt.json \
  --results target-results.json \
  --source-audit source-audit.json \
  --review independent-review.json \
  --ops-revision <ops-sha> \
  --envs-revision <envs-sha> \
  --flakes-revision <flakes-sha> \
  --target-set-digest <sha256:...>
```

Successful stdout is one compact JSON object. Invalid or incomplete evidence is rejected on stderr with a stable error code.

## Public disclosure ceiling

Public inputs and output may contain only opaque target IDs, exact public revisions, self-digests, counters, statuses, and private evidence digests.

They must not contain:

```text
host names
private IP or domain values
user names
credential values
secret paths
private wrapper contents
customer identifiers
raw command lines containing private values
```

Unkeyed SHA-256 values prove deterministic identity and detect accidental or partial tampering. They are not signatures and do not prove the private evidence producer's identity. Private authority and independent review remain separate gates.

## Non-claims

A fixture PASS is not real target evidence. A merged PR is not `ops#93` completion. The Issue can close only after the exact merged inputs are used on all required target classes, the private evidence is retained, the public receipt is read back, and ADRS #269 accepts the terminal receipt.
