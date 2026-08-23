# World log

Implementation: merged in `roccho-dev/ops`. Meaning acceptance remains governed by `roccho-dev/adrs#314`.

Search names:

```text
調査基盤
調査台帳
research ledger
world log
```

## One semantic core

```text
item  = something with a stable identity
claim = one statement about an item or another claim
```

Identity, relation, unit, and scale registries normalize repeated vocabulary. They are helper projections, not additional semantic-core kinds.

| Schema | Meaning |
|---|---|
| `world.item/1` | A person, company, product, place, event, source, rule, decision, or other identifiable thing |
| `world.claim/1` | An attribute, relation, observation, report, computation, inference, constraint, goal, proposal, or selection |
| `world.mapping/1` | A source-line receipt binding one source row to projected world records |

Every item and claim carries:

- `schema`
- `id`
- `recorded_at`
- `origin`
- `status`
- optional `language` and `data`

A claim adds:

- `subject`
- `relation`
- `target`
- `basis`
- `mode`
- optional `negated`, `time`, `scope`, `confidence`, and `text`

## Canonical use

There is exactly one user-facing example:

```text
world/golden/
```

Start with:

```text
world/golden/request.txt
→ world/golden/README.md
→ world/golden/input/
→ world/golden/expected.json
```

`golden` fixes the operation and completion boundary. It does not force every future domain to use Fact / Condition / Claim as its authoring schema. A domain-specific JSONL may use its own mapper, but it must produce the same `item + claim`, source-line receipt, normalization, projection, and verification boundary.

Additional cases belong in tests. They are not alternative recipes.

## Meaning split

`basis` records how the statement became known.

| Value | Meaning |
|---|---|
| `observed` | Directly observed or executed |
| `reported` | Reported by a person or source |
| `computed` | Deterministically calculated |
| `inferred` | Inferred from other records |
| `assumed` | Introduced as an assumption |
| `declared` | Declared as a rule, goal, preference, or decision |

`mode` records how the statement is intended to hold.

| Value | Meaning |
|---|---|
| `actual` | Describes the world |
| `possible` | Describes a possibility |
| `expected` | Describes an expectation |
| `required` | Required condition |
| `forbidden` | Forbidden condition |
| `permitted` | Permission |
| `desired` | Goal or preference |
| `recommended` | Proposal |
| `selected` | Chosen decision |

## Existing Fact / Condition / Claim mapping

The current proven mapper is:

```text
world/mappers/ops-fcc-1.json
```

| Existing record | World projection |
|---|---|
| Fact | `basis=observed`, `mode=actual` claim |
| Scope condition | declared actual claim plus `scope` |
| Goal condition | `mode=desired` claim |
| Constraint, threshold, freshness condition | `mode=required` claim |
| Derived claim | computed or inferred claim |
| Proposal | `mode=recommended` claim |
| Decision | `mode=selected` claim |
| `rel[]` | claim about another claim, such as `depends_on`, `contradicts`, `supersedes`, or `result_of` |

The mapper keeps every legacy field in `data.legacy`. `to-fcc` reconstructs the three source streams exactly, so compatibility does not require destructive migration.

## Normalization

### Identity

The public mapper uses exact `domain + subject` identity. Display-name similarity never merges records. A later `same_as` claim requires explicit evidence.

### Relation

Known aliases map to one canonical direction. The source word remains recoverable. Unknown words receive a stable normalized term and are not guessed into an existing relation.

### Unit

Known aliases such as `円/年` and `JPY/year` map to `jpy_per_year`. The source unit remains recoverable. Conversion rates and conversion times are separate claims.

### Scale

Numeric confidence remains numeric. Named levels remain named. A level is never silently converted into a score.

## Mapping quality

| Quality | Meaning |
|---|---|
| `semantic` | An explicit meaning rule exists |
| `structural` | Fields and references are preserved structurally |
| `preserved` | The complete source row is retained because semantic interpretation would be unsafe |

Only `semantic` rows enter semantic facts, constraints, proposals, and inference views by default. `preserved` is safe retention, not a fact claim.

## Authority boundary

```text
source JSONL authority
→ deterministic item + claim projection
→ read-only SQLite views
→ facts / constraints / proposals / inferences / graph views
```

- Source JSONL is not overwritten.
- The world projection is regenerable.
- SQLite and views are non-authority.
- The private 93-file corpus is not committed.
- `world/evidence/corpus-proof.json` stores only aggregate proof and the exact proof ZIP digest.
- Generated SQLite is deliberately absent from the golden; `expected.json` stores its readable contract and digest.

## Commands

`bin/world-core.py` provides four bounded commands:

- `from-fcc`: project Fact / Condition / Claim JSONL into item + claim and SQLite views.
- `to-fcc`: reconstruct the original three JSONL streams.
- `verify`: reject unresolved subjects, targets, relations, mappings, duplicate IDs, and invalid basis/mode values.
- `verify-proof`: independently validate a bounded private corpus proof directory.

The package check `tests/world-core.mjs` proves discovery, golden hash equality, reverse reconstruction, deterministic SQLite, normalization, existing-fixture compatibility, and destructive cases.

## Claim ceiling

This package establishes that:

1. source schemas can depend on `item + claim`;
2. source rows can be recovered when their mapper promises reversibility;
3. facts, constraints, proposals, and inferences can be regenerated as views;
4. the bounded 93-file corpus can be retained with `semantic`, `structural`, or `preserved` receipts.

It does not establish that every future domain has already been observed, that every preserved row has been semantically understood, that SQLite is meaning authority, or that production cutover is complete.
