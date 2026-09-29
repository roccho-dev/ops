# Lane D: one exact artifact, six non-authority concern hypotheses

Refs: ops#449 / #453. Reuses `jev-review/{review,rank,jev,core}.mjs` and
`design/lint.mjs` structural observations. No second HTTP client, portfolio state,
CI gate, score threshold, automatic correction or accepted-meaning owner.

The bootstrap's mandatory caller-written Design projection is intentionally removed:
an Issue need not be rewritten into a successful-looking Design before its omissions
can be examined. Existing Design lint and its unit/edge/pair API remain unchanged.

## Exact input and claim boundary

Every input has exactly `kind`, `sourceRef`, `revision`, `scope`, `content`,
`contentSha256`, `topK`. `contentSha256` is `sha256:` plus SHA-256 of the UTF-8 content
string; `topK` is an explicit integer 0–6. All content bytes go into the model state;
no summary, truncation, link traversal or inferred missing context is substituted.

| Kind | Required scope | Content |
|---|---|---|
| issue | `issue:title+body` | JSON text containing exactly the captured title/body; body may be null. |
| pr | `pr:title+body+baseSha+headSha` | JSON text with exactly these four captured fields; full 40-hex SHAs, revision = headSha. |
| contract | `contract:full-text` | Entire selected contract text, including empty text. |
| design | `design:full-json` | Entire Design JSON text; existing structural observations are retained separately. |

Issue comments, PR code/diff/reviews, linked artifacts and omitted context are **not**
in those Issue/PR scopes. Do not claim whole-Issue or implementation coverage. Source
ref and revision are retained provenance assertions, not source authentication.
A caller must capture/read back the actual source and retain the content digest;
a matching digest alone does not prove freshness or truthful provenance. For Issue
revision retain the observed updated_at; for repository files retain the exact commit.
Changed bytes with a stale digest are rejected before credential use. Missing body is
an observation, not a reason to fabricate a sufficient contract or declare a verdict.
Never submit secrets in source text. Source metadata and external comparison labels
are not sent to Jev; the complete explicitly scoped content is.

## Execution and evidence

```sh
node packages/repo-health/design/artifact-lint.test.mjs
node packages/repo-health/design/artifact-lint.mjs INPUT.json NEW_REPORT.jsonl
```

Ordinary `repo-health` checks import the offline tests through `design/test.mjs`.
They require no credentials or network. No workflow or CI selection is changed.
The one-shot CLI consumes `JEV_API_KEY` only through the existing authorized envs
boundary. It refuses inherited SOPS decryption capability, uses the existing fixed
Jev endpoint/model/budgets/timeout, and does not provision credentials or retry.

The output is created exclusively (existing output is never overwritten) and contains
manifest, result and summary rows. The manifest binds runtime, implementation-file
digests, input-file digest, endpoint and requested model. It carries OPS_SHA when
supplied, without pretending that the environment variable authenticates code.
The result distinguishes source/input identity, identity-projection digest and byte
coverage over the declared scope, and semantic question coverage. Source authentication
is explicitly NOT_VERIFIED. It binds the complete source, exact request/validated response, question
contract, raw and ranked scores, usage, coverage and timing. `evidenceDigest` hashes
an object without its own evidenceDigest; the result envelope also binds the manifest.
CLI readback must check these digests and that the terminal summary is present.
A killed process may leave an incomplete append-only file: **never infer success**.

`execution.status=OBSERVED` means six questions returned validated answers, not that
any concern is true. An injected callback is always explicitly `mode=injected` with
unobservable HTTP count (`null`), never live Jev proof. `calls` counts validated
responses; `transportInvocations` counts callback invocations; live `httpRequests`
counts attempted requests, including a failed request. A timeout after send does not
prove that the remote provider did no work. Provider cost is unknown unless measured.

Disabled topK = UNKNOWN with zero evaluation. Budget exhaustion, missing key and
inherited decrypt capability = BLOCK. Other execution/provider failures = UNKNOWN.
Raw failure text and arbitrary HTTP bodies are not retained. Semantic comparison and
value remain UNKNOWN regardless of execution success. Authority/effect remain zero.
The six concern categories are a bounded search space, not exhaustive coverage;
ranked category scores are hypotheses, not localized diagnoses or forced edits.

## Preregistered contrast, not natural-case ground truth

`artifact-lint.cases.jsonl` has two neutral-ID, fixed Issue snapshots. Before any live
execution, the sole gold relation is: contradiction score for 02 should exceed 01.
01 is concise but internally sufficient; 02 changes the last sentence to give W
automatic acceptance despite explicitly reserving acceptance to P. Gold is stated
here, outside the input and request. Ties/reversals are recorded as such, not hidden
by a threshold or converted into an execution error. This one contrast does not
validate the other five categories, natural cases, real FP/FN or economic usefulness.

Each JSONL line is a complete CLI input. Extract each into its own input file and run
once into a distinct new report through the existing envs runner. Retain both exact
reports before comparing the raw `contradiction` scores. A partial/missing pair is
UNKNOWN, not a successful contrast or NO_EFFECT. No live result is bundled here.

Natural comparison needs an independently captured R observation **before** revealing
lint, exact later revision/readback and measured attention/usage. Implementation R
review of this PR is not automatically such a natural-case reference. No independent
natural comparison, usefulness or adoption claim has been established by offline tests.
Stop/continue and adoption remain P decisions; unavailable execution is an explicit
unresolved BLOCK, not W authority to declare the portfolio complete.
