# Lane C: whole-D shadow/replay (ops#449 / PR#452)

This is W's successor to bootstrap 453ec505d225b90440bb8610ffc0633fe2a151ff.
It addresses R's review comments 5889671817 and 5890456382. It is not an independent R review,
accepted policy, Jev adoption, or evidence that whole-D replacement works.
All merge/adoption/skip/effect/dispatch/refire/terminal/contract authority stays 0.

## Boundary and input

`whole-d-shadow.mjs` reuses `jev-review/{review,rank,jev,core}.mjs` unchanged.
`projectWholeDInput` accepts only `{policy, observation, candidates}`. Policy has `ref`,
`sha256`, `content`; observation has `ref`, `sha256`, `state`. Hashes bind exact
UTF-8 policy bytes and JSON.stringify(state) bytes, respectively. A hash proves
byte identity, not policy acceptance or observation authenticity. The external
reader must independently establish those properties before a natural run.

State has exactly generation, identity, refs, active, duplicates, effects,
readback and history. Generation/sequence are nonnegative integers. Identities
are actor/thread pairs; active/duplicates also carry generation. Refs contain
40-hex head/observedHead. Effects carry id/generation/status; readback carries
effectId/generation/status. History contains ordered seq/generation/event/
actor/thread/head observations, not D route output or free-text summaries.
Unknown fields, accessors and sparse arrays are rejected before a provider call.
The validated state is now copied without aliasing or normalization, and policy
content remains byte-identical. Concrete actor/thread/head/effect identities,
cross-field equality, and identity relations expressed in policy text therefore
survive in the supplied projection. Provenance labels and comparison-only
reference/readback are still excluded. This is lossless identity preservation,
NOT sanitization: policy, identity strings and candidate provenance all need an
external answer-leakage audit. Missing material context cannot be reconstructed
by this adapter; authenticity and semantic non-leakage are not claimed.

The eight decision kinds remain available, but 2..32 concrete alternatives are
supplied externally before comparison, never derived from the existing-D answer.
Each is exactly `{kind, target, interpretation}`; target is exactly actor/thread/
generation/head/effectId. The first four identify the receiving or affected turn
and its exact source head; effectId is null when no effect identity applies.
Route/return/escalation identify the destination; hold/refire/suppression/terminal
identify the affected work. Effect interpretation also requires an exact effectId
and one of applied/absent/unknown; other kinds use interpretation=null. These are
shadow descriptors, not executable commands or declarations of allowed targets.

Canonical field order gives each material decision a stable subject hash; duplicate
alternatives are rejected. Changing actor, thread, generation, head, effectId or
interpretation changes the comparison, even within one kind. Questions carry the
full target, and the selected decision retains it. candidatesSha256 binds the
ordered projected universe into result/reference pairing; stale or absent binding
is BLOCK before paid replay. Category-only v2 references are rejected by v3, not
silently upgraded. This changes only an unadopted experimental format, not accepted
policy. A reference target outside the universe stays a DIFFER, never an invented
candidate. Universe sufficiency, target authenticity and policy eligibility remain
external/semantic questions, not a second deterministic dispatcher.

Ranking is presentation, not selection by sort order. Scores below .75 or a top-two gap <= .1 abstain as
UNKNOWN, including ties. These are uncalibrated experimental cutoffs, not safety
probabilities or merge gates. No decision is connected to live operations.

## Replay and evidence

`whole-d-replay.mjs` consumes 1..8 JSONL rows with exactly id/input/reference.
Reference is comparison-only and contains kind (`observed-D` or
`preregistered-fixture`), policySha256, observationSha256, candidatesSha256, the
complete decision descriptor, and a
readback object with ref/sha256/content. It is validated before paid calls but
never passed to the model. Actual input/readback acquisition remains external;
caller-supplied hashes and references alone do not establish a natural proof.

The caller supplies OPS_SOURCE_HEAD (exact implementation SHA) and envs-managed
JEV_API_KEY. The runner uses the existing fixed Jev model and endpoint, with a
15-second timeout and no retry. It reserves a new output file exclusively before
calls and appends/fsyncs evidence. Existing outputs are never overwritten. A
missing key records BLOCK / NOT_RUN / callsAttempted=0 and the CLI exits 2.
Transport/response failure records UNKNOWN and stops remaining provider calls.
A completed replay is RECORDED, never a semantic PASS. MATCH against existing D
is not correctness; disagreement is not automatically error. All records retain
referenceIsGroundTruth=false. Do not run this through a new ops secret or dispatch
route: envs remains credential owner; this PR grants no workflow dispatch.

## Tests and current limits

The 54 offline Node tests cover async rejection, all eight candidate kinds,
closed-schema leakage, lossless policy/observed identity relations, hashes, accessors/sparse arrays,
ties/near-ties/low scores, malformed responses, provider failure, input budgets,
nine temporal/duplicate/effect/readback projections, comparator separation,
immutable output, missing-auth CLI exit, and fail-stop replay. Their scores and
policy are explicitly synthetic: they test plumbing and projection sensitivity,
not Jev's semantic judgment or production recovery. New destructive cases cover
same-kind alternatives with each target coordinate changed separately, effect
interpretation, changed candidate universes, duplicate/corrupt/vague candidates,
field-order invariance, same-shaped distinct identities, and comparator-only
changes leaving model requests identical. Assertions inside an injected adapter
are checked via completed-call count so caught exceptions cannot pass the test.

The existing nix-check workflow's flake-check job runs the focused test in an
exact-head detached worktree and retains its source SHA and TAP log in the
existing log artifact. Existing flake/governance/Chrome checks remain intact.
This is an explicit workflow step, not a new Nix check or test-skipping policy.

Remaining BLOCK: authenticated real Jev; externally verified accepted policy and
natural replay corpus spanning the whole decision plane; actual D/effect/readback
pairing; semantic outcomes on preregistered destructive temporal cases; independent
R review at W's successor SHA. Sparse typed observations may omit necessary D
context; a finite candidate universe can omit a valid decision or a material
target coordinate required by an external case. Such cases must remain BLOCK/UNKNOWN
rather than being reported as decision-complete.
Neither CI Green nor this harness closes those gaps. No whole-D completion claim.
