# Package Thread Schemas

目的は、`0/N -> thread` の依頼を短くし、thread に全行を埋めさせることです。

自然文ではなく、phase ごとの schema を渡します。行を増やせば task が増え、`status` を埋めるまで自己確認させられます。

## Common Rules

- `targetRevision` は毎回必須です。
- 古い target を見た場合は `REVIEW_TARGET_STALE` で fail です。
- `status` は `pass`、`fail`、`not-run`、`carried`、`blocked` のみ使います。
- final pass できるのは、必要行がすべて `pass` か、明示的に許可された `carried` の時だけです。
- `fail`、`not-run`、`blocked` は必ず `BLOCKERS.tsv` に行を作ります。
- prose は補足です。正本は TSV / JSON です。

## PLAN: TASK_QUEUE.tsv

```tsv
taskId	priority	owner	inputs	expectedOutput	doneCondition	status	evidence	nextAction
T001	P0	impl	<source/spec>	<artifact/file>	<measurable condition>	blocked|ready|done	<file/line/test>	<next>
```

## IMPL: SPEC_MATRIX.tsv

```tsv
specId	priority	requirement	inputType	outputType	testName	implEvidence	testEvidence	status	blockerId
S001	P0	<requirement>	<type>	<type>	<test/check>	<file>	<log>	pass|fail|blocked|not-run	<BLOCKER or empty>
```

## IMPL_RESULT.json

```json
{
  "schema": "cdp.implResult.v1",
  "targetRevision": "<package-aN>",
  "baseRev": "<source base rev>",
  "status": "ready|blocked",
  "artifacts": ["<exact artifact names>"],
  "specMatrix": "SPEC_MATRIX.tsv",
  "blockers": "BLOCKERS.tsv"
}
```

## REVIEW: REVIEW_GATE.tsv

```tsv
key	status	evidence	owner	nextAction
requirementsDefined	pass|fail|not-run	reviewed source/test/spec	review|impl|host	<next>
specTableComplete	pass|fail|not-run	reviewed source/test/spec	review|impl|host	<next>
testsMeasureSpecs	pass|fail|not-run	reviewed test evidence	review|impl|host	<next>
canonTddPriorityOrder	pass|fail|not-run	reviewed task/spec rows	review|impl|host	<next>
canonTddCycleEvidence	pass|fail|not-run	reviewed red/green/refactor evidence	review|impl|host	<next>
ciGateDefined	pass|fail|not-run	reviewed CI/check output	review|impl|host	<next>
implDidNotWeakenTests	pass|fail|not-run	diff/test comparison	review|impl|host	<next>
workerSourceReadbackValidated	pass|fail|not-run	exact source filename/hash/readback evidence	review|impl|host	<next>
readOnlySourceValidated	pass|fail|not-run	host or impl evidence	review|impl|host	<next>
nativePathChecksRunOrCarried	pass|fail|not-run	host or impl evidence	review|impl|host	<next>
updatedTargetHonored	pass|fail|not-run	targetRevision evidence	review|impl|host	<next>
```

## REVIEW: MERGE_COVERAGE.tsv

`spec.zip` の merge 完了性を担保する schema です。

```tsv
rowId	source	expectedInMerged	validationMethod	status	evidence	blockerId
MC001	input spec.zip	original package contract rows	compare file/list/hash	pass|fail|not-run	<evidence>	<BLOCKER or empty>
MC002	input blocker list	known blockers represented	fixed/carried/blocked table	pass|fail|not-run	<evidence>	<BLOCKER or empty>
MC003	impl result	result claims represented in merged zip	inspect result + zip	pass|fail|not-run	<evidence>	<BLOCKER or empty>
MC004	runtime requirements	required env/tools preserved	inspect spec/package metadata	pass|fail|not-run	<evidence>	<BLOCKER or empty>
MC005	package outputs	output names and guarantees explicit	inspect package contracts	pass|fail|not-run	<evidence>	<BLOCKER or empty>
MC006	tests/checks	merged checks measure spec rows	run or inspect checks	pass|fail|not-run	<evidence>	<BLOCKER or empty>
MC007	regressions	old required files not lost	diff/list comparison	pass|fail|not-run	<evidence>	<BLOCKER or empty>
```

行を増やして package ごとに見る場合:

```tsv
rowId	package	sourceExpectation	mergedExpectation	status	evidence	blockerId
PKG-cdp	cdp	<source expectation>	<merged output/check>	pass|fail|not-run	<evidence>	<BLOCKER or empty>
```

## BLOCKERS.tsv

```tsv
id	severity	owner	phase	summary	requiredResolution
B001	blocker|major|minor	impl|review|host|consult	plan|impl|review|host|merge|final	<short>	<required next action>
```

## HOST_VALIDATION.json

```json
{
  "schema": "cdp.hostValidation.v1",
  "targetRevision": "<package-aN>",
  "baseRev": "<rev>",
  "commands": [
    {
      "name": "<check name>",
      "command": "<command>",
      "rc": 0,
      "status": "pass|fail|not-run",
      "log": "<path or artifact>"
    }
  ],
  "status": "pass|fail",
  "blockers": ["<BLOCKER ids>"]
}
```

## RETRY_REQUEST.json

```json
{
  "schema": "cdp.retryRequest.v1",
  "targetRevision": "<package-aN>",
  "sendTo": "impl|review|host|consult",
  "reason": "<short reason>",
  "blockers": ["<BLOCKER ids>"],
  "requiredOutputs": ["<artifact names>"],
  "doneCondition": "<measurable condition>"
}
```

## TIMEOUT_RECORD.json

成果物が出ないまま待ち続けないための timeout record です。

```json
{
  "schema": "cdp.timeoutRecord.v1",
  "role": "impl|review",
  "targetRevision": "<package-aN>",
  "attempt": 1,
  "expectedArtifacts": ["<artifact names>"],
  "intervalMs": 600000,
  "timeoutMs": 1800000,
  "reason": "expected artifacts were not produced before timeout",
  "next": "retry-impl|review-prompt"
}
```

## MERGE_DECISION.tsv

```tsv
branch	baseRev	headRev	mergeOrder	status	evidence	blockerId
worker/a	<base>	<head>	1	pass|fail|blocked	<merge/test evidence>	<BLOCKER or empty>
```

## FINAL_REPORT.json

```json
{
  "schema": "cdp.finalReport.v1",
  "targetRevision": "<package-aN>",
  "status": "pass|fail",
  "acceptedArtifacts": ["<artifact names>"],
  "hostValidation": "HOST_VALIDATION.json",
  "reviewResult": "REVIEW_RESULT.json",
  "remainingBlockers": []
}
```
