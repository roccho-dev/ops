# CDP Project Transport UX Proposal: todo-20260520-source-put-failure-classification

Status: proposal-only

This file documents exactly one proposal and one matching issue ledger record.
It does not implement code, approve merge, push, cleanup, or close the issue.

## 2. `todo-20260520-source-put-failure-classification`

Proposal: split `project-source-put` failures into precise classes.

- Problem: `source-upload-not-verified` hides whether URL shape, Project access, page load, or upload visibility failed.
- Change: emit `project-access-profile-missing`, `wrong-url-shape`, `source-page-not-loaded`, or `source-upload-not-visible`.
- Done when: result JSON contains failure class, target id, observed href, project URL shape, and next safe action.
- Risk: too many classes can become unstable. Keep classes tied to observable browser state only.
