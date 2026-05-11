# TODO: implement merge request transition

## Background

The `specs-merge` session produced a valid merge-thread handoff for
`git-push-tailnet`, but stopped before starting the merge thread. The failure
mode was:

- planner declared the target ready,
- user approved `go ahead`,
- handoff files were created,
- no merge thread was started,
- the run ended as if handoff creation were enough.

This package should make that failure harder to repeat.

## TODOs

- Add first-class discussion-loop states for design/review handoffs:
  - `discussion-request-sent`
  - `discussion-send-confirmed`
  - `discussion-readback`
  - `discussion-objections-present`
  - `discussion-response-required`
  - `discussion-response-sent`
  - `discussion-no-objections-candidate`
  - `discussion-no-objections-confirmed`
  - `discussion-blocked-needs-parent`
- Implement `objections-present` behavior:
  - classify every objection as `accept`, `reject`, `modify`, or
    `needs-parent`,
  - continue with a response round for `accept`, `reject`, and `modify`,
  - stop and escalate for `needs-parent`,
  - never treat `discussion-started`, `discussion-readback`, or
    `discussion-objections-present` as completion.
- Add prompt/run fields for:
  - `discussionId`
  - `proposalRevision`
  - `counterpartyActor`
  - `requiredTopics`
  - `objectionClassificationRequired`
  - `nextRoundRequired`
  - `noObjectionsRequiredFrom`
  - `parentEscalationCondition`
- Require explicit `no-objections` from both sides on the same proposal
  revision before the discussion loop can complete.
- Add `merge` as a valid request kind.
- Add machine states matching the specs contract:
  - `planner-targets-ready`
  - `handoff-created`
  - `merge-request-required`
  - `merge-request-sent`
  - `merge-send-confirmed`
  - `merge-readback`
  - `merge-output-materialized`
  - `merge-local-gate-pass`
  - `merge-review-request-required`
  - `merge-review-request-sent`
  - `merge-review-readback`
  - `merge-ready`
- Change `next` behavior so `handoff-created` is not a completion state.
- Add plan evaluation fields for:
  - `plannerTargetsReady`
  - `goAheadApproved`
  - `handoffPath`
  - `mergeThreadKnown`
  - `mergeThreadName`
  - `mergeThreadSendConfirmationEvidence`
  - `mergeThreadReadbackEvidence`
- If `plannerTargetsReady` and `goAheadApproved` are true:
  - with a known merge thread, return the next action to send/start it,
  - without a known merge thread, return a real blocked state with the missing
    destination and a proposed default name.
- Keep canonical merge and push forbidden in this package.
- Keep CDP, artifact materialization, refs-vault, and local gate execution
  delegated to their existing packages.

## Proposed Code Locations

- State and permission tables:
  - `ops/packages/ops-thread-fsm/bin/ops-thread-fsm`
- Prompt rendering:
  - `ops/packages/ops-thread-fsm/bin/ops-thread-fsm`
- Tests:
  - `ops/packages/ops-thread-fsm/tests/test_ops_thread_fsm.py`
  - `ops/packages/ops-thread-fsm/tests/fixtures/cases.json`
- Package metadata:
  - `ops/packages/ops-thread-fsm/default.nix`

## Test Cases To Add

- `handoff-created` does not report success.
- `planner-targets-ready + go-ahead + known merge thread` returns
  `merge-request-required` or `merge-request-sent`.
- `planner-targets-ready + go-ahead + missing merge thread` returns a blocker
  with proposed thread name and handoff path.
- A run cannot become `merge-ready` without merge output, local gate, and
  explicit `merge-review-pass`.
- Generic `review-pass` text still fails closed.

## Non-goals

- Do not implement canonical merge.
- Do not implement push.
- Do not reimplement CDP send/readback.
- Do not reimplement artifact materialization.
- Do not turn this package into a general coding agent.
