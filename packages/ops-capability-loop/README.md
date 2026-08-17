# ops-capability-loop

Closes the local capability-reuse workflow on top of the merged PR #108 `repo-head-release/1` contract.

```text
repo-head Release Carrier + intake Carrier
→ exact Base64/SHA verification
→ shallow .git capsule restore + fsck
→ package projection
→ find-packages duplicate search
→ reuse / compose / extend / new
→ package-architecture-map
→ next content-addressed intake Carrier
```

## Boundary

- Inputs are already-present exact Release assets; network fetch/readback stays outside this package.
- The repo-head asset is the PR #108 `.git.tar.gz` capsule, not a synthetic Git bundle.
- `find-packages` remains the package-search owner.
- `package-architecture-map` remains the map renderer.
- The restored repo is read-only input to this decision step; this command does not edit/publish/merge.

## Input

`--release-dir` contains exactly one `repo-head-release/1` receipt, its Carrier/raw archive, and exactly one `carrier.intake.<decoded-sha256>.b64.txt`.

## CI

`build/checks.jsonl` connects this package to the existing `nix flake check` workflow; no second CI workflow is added.
