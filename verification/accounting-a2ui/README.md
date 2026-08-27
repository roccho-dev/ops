# accounting-a2ui verification

OPS owns only exact input locks and deterministic artifact assembly. Accounting semantics, A2UI projection, component definitions, surface declarations, and browser rendering remain in UI.

The locked UI artifact is generated from the same separated `journal.jsonl` and `accounts.jsonl` used by the direct DOM oracle. Its surfaces select controls declaratively:

- `all-t-accounts`: `Column` + `Text` + `TAccountGrid`; no time-control instance.
- `bs-pl`: `Column` + `Text` + `FinancialStatements`; no time-control instance.
- `steps`: base-catalog `Button` instances.
- `range`: accounting-catalog `Range` instance.

Both control surfaces emit the same non-authority `view.setTime` action. The minimal surfaces omit control instances without deleting their catalog implementations.

The generic A2UI browser package contains no accounting component. The accounting catalog contains `FinancialStatements`, `Range`, `TAccount`, and `TAccountGrid`; the base catalog supplies `Button`, `Card`, `Column`, `Divider`, and `Text`. Semantic-map and accounting artifacts are locked to the same UI revision but retain independent tree digests.

Current completion boundary:

- UI directory artifact: locked by revision and SHA-256 tree digest.
- Official `@a2ui/web_core` package: required, but still pending exact package bytes and digest.
- Deployment and authority: outside this lock. The artifact manifest has `authority=false`.
