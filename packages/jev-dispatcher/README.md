# Jev dispatcher reader

`policy-select.mjs` is the deterministic read stage for a future Jev dispatcher. It reads an exact ADRS Git commit, validates every `policy/control.jsonl` row and the graph, runs the SQL embedded in that commit's `AGENTS.md` in memory, and resolves the selected R's `requires` to exact blobs. It does not call Jev, dispatch agents, or grant GO.

```sh
node packages/jev-dispatcher/policy-select.mjs \
  --repo /work/repos/adrs-canonical \
  --commit <40-hex-ADRS-commit> \
  --r-id <actual-R-session-id> \
  --git-bin /root/.nix-profile/bin/git \
  --format compact
```

`compact` (the default) prints validation counts, selected line/ID/body hashes, SQL hash and required blob IDs. `selected` pretty-prints only the selected rows so a model can read long JSONL lines; required documents are read separately from the same pinned commit. Both are JSON on stdout; a failure exits nonzero. External `requires` objects need an explicit `--authority NAME=REPO` mapping and keep their own exact commit.

This command reads Git objects by commit and path; it does not read the checkout, create a database file, decide policy meaning, or replace an agent's own understanding. The caller must pin the Ops implementation commit and executable blob, compare output with an independent baseline, and separately gate any mutation or agent firing.

Node 22.5 or newer with `node:sqlite` is required. The OCI proof uses Node 24.19.0. Run the focused tests with `node --test packages/jev-dispatcher/test.mjs`.
