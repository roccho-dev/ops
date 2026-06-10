{
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "feat";
  packageRole = "implementation";
  artifactKind = "ops-package";
  provides = [
    "ops-issue-ledger"
    "issue-ledger-unified-kernel-implementation"
    "issue-ledger-workspace-audit"
  ];
  requires = [
    "issue-ledger-unified-kernel"
    "issue-ledger-contracts"
    "prove-feat"
  ];
  responsibility = "Implement the unified issue ledger checker/auditor for all repos while keeping validation semantics in src/ library code and examples under example/poc/example.";
  mission = "Give governance-records, policy, ops, and adrs-adjacent repos one issue-ledger semantics profile so non-v1 issue namespace contamination and validator drift become hard failures.";
  publicInterface = {
    version = "ops-issue-ledger.interface.v1";
    exports = [
      { name = "issue-ledger check"; kind = "cli"; contract = "Validate explicit issue ledger JSONL files."; }
      { name = "issue-ledger audit-workspace"; kind = "cli"; contract = "Discover and validate issues/*.jsonl ledgers below a workspace root."; }
      { name = "ops-issue-ledger"; kind = "cli-compat-wrapper"; contract = "Compatibility wrapper around issue-ledger."; }
      { name = "ops_issue_ledger"; kind = "python-lib"; contract = "Reusable parser, validator, and workspace discovery library."; }
    ];
  };
  sourceLayout = {
    src = "packages/ops-issue-ledger/src/ops_issue_ledger";
    bin = "packages/ops-issue-ledger/bin/issue-ledger";
    example = "packages/ops-issue-ledger/example/poc/example";
    rule = "src is lib; bin imports src; example/poc/example is not authority.";
  };
  allowedPaths = [ "packages/ops-issue-ledger/" "flake.nix" ];
  forbiddenPaths = [ "governance-records executable implementation" "policy validator semantics fork" "example as canonical authority" ];
  requiredOutputs = [ "packages.<system>.ops-issue-ledger" ];
  requiredChecks = [ "checks.<system>.ops-issue-ledger" ];
  requiredCommands = [
    "issue-ledger check --ledger issues/*.jsonl --json"
    "issue-ledger audit-workspace --workspace <root> --json"
    "ops-issue-ledger check --ledger issues/*.jsonl --json"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "ops-issue-ledger";
    inputs = [ "packages/ops-issue-ledger/default.nix" "packages/ops-issue-ledger/src/ops_issue_ledger/" ];
    guarantees = [
      "bin wrappers have no validation semantics beyond importing src"
      "non-v1 rows under issues/*.jsonl fail"
      "example/poc/example is excluded from default workspace discovery"
      "JSON output names canonical-latest-state-v1 semanticsProfile"
    ];
    failureModes = [ "validator-drift" "false-pass" "example-as-authority" ];
    evidence = [ "python tests" "nix check package" ];
  };
}
