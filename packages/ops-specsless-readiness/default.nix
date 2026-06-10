{
  packageName = "ops-specsless-readiness";
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "ops";
  repoSourceUri = "path:.";
  packageRole = "implementation";
  artifactKind = "feat-result";
  provides = [ "ops-specsless-readiness" "specsless-canonical-cutover-proof-runner" ];
  requires = [ "specsless-canonical-cutover" "ops-issue-ledger" "prove-feat" ];
  responsibility = "Implement the executable readiness proof for specs-less canonical cutover, while governance-records owns accepted package contracts and adrs owns purpose/obligation meaning.";
  mission = "Prove from the latest canonical worktree that accepted JSONL records, projection digests, feat inputs, dependency/factorization guards, and destructive cases preserve the meaning formerly carried by the retired specs authority.";
  allowedPaths = [ "packages/ops-specsless-readiness/" "flake.nix" ];
  forbiddenPaths = [ "retired specs authority as readiness implementation" ];
  requiredOutputs = [ "packages.<system>.ops-specsless-readiness" ];
  requiredChecks = [ "checks.<system>.ops-specsless-readiness" ];
  packageContents = [
    "packages/ops-specsless-readiness/bin/ops-specsless-readiness.py"
    "packages/ops-specsless-readiness/src/ops_specsless_readiness/specsless_readiness.py"
    "packages/ops-specsless-readiness/default.nix"
  ];
}
