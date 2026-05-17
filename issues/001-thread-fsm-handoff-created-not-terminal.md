# Issue 001: `handoff-created` must not be terminal success

## Status

Known gap. `ops/packages/ops-thread-fsm/TODO.md` already records the failure mode and proposed states.

## ops responsibility

`ops-thread-fsm` owns ChatGPT/CDP workflow state classification, next-action rendering, review gate distinction, and merge-ready evidence checks.

It must not implement canonical merge, push, CDP transport, or artifact materialization.

## Problem

A planner can create handoff files and stop as if the work is done.

That is wrong. `handoff-created` only means the next owner has input material. It is not:

- merge thread started
- merge thread readback confirmed
- merge output materialized
- local gate passed
- merge-review sent
- merge-review pass
- merge-ready
- complete-approved

## Existing references

- `ops/packages/ops-thread-fsm/TODO.md`
- `specs/packages/ops-thread-fsm/default.nix`
- `specs/packages/ops-thread-fsm/fsm.yaml`
- `.agents/project-workspace.md`
- `.agents/review-merge.md`
- `.agents/authority-write-gate.md`

## Desired behavior

`ops-thread-fsm next` must fail closed:

| current evidence | next state |
|---|---|
| handoff files created only | `merge-request-required` or blocker with missing destination |
| handoff + known merge thread | `merge-request-required` / `merge-request-sent` |
| merge send confirmed | `merge-readback` |
| merge artifact materialized + local gate pass | `merge-review-request-required` |
| explicit `merge-review-pass` + RUN_REPORT + gate evidence | `merge-ready` |

## Acceptance criteria

- `handoff-created` never reports success.
- `planner-targets-ready + go-ahead + handoff-created` returns a next action, not completion.
- Missing merge thread yields a structured blocker with proposed thread name and handoff path.
- Known merge thread yields a send/start action.
- `merge-ready` requires merge output, local gate, explicit `merge-review-pass`, and RUN_REPORT.
- Generic `review-pass`, prose `passed`, or cross-gate pass tokens fail closed.

## Non-goals

- No canonical merge.
- No push.
- No CDP send/readback implementation.
- No artifact materialize implementation.
