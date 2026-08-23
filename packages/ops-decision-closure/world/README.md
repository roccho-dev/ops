# World-core compatibility

Status: proposed compatibility layer for `roccho-dev/adrs#314`.

This directory does not replace the existing Fact / Condition / Claim JSONL authority of `roccho-dev/adrs#300`. It proves that the same records can depend on a smaller semantic core without changing the selected SQLite-shard read model or the existing eight-query contract.

## Purpose

World logs must be easy to append before every future analysis is known. The shared semantic core is therefore limited to two record kinds:

```text
item  = something that needs a stable identity
claim = one statement about an item or another claim
```

Identity, relation, unit, and scale registries normalize repeated vocabulary. They are helper projections, not additional semantic-core kinds.

## Core contract

| Schema | Meaning |
|---|---|
| `world.item/1` | A person, company, product, place, event, source, rule, decision, or other identifiable thing |
| `world.claim/1` | An attribute, relation, observation, report, computation, inference, constraint, goal, proposal, or selection |
| `world.mapping/1` | A source-line receipt binding one legacy row to its projected world records |

Every item and claim carries the common record envelope:

- `schema`
- `id`
- `recorded_at`
- `origin`
- `status`
- optional `language` and `data`

The claim-specific keys are deliberately plain:

- `subject`
- `relation`
- `target`
- `basis`
- `mode`
- optional `negated`, `time`, `scope`, `confidence`, and `text`

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

The compatibility mapper keeps every legacy field in `data.legacy`. `to-fcc` reconstructs the three source streams exactly, so the projection does not require a destructive migration.

## Normalization rules

### Identity

The public mapper uses exact `domain + subject` identity. Display-name similarity never merges records. A later `same_as` claim requires explicit evidence.

### Relation

A small alias registry maps known equivalent words to one canonical direction. The source word remains in the mapping data for exact reconstruction. Unknown words are retained as deterministic normalized terms rather than guessed into an existing relation.

### Unit

Known aliases such as `円/年` and `JPY/year` map to `jpy_per_year`. Unknown units receive a stable normalized term. The original unit remains in the legacy data.

### Scale

Numeric confidence remains numeric. Named levels remain named and are listed in the generated scale registry. Named levels are not silently converted to numeric scores.

## Mapping quality

| Quality | Meaning |
|---|---|
| `semantic` | The mapper has an explicit meaning rule |
| `structural` | Fields and references are preserved structurally without a stronger semantic claim |
| `preserved` | The complete source row is retained because semantic interpretation would be unsafe |

Only `semantic` rows enter semantic facts, constraints, proposals, and inference views by default. `preserved` is a safe result, not a fact claim.

## Authority boundary

```text
legacy JSONL authority
→ deterministic world projection
→ SQLite views
→ facts / constraints / proposals / inferences / graph views
```

- Legacy JSONL remains unchanged.
- The world projection is regenerable.
- SQLite and its views are non-authority.
- The private 93-file corpus is proof input and is not committed to this public repository.
- `world/evidence/corpus-proof.json` records only aggregate counts, checks, limitations, and the exact proof ZIP digest.

## Commands

`bin/world-core.py` provides four bounded commands:

- `from-fcc`: project Fact / Condition / Claim JSONL into item + claim and SQLite views.
- `to-fcc`: reconstruct the original three JSONL streams.
- `verify`: reject unresolved subjects, targets, relations, mappings, duplicate IDs, and invalid basis/mode values.
- `verify-proof`: independently read and validate the bounded private corpus proof directory.

The normal package test is `tests/world-core.mjs`. It checks deterministic output, exact reverse reconstruction, SQLite view counts, identity separation, relation and unit normalization, and nine destructive cases.

## Claim ceiling

This compatibility layer establishes that:

1. the existing decision ledger can depend on `item + claim`;
2. its source rows can be recovered exactly;
3. facts, constraints, proposals, and inferences can be regenerated as views;
4. the bounded 93-file corpus can be retained with explicit semantic, structural, or preserved mapping receipts.

It does not establish that every future domain has already been observed, that every preserved row has been semantically understood, that SQLite is meaning authority, or that production cutover is complete.
