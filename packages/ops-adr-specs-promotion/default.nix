{
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "feat";
  packageRole = "implementation";
  artifactKind = "ops-package";
  provides = [
    "ops-adr-specs-promotion"
    "adr-specs-promotion-kernel-implementation"
    "adr-specs-promotion-workspace-audit"
  ];
  requires = [
    "adr-specs-promotion-kernel"
    "issue-ledger-unified-kernel"
    "adr-jsonl-intent-input"
    "prove-feat"
  ];
  responsibility = "Implement the adrs/governance-records promotion bridge audit as an ops feat package while keeping executable semantics out of governance-records, adrs, and policy.";
  mission = "Detect authority collapse, missing governance-records binding, missing adrs promotion records, wrong feat placement, and premature Nix compression claims.";
  publicInterface = {
    version = "ops-adr-specs-promotion.interface.v1";
    exports = [
      { name = "ops-adr-specs-promotion audit"; kind = "cli"; contract = "Audit a full adrs/governance-records/ops worktree for the promotion kernel invariants."; }
      { name = "ops_adr_specs_promotion"; kind = "python-lib"; contract = "Reusable parser and invariant checker."; }
    ];
  };
  sourceLayout = {
    src = "packages/ops-adr-specs-promotion/src/ops_adr_specs_promotion";
    bin = "packages/ops-adr-specs-promotion/bin/ops-adr-specs-promotion";
    example = "packages/ops-adr-specs-promotion/example/poc/example";
    rule = "src is lib; bin imports src; example/poc/example is not authority.";
  };
  allowedPaths = [
    "packages/ops-adr-specs-promotion/"
    "flake.nix"
    "issues/260604-ops-adr-specs-promotion-kernel.jsonl"
  ];
  forbiddenPaths = [ "governance-records executable implementation" "adrs executable implementation" "policy validator semantics fork" "example as canonical authority" ];
  requiredOutputs = [ "packages.<system>.ops-adr-specs-promotion" ];
  requiredChecks = [ "checks.<system>.ops-adr-specs-promotion" ];
  requiredCommands = [
    "ops-adr-specs-promotion audit --workspace <full-worktree> --json"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "ops-adr-specs-promotion";
    inputs = [ "packages/ops-adr-specs-promotion/default.nix" "packages/ops-adr-specs-promotion/src/ops_adr_specs_promotion/" ];
    guarantees = [
      "bin wrapper has no bridge semantics beyond importing src"
      "ADR raw records are not issue records"
      "governance-records package contract is the accepted authority"
      "generated feat input binds the ops implementation package"
      "Nix compression is not falsely claimed"
    ];
    failureModes = [ "authority-collapse" "missing-governance-records-binding" "missing-feat-input-binding" "premature-nix-compression" ];
    evidence = [
      "python tests"
      "workspace audit JSON"
      "governance-records-main/records/specs/package-contract.v1.jsonl"
      "governance-records-main/generated/feat-inputs/adr-specs-promotion-kernel.json"
    ];
  };
}
