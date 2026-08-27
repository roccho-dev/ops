# Intent evidence ownership

`atomic-intent-ledger.jsonl` is the only source of truth for the 57 observable atomic intents introduced by the 23-bundle merge. `internal-commit-coverage.jsonl` proves the eight non-HEAD commits. The three repository-owned head ledgers remain source evidence for all 53 historical supplied HEAD intents.

`project-release.mjs` deterministically projects every release report under `generated/`. It rejects blank owners, open or unproven intents, duplicate IDs, changed counts, incomplete commit coverage, and the loss of the legacy `smap-source.js` compatibility path. Generated files are never hand-edited.

```text
node verification/head-merge/project-release.mjs \
  --mobile ../mobile-agent \
  --ui ../ui \
  --ops . \
  --out verification/head-merge/generated

node verification/head-merge/project-release.mjs \
  --mobile ../mobile-agent \
  --ui ../ui \
  --ops . \
  --out verification/head-merge/generated \
  --check
```
