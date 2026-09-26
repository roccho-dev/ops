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

`dispatcher.mjs --mode launch|check --step r-start|w-work|r-review --commit <ADRS-commit> --r-id <R-session> --contract-id <details-id> --version <row-version>` implements three separately authorized, read-only stages for the fixed OCI R and W sessions named by one job row. R first reads the same policy commit and may end with one exact `W-START` line or decline. Only that line allows a later W launch. W reads the commit itself and answers the job row's task question. A further launch gives W's final response to R as untrusted JSON; R rereads the commit and judges independently. `--mode check` only inspects policy and keyed provider records; it cannot launch. Each stage needs P's same-version GO after the previous stage's readback.

The job row is selected with the commit's AGENTS SQL for the given R. It must be an active `details` child of that R with the given id and version, and the only selected active row carrying `dispatcher`. It supplies `r_id`, `w_id` (an active `delegates` child of R with role `w`), `task{id,refs,w_question}`, `dispatcher{authority,commit,path,checkout}`, `adrs_read_checkout`, `ops_read_checkout` (equal to `dispatcher.checkout`), `uses_target_of` and a positive `limits.timeout_ms`. Only `cli`, `model`, `argv_template` and `cwd` are borrowed from `policy.jev.d-replacement.oci.v1`. The borrowed `cwd` must be `/work` and the dispatcher's `HOME` must be `/home/dev`, so that keyed provider transcripts are read from the project directory the session writes to. After the launcher, the borrowed argv may contain only `-p`, `--resume <session>`, `--model <model>`, `--permission-mode dontAsk`, `--tools Bash,Read`, `--allowedTools <generated list>`, `--setting-sources ""`, `--strict-mcp-config` and `--output-format json`, each exactly once; any other option stops. Only a scoped stage (below) replaces the `--tools` value at launch. Read paths are `AGENTS.md` plus the R's relative `requires`; external `requires` objects are rejected. The Read/Bash allowlist and the audited selector command are generated from the exact commit and the job row's clean detached checkouts, never from an older allowlist template.

For `task` rows the dispatcher uses fixed stage prompts plus the job row's task question, carries identifiers and W response bytes, and does not judge policy meaning, call Jev, chain stages, or decide that W or R understood. A completed keyed turn is duplicate on repeat. Active, incomplete, and uncertain turns stop without retry. A contract id@version launches at one policy commit only: a dispatcher-keyed record of the same id@version at another commit stops with `STOP_VERSION_USED`, while quoted text and other prompts are ignored. A keyed record whose second line starts with `CONTRACT: ` but does not parse stops with `STOP_MALFORMED_RECORD`; older keyed records with a different second line are ignored. A stage that exceeds `limits.timeout_ms` is `UNKNOWN` without retry, or `STOP_ACTIVE` if the session is still running. Initial concurrent launches and a crash before the provider records the key are outside this proof.

The dispatcher now checks the fixed Claude Code 2.1.280 turn metadata before treating a keyed final as complete or routing it to the next stage. A persisted tool output, tool error, foreign command, or incomplete Read coverage stops the stage; an unknown row/block type, tool-result shape, or CLI version stays unknown. The v9 OCI W persisted-output incident is the calibration case. Only same-configuration C4 keyed turns calibrate CLEAN; turns with other CLI attachments remain UNKNOWN_FORM. This check cannot detect silent loss of Read lines inside otherwise consistent metadata, and it does not authorize a new task or launch.

## Scoped jobs

A job row carries either the legacy `task` or `go_commands`, never both. A scoped row also names `objective` and `target{worktree,files}`. `go_commands` holds one `selector` with exactly one `<C>`, `policy_reads` equal to the read checkout plus `AGENTS.md` and the R's `requires`, and, for each stage `r_start`, `w`, `r_pre_publication` and `r_post_publication`, absolute `read[]`, optional `edit[]` and exact `bash[]` strings. The dispatcher substitutes only `<C>` and rejects any other placeholder. Tools and allowlists come only from these arrays: `Bash,Read`, plus `Edit` when the stage declares edits, replaces the template's `--tools` value; `oci.v1` supplies only the fixed runtime template. Edit paths must be declared target files and readable in the same stage.

The audit then admits the selector exactly once, each declared command, full page coverage of policy and stable reads, reads of edited files without coverage, and `Edit` only on declared paths with keys `file_path`, `old_string`, `new_string` and optional boolean `replace_all`. The Edit result shape (`filePath`, `oldString`, `newString` equal to the input) is an assumption pending calibration against a real CLI 2.1.280 keyed record; any other shape is `UNKNOWN_FORM`.

Each scoped keyed header records a dispatcher-computed snapshot of the worktree `HEAD` and declared-file blobs. Any changed path outside the declared files is `STOP_WORKTREE_CHANGED`; W starts only from the snapshot recorded by its triggering R stage, and an R stage must leave its recorded snapshot unchanged. Nothing is restored automatically.

Every scoped R final ends with exactly one value-free line `ROUTE: W`, `ROUTE: PUBLISH`, `ROUTE: P` or `ROUTE: TERMINAL`, outside any code fence; `r_start` may use only `W` or `P`, and `TERMINAL` is valid only after publication. `--step next` walks the keyed chain and launches at most one derived stage per invocation, with no internal loop. `PUBLISH` reports `PUBLISH_PENDING`: P publishes by hand and then invokes `next` to launch `r_post_publication`; `P` reports `RETURN_P`. No changed code runs in OCI. Initial concurrent launches and a crash before the provider records the key remain outside this proof.
