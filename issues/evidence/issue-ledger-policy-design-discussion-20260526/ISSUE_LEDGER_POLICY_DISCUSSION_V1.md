# ISSUE_LEDGER_POLICY_DISCUSSION_V1

discussionId: issue-ledger-policy-design-20260526
proposalRevision: v1
threadFunction: impl-review

## Purpose Lineage

- purposeDepth=3: Discuss whether policy issue-ledger rules and real repo issue designs are misaligned, starting from agenda enumeration.
- purposeDepth=2: Keep repo work queues usable for local workers, review, merge, and recovery without creating misleading gates or unbounded repo bloat.
- purposeDepth=1: Keep ChatGPT/Codex/local repos operating under durable actor workflow with evidence, append-only claims, and clean handoff.
- purposeDepth=0: Make local repo development recoverable, verifiable, and mergeable.

## Policy Snapshot Excerpt

From `/home/nixos/repos/policy/.agents/issue-ledger.md`:

- Issue work queues use JSONL.
- Markdown issue files are legacy evidence unless a command says otherwise.
- Each repo may keep ledgers under `issues/*.jsonl`.
- Each line is one complete `issue.record.v1` snapshot.
- A later line updates an issue by repeating `issueId` and listing the previous `recordId` in `supersedes`.
- Required machine fields include status, target repo, branch, allowed paths, close criteria, required evidence, blocker, and handoff.
- Status vocabulary: `open`, `ready-for-work`, `in-progress`, `blocked`, `localized-handoff`, `closed`, `superseded`.
- `blocked` currently means: work must not continue until `blocker` is resolved.
- Validation section says: `check-issue-ledger-jsonl.sh issues/*.jsonl`; validate the complete ledger set, not only an isolated shard, because `supersedes` must resolve.

From `/home/nixos/repos/policy/.agents/project-workspace.md`:

- For 2-thread discussion, each thread must read the proposal and peer replies directly through Project Source.
- Facilitator summary is not a verdict.
- Same `proposalRevision` no-objections are required before pass.

## Current Observations From ops Repo

1. `ops/issues/260519.jsonl` is legacy shape, not `issue.record.v1`.
   It has keys like `id`, `status`, `kind`, `createdAt`, `title`, `summary`, `repo`, `source`, `doneWhen`, `evidence`.

2. Full gate across `ops/issues/*.jsonl` fails immediately on `260519.jsonl:1` because required v1 fields are missing and legacy fields are unexpected.

3. A scoped gate over current v1 chain `260524.jsonl + 260525.jsonl + 260526.jsonl` passes.

4. Latest current v1 issues in that chain:
   - `ops.project-source-worker-readable-upload`: `ready-for-work`
     - narrowed after live reproof showed fresh Project Source upload, Project thread create, and delayed assistant-only readback succeeded.
     - remaining issue is consistency: `project-transport-env` / `project-source-list` can disagree with worker-readable proof.
   - `ops.thread-fsm-marker-substring`: `open`
     - `NO_UNRESOLVED_OBJECTIONS` is misclassified as objection marker in current `ops-thread-fsm`.

5. There are also Markdown issue files and evidence directories under `ops/issues/`.
   Policy says Markdown issue files are legacy evidence unless command says otherwise, but repo reality still includes them.

## Start The Discussion By Enumerating Agenda

Do not jump directly to a final policy patch. First enumerate the agenda and classify each agenda item as one of:

- policy-rule-change candidate
- repo-local issue design change candidate
- migration/backfill task
- tooling/gate task
- evidence storage/retention task
- no-change-needed

The agenda must include at least these topics:

1. Should issues live inside Git-managed repo paths at all?
2. If issues stay in Git, what belongs in Git and what should be outside Git?
3. Does append-only JSONL make repo volume grow too much over time?
4. Are large evidence files, raw CDP logs, source snapshots, bundles, and thread readbacks acceptable inside the repo?
5. If compression, sharding, archive branches, git-annex/LFS, artifact stores, or periodic compaction exist, do they remove the concern or only move it?
6. Should `issues/*.jsonl` mean all files must be current `issue.record.v1`, or should legacy files be excluded by name/path/schema?
7. Should validation always cover all `issues/*.jsonl`, or should there be separate gates for full repo, active chain, migration, and release?
8. Should repo-specific issue design be allowed, or must policy impose one cross-repo issue schema?
9. Should policy define a minimal issue interface and let repos own richer local issue schemas?
10. How should `blocked` be defined so it does not get confused with "tool cannot be used at all"?
11. How should a large issue be narrowed after partial resolution without pretending it is closed?
12. When should issue updates use same `issueId` with `supersedes`, and when should they split into a new issue?
13. Should `evidence` stay as small string refs, or move to structured `evidenceRefs[]` with hashes, sizes, retention class, and storage tier?
14. How should old legacy JSONL like `260519.jsonl` be migrated, quarantined, or grandfathered?
15. What invariant must hold so a worker can start from one latest issue record plus repo policy?

## Required Output From Each Thread

Return:

1. `AGENDA`: a numbered list of agenda items, including any missing items you add.
2. `POSITION`: your recommended direction.
3. `POLICY_GAPS`: concrete places where current policy is too strict, too vague, or wrong.
4. `REPO_DESIGN_GAPS`: concrete places where ops repo issue design is misaligned.
5. `MIGRATION_PLAN`: minimal migration path that preserves evidence and does not rewrite history casually.
6. `RISKS`: especially bloat, validation false positives/negatives, worker usability, and merge hygiene.
7. `OPEN_QUESTIONS`: things the peer thread should answer.

Do not claim `impl-review-pass` yet. This is round 1 agenda enumeration.
