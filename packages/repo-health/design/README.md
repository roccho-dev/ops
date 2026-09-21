# Jev design review signal

Refs: roccho-dev/adrs#392, roccho-dev/ops#396/#397.

Purpose: surface semantic design concerns **before implementation** without turning a probabilistic judgment into merge authority.

## Input contract

The library receives one small declared design cut. Existing source can be projected into this shape mechanically; before implementation an LLM or human can produce it directly. This object is input/projection, not a second authority.

```text
Design
├─ purpose: string
├─ acceptance: string[]
├─ constraints: string[]
├─ in: string[]                         # external boundary inputs
├─ out: string[]                        # required boundary results
└─ units[]
   ├─ id: string
   ├─ kind: string                      # package / dir / file / public-function / shared-function / ...
   ├─ responsibility: string            # what this unit owns
   ├─ in: string[]
   ├─ out: string[]
   └─ design: string                    # how it is planned to fulfill the responsibility
```

Boundary and unit use the same `in/out` vocabulary. `responsibility` and `design` stay separate so the review can detect a plan that does not fulfill its own declared responsibility. `constraints` prevents legitimate cross-cutting requirements from being mislabeled as purpose leakage.

Hard structure remains ordinary code: identity, producer uniqueness, missing inputs/results, unused boundary/input/output/unit and cycles. A hard error makes zero Jev calls.

## Semantic output

There are **no semantic thresholds and no semantic PASS/FAIL/UNKNOWN**. Every theme is phrased as a possible concern, returns raw Noul, and is sorted descending **within that theme**. Cross-theme global ordering is deliberately avoided because different questions need not be equally calibrated.

The public review contract is conceptually:

```text
review(design, {
  topK,                               # required integer; 0 disables semantic calls
  themes?                             # omit => built-in themes
}, askJev)
→ {
    hard: string[],
    ranked: [{ theme, findings:[{subject,noul}] }],
    calls,
    usage
  }
```

Built-in themes:
- purpose → whole design
- responsibility → each unit
- closure → each declared producer→consumer edge
- duplicate → unit pairs
- scope → each unit
- acceptance → whole design

`topK` is the only ranking-size policy. Semantic findings do not fail CI or authorize repair/merge.

### Domain-specific themes

Pass the same reusable theme shape:

```text
{ id, scope: design | unit | edge | pair, concern }
```

For example, an order domain may add concerns for concurrent arrival, post-effect failure, retry safety and readback. Jev only ranks concerns in the **declared design**; it does not prove exactly-once behavior. Mechanical concurrency/proof remains separate.

## CI UX

```text
hard design error → RED
semantic review completed → CI may remain Green + ranked report
Jev/auth/transport malformed → execution error
```

A normal design can therefore ignore low-ranked findings. There is no Boolean false-positive that blocks a valid design. Ranking noise can still exist: a benign subject can appear high. Measure `precision@K / useful@K` on real reviews before promoting any semantic theme to authority.

## Frozen first experiment

The historical first experiment used thresholds and is preserved in PR evidence. The current code removes them rather than tuning them after observing UNKNOWNs. The same 20 fixed fixtures remain for continuity, but semantic evaluation now measures **pairwise ranking**: for each valid/defect pair under the same theme, the defect should rank as more concerning. This is evidence of bounded ranking behavior, not production accuracy.

No new package, registry, DB, renderer, parser, agent or service is introduced.
