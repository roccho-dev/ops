# Ops issue-ledger migration inventory

createdAt: 2026-05-27T08:23:25+09:00

## Scope

- repo: `/home/nixos/repos/ops`
- candidate branch: `codex/ops-issue-design-localize-20260527`
- current v1 ledger for this candidate: `issues/260527-issue-design-localize.jsonl`

## Inventory

| path | records | classification | migration handling |
|---|---:|---|---|
| `issues/260519.jsonl` | 1 | legacy/non-v1 | Preserve as legacy evidence. Do not feed into current v1 gate. |
| `issues/260520.jsonl` | 7 | legacy/non-v1 | Preserve as legacy evidence until represented by v1 records. |
| `issues/260522.jsonl` | 3 | legacy/non-v1 | Preserve as legacy evidence; historical done/merged rows are not v1 closure proof. |
| `issues/260523-governance-md-migration.jsonl` | 16 | legacy/non-v1 | Preserve as legacy migration input. |
| `issues/260524.jsonl` | 1 | current v1 | Include in complete current-v1 validation when validating canonical ledgers. |
| `issues/260525.jsonl` | 4 | current v1 | Include in complete current-v1 validation when validating canonical ledgers. |
| `issues/260526.jsonl` | 4 | current v1 | Include in complete current-v1 validation when validating canonical ledgers. |
| `issues/260527-issue-design-localize.jsonl` | 12 | current v1 candidate | Validate as the candidate issue-design close ledger. |
| `issues/*.md` | 5 files | legacy Markdown evidence | Keep as evidence or generated views until represented by v1 records. |
| `issues/evidence/**` | evidence tree | raw/slim evidence | Keep behind evidence refs, manifests, and hashes. Do not treat raw proof trees as current issue state. |

## Boundary

Current issue truth is v1 JSONL. Markdown files and non-v1 JSONL rows stay
preserved as legacy evidence. They are not deleted, rewritten, or upgraded by
this candidate.

## Rollback

Rollback is branch-level: discard this candidate branch before localization.
No canonical issue files are edited by this candidate until approved
localization.

## Evidence

- `issues/issue-design-localize-20260527/evidence/issue-ledger-fsck-report.json`
- `issues/issue-design-localize-20260527/evidence/ops-runbook-checks-issue-ledger-fsck.log`
