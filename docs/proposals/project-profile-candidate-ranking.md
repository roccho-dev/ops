# CDP Project Transport UX Proposal: todo-20260520-project-profile-candidate-ranking

Status: proposal-only

This file documents exactly one proposal and one matching issue ledger record.
It does not implement code, approve merge, push, cleanup, or close the issue.

## 3. `todo-20260520-project-profile-candidate-ranking`

Proposal: rank candidate CDP ports/profiles by target Project access.

- Problem: the usable profile existed in proof history but was not surfaced by the tool.
- Change: let doctor/env accept candidate profile hints, probe each against the target Project URL, and return one recommended route.
- Done when: the tool produces a ranked list and one recommendation when possible.
- Risk: raw proof profiles must not become canonical assets. Store only pointer evidence and route status.
