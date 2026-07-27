# github-approval-evidence

Read-only GitHub provider adapter owned by ops.

```text
explicit repository / PR / review / candidate / observation identity
  -> GitHub GET-only readback or recorded provider fixture
  -> closed safe provider subset
  -> source/schema-bound adapter manifest
  -> githubApprovalEvidence.v1
```

## Boundary

The adapter records what GitHub reported. It does not decide accepted authority, grant validity, waiver validity, physical-human identity, account non-compromise, or provider-independent non-repudiation.

Numeric repository, pull-request, review, and actor IDs are primary. Login is an observed alias. Current collaborator permission is not historical authority and is excluded from the evidence envelope.

## Exact interface

Ops emits the Accepted flat `githubApprovalEvidence.v1` directly. It does not emit nested repository/review objects and does not create `providerApprovalEvidence.v1` or another intermediate envelope.

`adapter_manifest_digest` binds:

- `tools/github-approval-evidence.py` bytes;
- exact ADRS schema canonical digests;
- package identity;
- adapter version.

A version-string-only digest is rejected. Nix build and installed-binary proof remain separate closure evidence.

## Dependencies and merge order

```text
ADRS #260 / PR #263 Accepted and read back
  -> Ops #92 merge/readback
  -> Governance #183 binds the exact merged Ops adapter manifest
  -> Diagrams #16 binds the exact merged Governance engine manifest
```

Ops does not semantically depend on a merged Governance verifier. Governance consumes this evidence interface; it does not define it.

## Operations

```bash
python3 tools/github-approval-evidence-cli.py selftest
python3 tools/github-approval-evidence-cli.py manifest
python3 tools/github-approval-evidence-cli.py normalize --bundle bundle.json --request request.json --observed-at 2026-07-20T12:01:00Z
python3 tools/github-approval-evidence-cli.py read --repository owner/repo --pull-request-number 1 --review-id 1 --candidate-revision <sha> --observed-at <time> --token-env GITHUB_TOKEN --repository-id 1 --pull-request-id 1 --actor-account-id 1 --actor-login login
```

All network reads are GET-only. Credentials, transport headers, current permissions, and unrelated provider fields are never retained.

## Proof

- one positive recorded provider fixture;
- 22 destructive cases;
- deterministic evidence and manifest replay;
- exact flat-schema verification;
- source-bound adapter identity;
- read-only and secret-retention scans;
- bounded Nix package and installed-binary proof;
- existing ops flake checks;
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
