# Jev dispatcher

## R/W advisory query — implementation candidate, not D completion

This package is the implementation home for [ADRS #434](https://github.com/roccho-dev/adrs/issues/434).
The semantic proposal and adopted job/completion contract remain outside this package;
this README describes the provided implementation, not new policy authority.

**Current boundary:** the query core, installed CLI, audited-turn extraction,
same-sender reply packet and offline contract tests exist. Automatic reply delivery
and same-stage resume in the fixed OCI actor sessions are **not yet connected**.
`QUERY_PENDING` stops rather than pretending the query finished the work.
Real R/W use, independent live semantic evaluation, recovery/monitoring completion,
and total-cost improvement have not been proved by these unit tests.

### One entry, two callers

`nix build .#jev-dispatcher-query` provides `bin/jev-dispatcher-query`, the selected
Git reader and shared Jev client, and this README plus `artifact.jsonl` under
`share/jev-dispatcher`. `--help` returns the exact command contract.

R/W provide one `{id, type, question, criteria?}` request. `type` is `noul`,
`choice` (2–255 named string options), or `score` (2–10 string levels).
A trusted launcher, not the request, supplies the exact policy commit, job/version,
authenticated sender and source-record identity, and a current observation file.
The CLI's `--sender` flag is **not authentication**: direct CLI use is a trusted
supervisor interface, not a multi-tenant or untrusted-caller security boundary.

Required launcher flags are `--repo ABS --commit SHA --r-id ID --contract-id ID
--version VERSION --sender ID --source-record ID --observation ABS`.
The installed wrapper supplies an exact Git executable; source use also requires
`--git-bin ABS`. The request is one JSON value on stdin, never a shell command.

Authentication follows the existing envs `envctl auth exec` route. Point its
artifact input to `share/jev-dispatcher/artifact.jsonl`; the existing `jev-api`
binding injects `JEV_API_KEY` into the child only. This package creates no credential
or binding. Do not pass a key in flags, the question, observations or an actor message.

### Explicit selected-job configuration

The implementation accepts an optional `query` object on the single selected job.
This is an **unadopted contract extension** until approved through the existing ADRS
path; merely building/installing it or linking the proposal enables nothing.
Missing/disabled configuration holds with zero model calls. Existing R/W roles and
legacy jobs are unchanged.

The configuration declares `enabled: true`, `mode: advisory`, allowed `senders`,
`rule_ids`, `disclosure: selected-rules-and-observation`, a positive `timeout_ms`
(no more than 120000), `max_input_bytes` (no more than 1048576), `max_calls: 1`, and
`expected_model`. Each named rule must be active, selected by the existing reader,
and contain a nonempty `rule` text. This does not forward the whole private policy,
actor configuration, credentials or unrelated records to the model.

The launcher observation has `job`, `state_version`, `text`, `refs`, and an integer
`expires_at` in Unix milliseconds. It must match the job and remain unexpired.
The observation file is bounded and opened without following a final symlink.
References/hashes do not prove truth or an adoption decision: the existing source,
admission and current-state checks remain the caller's responsibility.

### Request, reply, and effect boundaries

An actor may end an audited turn with exactly one `D-QUERY: {JSON request}` line.
`queryTurn` accepts only an existing keyed CLEAN final, uses the actual session and
final-record identity, and rejects quoted/tool/foreign-command content. The
supervisor prepares its context through `prepareContext`, never from actor-supplied
policy or permission fields. `nextStage` returns `QUERY_PENDING`, with no stage
advance, when it sees this query. One invocation makes at most one provider request;
there is no retry. **Cross-process deduplication and at-most-once delivery remain
requirements of the existing transport, not claims made by an in-memory counter.**

The shared core calls the existing Jev client. Replies are `ANSWER`, `HOLD` or
`ERROR`, bound to request, job, sender, source record, policy/observation version and
implementation. They always have `authority: false` and `effect: false`.
`replyPacket` verifies this envelope and addresses `D-REPLY` only to the original
sender. It constructs a packet; it does not send or resume a session.
`consumeReply` validates an answer's binding and explicit adopt/reject/hold decision.
That record alone proves neither independent judgement nor subsequent work.

An answer does not become R's `ROUTE`, P's `GO`, a confidence threshold, or a work
launch. R retains instruction/acceptance ownership. Deterministic permissions,
STOP, effect-time state/version checks and independent review remain mandatory.
A valid return or refusal may be useful; always choosing HOLD is not economic success.

Exit 0 means an answer or help; exit 3 means hold; exit 2 means an input, authentication,
provider, timeout, response, model-identity or policy-read error. The CLI emits one
JSON line. No automatic retry or fallback model is hidden behind an error.

The response identifies the model and hashes the successful raw provider bytes.
A model name (including a mutable provider alias) does not pin unseen server weights.
Hashes/JSON receipts are not signatures or independent truth. The existing authorized
runner must retain raw evidence, verify actual use and record the exact configuration;
the core does not create a second durable ledger. Monetary cost is null when unknown,
not zero. Query elapsed time is not end-to-end work cost or human time.

### Completion evidence, not a completion flag

| ID | Required evidence | Supplied by this code / still required |
|---|---|---|
| K01 | Discoverable contract without conversation history | README/help; real cold-reader use still required |
| K02 | Installed entry used by real R and W | Installed CLI test; fixed actors and live binding still required |
| K03 | Request/sender/job/state/policy and answer/hold/error binding | Executable unit, CLI and tamper tests |
| K04 | Independent unseen natural cases and rule-meaning contrasts | Live, preregistered evaluation still required |
| K05 | Query cannot grant GO/ROUTE or fire work | No-effect core and QUERY_PENDING isolation tests |
| K06 | Answer use linked to actual work and independent observation | Reply/use binding and ablation tests; real delivery/use still required |
| K07 | Continuation, duplicate/crash recovery and P notification | Existing completion remains open; not invented by this CLI |
| K08 | Final source/contract/artifact and evidence identity | Digests and coverage checker; verify referenced bytes/reviews separately |
| K09 | Comparable quality, total work cost and owner involvement | Not measured; no unit test claims savings |
| K10 | Related changes require recheck/return | Expiry/version/model/binding rejection tests; live recovery still required |

`query.test.mjs` uses an injected provider and synthetic actor records. It does use
real Git objects, the actual selector/client validators, and the installed CLI when
`QUERY_BIN` is supplied. It is not live Jev or fixed R/W evidence.

`proof.mjs EXPECTED.json EVIDENCE.jsonl` checks K01–K10 reference coverage for one
explicit source/policy/implementation/artifact/surface/model binding. Missing,
duplicate, non-PASS, mock-only, stale or creator-self-reviewed records are incomplete.
Even structurally complete input yields only `READY_FOR_INDEPENDENT_REVIEW`, **never
D_COMPLETE**. It does not fetch evidence, authenticate reviewers, assign the blind
evaluator, certify expected behavior or grant adoption. Existing evidence records
can be projected to this input; do not maintain a new editable status ledger.

Keep query delivery, full OCI old-D replacement, adoption and economic usefulness
separate. All adopted completion duties must still be evidenced; neither a new
package output nor a single completed work item retires the old-D inventory.
A relevant policy, model, runtime or consumer change requires scoped revalidation;
reuse applicable exact evidence instead of declaring every previous result current.

## Existing exact reader and staged executor

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

A Node runtime that loads `node:sqlite` without extra flags is required. The OCI proof uses Node 24.19.0. Run the focused tests with `node --test packages/jev-dispatcher/test.mjs`.

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
