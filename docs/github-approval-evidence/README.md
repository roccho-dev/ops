# github-approval-evidence

Read-only GitHub provider adapter owned by ops.

```text
explicit repository / PR / review / candidate / observation identity
  -> GitHub REST readback or recorded provider fixture
  -> closed canonical provider subset
  -> githubApprovalEvidence.v1
```

## Boundary

The adapter records what GitHub reported. It does not decide accepted authority, grant validity, waiver validity, physical-human identity, account non-compromise, or provider-independent non-repudiation.

Numeric repository, pull-request, review, and actor IDs are primary. Login is an observed alias. Current collaborator permission is not historical authority and is excluded from the evidence envelope.

## Dependencies

```text
ADRS architecture  roccho-dev/adrs#260          PROPOSED / runner blocked
governance schema  roccho-dev/governance#182    candidate PR #183
```

This candidate may prove the adapter and envelope against recorded fixtures. Merge is forbidden until both exact upstream contracts are Accepted/merged and their digests are bound.

## Operations

```bash
python3 tools/github-approval-evidence.py selftest
python3 tools/github-approval-evidence.py normalize --bundle bundle.json --request request.json --observed-at 2026-07-20T12:01:00Z
python3 tools/github-approval-evidence.py read --repository owner/repo --pull-request-number 1 --review-id 1 --candidate-revision <sha> --observed-at <time> --token-env GITHUB_TOKEN --repository-id 1 --pull-request-id 1 --actor-account-id 1 --actor-login login
```

All network reads are GET-only. Credentials, transport headers, current permissions, and unrelated provider fields are never retained.

## Proof

- one positive recorded provider fixture;
- 22 destructive cases;
- deterministic replay;
- read-only and secret-retention scans;
- bounded Nix package build;
- existing ops flake checks against the exact governance candidate;
- exact-head artifact.

## Claim ceiling

```text
githubReviewEvidenceReadbackImplemented=true
exactCandidateAndActorReadbackProven=true
providerEvidenceDigestProven=true
authorityGrantValidityProven=false
physicalHumanIdentityProven=false
accountNonCompromiseProven=false
providerIndependentNonRepudiationProven=false
allProvidersImplemented=false
businessOutcomeAchieved=false
corporateSaleOutcomeAchieved=false
```
