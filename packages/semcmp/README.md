# semcmp contract proposal

Status: **CONTRACT_PROPOSAL / NO IMPLEMENTATION**

Refs: roccho-dev/adrs#526, roccho-dev/adrs#481, roccho-dev/adrs#484, roccho-dev/edits#125, roccho-dev/apps#46, roccho-dev/ops#403.

## Purpose

`semcmp` is the shared calculation boundary that lets a Human give an easy, fuzzy hint and receive a small ordered set of visible meanings that can be selected immediately.

The surface must not require the Human to first write the correct syntax, command, graph operation, or formal type.

Quality means:

- the intended Decision is present;
- it is ranked near the top;
- the Human can recognize it quickly;
- the number of selection/correction steps is small.

## Shared contract domain

The contract must be shared by edits and apps and must not belong to Vimscript, the apps server, or a specific provider.

```text
Q := Input<α> × State<σ> × Focus<φ>

semcmp(Q)
  -> Ordered Proposal<β>*

Surface(Ordered Proposal<β>*)
  -> Selection(proposal_id | cancel)
```

Meanings:

- `Input<α>`: whatever is easiest for the Human to express: typed fragment, voice-derived intent, text Goal, or another meaning-changing input. `α` stays open.
- `State<σ>`: material current + Working + relevant context supplied by the consumer. semcmp owns no accepted state.
- `Focus<φ>`: what is being decided now: cursor/active span, selected object, current decision target, etc.
- `Proposal<β>`: one interpreted meaning. `β` stays open and may represent text, semantic relation, graph edit, function/capability, command, math, or future types.
- `Selection`: the surface points to one proposal identity or cancels. Selection is not Commit/Admit.

A Proposal must preserve enough identity to resolve the selected original meaning after projection. Its Human-facing view may include a short label/type and bounded evidence/why. A proposal may contain a capability/command candidate when that is the inferred intent, but semcmp does not execute it.

## Contract flow

```mermaid
flowchart LR
  subgraph SURFACES["Input / selection surfaces"]
    V["edits<br/>Vimscript<br/>typing + cursor/span"]
    A["apps<br/>Voice / Web<br/>Goal + semantic event"]
  end

  subgraph DOMAIN["shared contract domain"]
    Q["Query<br/>Input α + State + Focus"]
    R["Ordered Proposal β*<br/>identity + visible meaning"]
  end

  subgraph SEMCMP["semcmp — shared calc"]
    P["interpret / propose"]
    J["semantic judge / rank<br/>reuse jev-review"]
    O["ordered proposals<br/>preserve identity/type"]
    P --> J --> O
  end

  V --> Q
  A --> Q
  Q --> P
  O --> R
  R --> V
  R --> A

  V -->|"Human selection"| W["Working"]
  A -->|"selection policy"| W
  W -. "explicit Commit" .-> X["Prove / Admit / Effect<br/>outside semcmp"]
```

## Responsibility boundary

### edits / Vimscript

Owns only:

- obtain easy fuzzy input;
- provide latest State and Focus;
- call semcmp through the shared contract;
- project returned proposals into native completion/cmp;
- let the Human select/cancel;
- preserve the selected opaque proposal identity.

It does not own interpretation, proposal generation, semantic ranking, command selection logic, effect, Commit, or Accepted state.

### apps

Owns the same consumer boundary with different input/projection/selection policy. Its server/Worker may host or transport calls, including dev-only hosting, but is not semcmp meaning authority.

Existing apps Goal→Choice→Jev flows are consumer evidence, not a second semcmp contract.

### semcmp / ops

Owns calculation only:

```text
fuzzy Input + supplied State + Focus
→ interpret / propose
→ semantic judge / rank
→ ordered heterogeneous Proposal set
```

It owns no surface UI, accepted persistence, Git/State Port, Commit/Admit, or effect.

### jev-review

Reuse the existing JS shared semantic evaluation boundary from ops#403. Jev judges/ranks supplied subjects/questions; it is not required to invent every proposal itself.

Candidate production may later combine deterministic lookup, reuse/search, Sys2, or other proposers. That internal composition is not fixed by this contract.

## Initial implementation choice

Use **JavaScript first** because the existing shared `jev-review` core is JavaScript/Node and this minimizes the first integration cost.

This is an implementation choice, not a semantic contract:

```text
shared contract domain != JavaScript API
semcmp v0 implementation = JavaScript
future implementation language = replaceable
```

Do not add a server, DB, queue, cache, persistence layer, or new provider transport merely to implement semcmp.

## Expected UX behavior

Example:

```text
Input: "api db"
State: API and DB already exist
Focus: current relation unit

semcmp ->
1. API → DB
2. API depends_on DB
3. DB → API
4. keep "api db" as text
```

The important output is not a polished sentence. It is a small visible set of plausible intended Decisions.

A more capable semcmp should allow less precise input while reducing Human steps.

## Quality

Primary measures:

```text
intended@1      ↑
intended@K      ↑
none            ↓
selection steps ↓
large after-edit↓
```

Do not optimize prose quality independently of Decision reachability.

## Non-goals of this PR

This PR does not:

- implement semcmp;
- freeze the exact JSON/JS field schema;
- choose a server or hosting model;
- create an apps- or edits-specific candidate engine;
- make Jev an effect/accept authority;
- require a specific candidate generator;
- define Commit/Admit/State Port persistence;
- claim fuzzy understanding quality is proven.

The next implementation PR should be justified only after this shared contract is accepted and should start with the smallest two-consumer proof that edits and apps can both send the same contract shape and receive selectable ordered proposals.

## Initial JS PoC — controlled composition

The contract-only status above records merged #479. This first implementation
proves mechanical composition, not fuzzy understanding or real consumer integration.

```js
import { semcmp } from './semcmp.mjs';
const result = await semcmp({ input, state, focus }, { propose, ask });
// result = { query, proposals, evaluation }
// each proposal = { id, meaning, representation, evidence: { theme, noul } }
```

This private JS candidate API accepts plain JSON data. Input, State, Focus and
meaning have no domain enum; the example types do not close alpha or beta.
`propose(query)` supplies a finite array of `{id, meaning, representation}`;
IDs must be unique nonempty strings and representation must be nonempty text.
The caller supplies `ask(state, questions)` through existing Jev composition.
There is no credential lookup, HTTP, server, CLI or effect in this module.

The query is captured before awaiting propose, and returned proposals before
awaiting evaluation. Callbacks receive separate copies. The existing shared
`evaluate` validates judgments and coverage; `rankJudgments` orders all supplied
proposals under one `intent-fit` hypothesis: the proposal expresses a Decision
intended by the supplied Input, State and Focus. Descending Noul orders evidence
for that hypothesis, not truth, permission or adoption. No threshold, cross-theme
calibration or truncation is added. Ties retain the existing subject ordering.
Original IDs and meaning data survive ordering; JavaScript object identity is not
promised. Raw judgments, calls, coverage and usage remain in `evaluation`.

Invalid queries/composition/proposals and duplicate IDs throw before asking.
Proposal-generation failure is `PROPOSE_FAILED`; evaluation/model/response
failures remain exceptions from the shared evaluator. An empty proposal set has
zero evaluator calls and an empty result; it is not evidence of semantic success.

Run `node packages/semcmp/tests/run.mjs`, or the existing generated Nix
`checks.<system>.semcmp`. The controlled proposer and evaluator test two
caller-shaped projections, heterogeneous text/relation data, fresh input,
identity/evidence/order correspondence, reversed input order, ties, callback
mutation, empty sets and failures. They make no provider calls. Fixture scores
prove correspondence and composition only; intended@1/K, selection quality,
real Jev, actual apps/edits integration and business value remain unproved.
Selection/cancel stays outside this calculation, and neither executes meaning.

## Installed executable

`nix build .#semcmp` supplies `bin/semcmp`, Node and only the runtime modules of
semcmp and jev-review. It needs no sibling checkout or working-directory layout.
Its private stdin envelope is `{query, proposals}`: the consumer captures its
configured candidate data once, and supplies the query and that same array.
Stdout is one JSON result from the existing semcmp calculation. The envelope is
an implementation adapter, not a newly frozen shared wire contract.

For nonempty candidates the executable reuses `askJev` with `JEV_API_KEY`,
`JEV_API_URL` (default `https://api.typesafe.ai/v1/systemone`) and
`JEV_TIMEOUT_MS` (default 15000). The supplied candidates are evaluated against
the fresh Input, State and Focus; no semantic generator or effect is added.
`share/semcmp/artifact.jsonl` declares `jev-api`; it does not supply credentials.
Existing target launchers can bind specific programs; installing semcmp does not
extend their allowed commands or authorize a credential-bearing launch.
Empty candidates make no provider call. Invalid input, missing capability and
provider failure exit nonzero, with no result and a bounded diagnostic code.
There is no retry, implicit example fallback or raw exception output.

`checks.<system>.semcmp-cli` runs the installed executable, including sibling
imports, with a test-only Node fetch preload. Two fresh queries reorder the same
heterogeneous candidate data while retaining identity, meaning and evidence.
Empty, invalid and provider-failure cases are also checked. No network call is
made; these controls establish process/package correspondence, not real Jev
quality, Human UX, actual apps/edits integration or adoption.
