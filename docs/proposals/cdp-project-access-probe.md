# CDP Project Transport UX Proposal: todo-20260520-cdp-project-access-probe

Status: proposal-only

This file documents exactly one proposal and one matching issue ledger record.
It does not implement code, approve merge, push, cleanup, or close the issue.

## 1. `todo-20260520-cdp-project-access-probe`

Proposal: make `project-transport-doctor` probe the target Project URL itself.

- Problem: `AUTH_SESSION_COOKIE_PRESENT` can be true while the requested Project redirects to `/auth/login`.
- Change: add a target Project URL probe and report three separate states: CDP reachable, generic ChatGPT auth, target Project access.
- Done when: inaccessible Project URLs become `project-access-profile-missing`, not a generic transport failure.
- Risk: if the probe opens too many tabs, target selection becomes noisy. Keep it to one pinned target and record target id.
