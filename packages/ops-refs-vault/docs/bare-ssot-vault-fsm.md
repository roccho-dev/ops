# bare SSOT backup FSM

```text
source-bares-observed
  -> managed-remote-observed
  -> reconciled
       equal | missing-remote | source-ahead
         -> backup-preflight-pass
         -> repo-atomic-push
         -> postflight-equal
       remote-ahead-candidate | remote-only-candidate
         -> candidate-staged
         -> adopt | discard | defer
       diverged-candidate
         -> isolated-reconcile-required
       legacy-extra | unknown-extra | observation-raced | unclassified
         -> operator-decision-required
```

## Invariants

- Source bare repositories are SSOT.
- The remote forge is a generated artifact and candidate store, never automatic authority.
- Audit is read-only.
- Normal backup accepts only `equal`, `missing-remote`, and `source-ahead`.
- A candidate is never adopted without staging integrity proof and source compare-and-swap.
- A remote candidate is never discarded without an exact remote lease.
- Diverged refs require isolated reconciliation.
- Restore targets staging first; promotion is a separate confirmed state.

## Success states

| operation | success |
|---|---|
| audit | all managed rows classify `equal` |
| backup | selected source refs equal remote refs after push |
| candidate adopt | source branch equals the staged candidate OID after exact source CAS |
| candidate discard | remote ref equals observed source OID after exact remote lease |
| restore | OID, HEAD, full fsck, and clone usability pass |
| promotion | confirmed atomic head push and target fsck pass |
