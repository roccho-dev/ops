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

## Staged OCI R/W proof

The first, completed R-only proof is in Ops commit `9c5ba2e6ef190cf7a7ef04aedcf7eb769e12d6ba` and ADRS PR #411. Its R found a copied blob-hash gate defect, so it is not a semantic pass.

`dispatcher.mjs --mode launch --step r-start|w-work|r-review --commit <ADRS-commit>` implements three separately authorized, read-only stages for the fixed OCI Opus R and W sessions. R first reads the same policy commit and may end with one exact `W-START` line or decline. Only that line allows a later W launch. W reads the commit itself and reports. A further launch gives W's final response to R as untrusted JSON; R rereads the commit and judges independently. `--mode check` only inspects policy and keyed provider records; it cannot launch. Each stage needs P's same-version GO after the previous stage's readback.

The dispatcher uses fixed stage prompts, carries identifiers and W response bytes, and does not judge policy meaning, call Jev, chain stages, or decide that W or R understood. A completed keyed turn is duplicate on repeat. Active, incomplete, and uncertain turns stop without retry. Initial concurrent launches and a crash before the provider records the key are outside this proof.

The dispatcher now checks the fixed Claude Code 2.1.280 turn metadata before treating a keyed final as complete or routing it to the next stage. A persisted tool output, tool error, foreign command, or incomplete Read coverage stops the stage; an unknown record shape or version stays unknown. The v9 OCI W persisted-output incident is the calibration case. This check cannot detect silent loss of Read lines inside otherwise consistent metadata, and it does not authorize a new task or launch.
