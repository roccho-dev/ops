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
The one-shot CLI consumes an already-projected target-native `JEV_API_KEY`. It does
not start/wait for envs, dispatch an envs workflow, parent through envctl, obtain a
GitHub Environment source secret, or fall back to envs-old. This follows the current
`envs@4f240930db946124e70af4a43ee94bbb73b9f8ed/contracts/provider-consumer.jsonl`
normal consumer boundary, not the historical envs authenticated-runner description
still present in older ops experiment docs. It refuses inherited SOPS decryption
capability, uses the existing fixed Jev endpoint/model/budgets/timeout, and does not
provision credentials or retry.

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

`execution.status=OBSERVED` means the call returned validated answers (six in
category mode), not that any concern is true. An injected callback is always explicitly `mode=injected` with
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
once into a distinct new report where target-native auth is already provisioned. Retain both exact
reports before comparing the raw `contradiction` scores. A partial/missing pair is
UNKNOWN, not a successful contrast or NO_EFFECT. No live result is bundled here.

Natural comparison needs an independently captured R observation **before** revealing
lint, exact later revision/readback and measured attention/usage. Implementation R
review of this PR is not automatically such a natural-case reference. No independent
natural comparison, usefulness or adoption claim has been established by offline tests.
Stop/continue and adoption remain P decisions; unavailable execution is an explicit
unresolved BLOCK, not W authority to declare the portfolio complete.

## Retained observation: source capture succeeded, provider execution blocked

`artifact-lint.observed-block.jsonl` is the write-once three-row output of the real
CLI at ops `f3cc00394b46825c4435e3082e2ed8e327374111`, Node v22.16.0/Linux/x64.
This is **not a live Jev result**, not a natural-case quality comparison, and not a
fixture answer. The current process had no target-native JEV_API_KEY.

The source is the complete, public, exact-revision provider-consumer contract above.
It was fetched through GitHub and its 2,289 UTF-8 bytes independently matched Git blob
`ff7e7c7898191bd691dc645e2de2710d3961d5e5` before execution. Its content digest is
`sha256:d18800430e3672885b72c67157272aa0d40e67294cce5472601fa354ec78706a`.
The generic adapter still says NOT_VERIFIED: this external capture/readback is the
additional provenance observation, not a stronger guarantee added to every input.

Readback: all three object seals and manifest/result/summary links matched. Terminal
status = BLOCK / JEV_API_KEY_REQUIRED, validated calls = 0, HTTP attempts = 0,
evaluated questions = 0, semantic result = UNKNOWN. Raw error bodies and credentials
are absent. The report file SHA-256 is
`ea712d55b212ebc34c1df2065c1ffe075e8c3670816bbcf00db9389c5d40628c`.
The source input file can be reconstructed as `JSON.stringify(result.source) + '\n'`
from the result envelope. No provider response or usefulness score is inferred.

At that envs revision, dev authoring/projection are declared NOT_CONFIGURED and the
normal consumer path explicitly forbids source-secret and old-runner fallbacks.
Those repository declarations do not authenticate any external target's current
state. No permitted target credential/receipt was supplied to this execution. W did
not configure authoring, perform projection, dispatch envs or change that authority.

## Source-bound finding proposals: partial offline correction

Control `3ec15b2b473be9465fa32d94851c8ab09d1c62b9`; product-R review
`5365255667`; authority comment `5910294374`. This is a library-level binding and
scoring correction, not automatic discovery or v2 completion. No evaluation data
contract, root input, CLI option, candidate generator or provider response type is
introduced. The existing CLI still uses category mode and is NOT defect-level
completion evidence. ROOT_001/v3 remains consumed, NOT_COMPARABLE and retired; no
command shown here authorizes its retry or replaces its historical evidence.

`reviewSemanticArtifact(input, ask, proposals)` may receive explicit caller-produced
semantic hypotheses as its third method argument. They are not reference answers.
The original seven-field artifact input is unchanged; putting proposals/gold into
it is still rejected. No file, root history, oracle or other artifact is fetched.
The full artifact content remains the only state. The existing evaluator asks one
Noul question per unique proposal; its model, budgets, timeout and no-retry behavior
are unchanged. `ask` remains optional; offline tests supply it and never prove live
provider ability. Authoring or wiring proposals into a real evaluation is not done
by this correction and must respect the separately authorized input-only W boundary.

The method argument contains exactly `contentSha256` and `candidates` (0–6 entries).
Each candidate contains exactly `locations`, `defectKind`, `defect` and
`correctionEffect`. The last three are explicit, nonempty, well-formed text: what
kind of defect is proposed, the concrete concern, and the proposed corrective
outcome. Merely supplying these fields does not prove their truth or usefulness.
Locations contain 1–6 entries with `startByte`, `endByte`, `quote`: nonempty half-open
UTF-8 byte spans in the ORIGINAL `input.content` string, not decoded JSON fields.
For an omission, cite the existing supporting context rather than inventing missing
source bytes. Each quote must match the exact byte slice on character boundaries.
Stale content hashes, bad ranges/quotes, overlaps, extra fields, accessors, sparse
arrays and excessive entries are rejected before evaluation/credential use.

Locations are sorted and exact repeats removed. A proposal ID is SHA-256 over the
canonical ordered object: sourceRef, revision, contentSha256, scope, numeric locations
(startByte/endByte only), defectKind, correctionEffect. The plain sourceRef/revision
are not copied into the question. ID does not depend on score, topK, candidate order
or property order. Exact duplicate identities are evaluated once. Different concern
text under the same identity is a conflict, not silently selected or counted twice.
Different source identities or changed content have different IDs. Mechanical
identity is not semantic equivalence: paraphrased effects/kinds still need independent
reference matching/deduplication; the code does not pretend to solve that problem.

`findingEvidence` distinguishes UNAVAILABLE/CATEGORY_ONLY_OUTPUT (no proposals),
NOT_EVALUATED (explicit proposals without validated responses), and SCORED_PROPOSALS.
It retains normalized candidates and their digest BEFORE scoring; successful scoring
joins ranked answers back to those same candidates, with locations, kind, concern,
correction effect and ID. Response extras cannot invent or override a finding.
All candidates/raw scores are retained even when topK returns fewer; ties and zero
scores are not dropped by a hidden threshold. `findings:null`, an empty candidate
set, disabled execution, provider error or missing evidence never means no defects.
An empty candidate set is UNKNOWN/NO_FINDING_PROPOSALS with zero calls.

These are candidate findings, NOT verified defect/reference IDs or accepted
corrections. R must retain the original proposal ID plus output seal when linking
a later exact correction/check/readback; no correction is performed or certified
here. Recall, precision, severity, missed defects, cost and acceptance remain outside
this scorer. `comparison.status` stays UNKNOWN. No v2 metric or success is calculated
from the number of candidates, questions or scores.

LD01–LD09 retain the previous offline checks. LD10–LD16 add only development mocks
inside the existing test source: category non-promotion; four input kinds; UTF-8 and
tamper rejection; duplicate/conflicting identity; score/topK/order stability;
inflight mutation; empty/disabled/budget/error handling; rejection of root-input
extensions and provider-invented finding identities. These are not new prospective
cases, an oracle or a semantic-quality experiment.

Still unproved: source-only proposal discovery, proposal independence, live Jev
quality, independent defect matching, accepted corrections, review/rework savings,
full cost and 4/4 reproducibility. The current CLI cannot close that gap by receiving
a key. If a generator, new evaluation input surface or shared provider-output change
is needed, return that exact need to R/P; do not expand this bounded offline cut.
