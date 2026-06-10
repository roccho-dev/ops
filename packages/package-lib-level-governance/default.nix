{
  package = "package-lib-level-governance";
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "ops-check";
  repoSourceUri = "path:.";
  packageRole = "check";
  artifactKind = "ops-package";
  provides = [
    "package-lib-level-governance"
    "package-lib-level-admission-gate"
    "core-port-adapter-level-baseline"
    "adapter-example-usecase-obligation-gate"
  ];
  requires = [
    "package-contracts"
    "port-adapter-library-governance"
    "functional-core-governance-gate"
    "check-packages-contract"
  ];
  responsibility = "Implement a repo-wide package lib-level admission gate: every package is classified as core-port lib, adapter extension, governance/check, planned, or legacy debt against the port-adapter-library-governance contract.";
  mission = "Stop package-by-package lib-level drift by making core+port authority, adapter-as-extension, and example/usecase/e2e obligations visible and comparable for all package contracts.";
  publicInterface = {
    version = "package-lib-level-governance.interface.v1";
    exports = [
      { name = "package-lib-level-governance audit"; kind = "cli"; contract = "Read governance-records package contracts, classify all packages, compare with the baseline, and emit JSON/JSONL/CSV reports."; }
      { name = "package_lib_level_governance.core"; kind = "python-lib"; contract = "Pure classifier from package-contract records to lib-level classification rows."; }
    ];
  };
  sourceLayout = {
    src = "packages/package-lib-level-governance/src/package_lib_level_governance";
    bin = "packages/package-lib-level-governance/bin/package-lib-level-governance";
    tests = "packages/package-lib-level-governance/tests";
    rule = "src is core library; adapter owns filesystem/CLI; bin is thin wrapper; tests include adapter/usecase obligations.";
  };
  allowedPaths = [
    "packages/package-lib-level-governance/"
    "flake.nix"
    "specsless-inputs/package-catalog.json"
    "specsless-inputs/placement-table.json"
    "../governance-records-main/records/specs/package-lib-level-baseline.v1.jsonl"
    "../governance-records-main/records/specs/package-lib-level-policy.v1.json"
  ];
  forbiddenPaths = [
    "mutating package contracts during audit"
    "treating adapter examples as canonical behavior"
    "allowing new packages without a baseline/admission row"
    "requiring runtime adapters to become package authority"
  ];
  requiredOutputs = [ "packages.<system>.package-lib-level-governance" ];
  requiredChecks = [ "checks.<system>.package-lib-level-governance" ];
  requiredCommands = [
    "package-lib-level-governance audit --root <repo-root> --baseline governance-records-main/records/specs/package-lib-level-baseline.v1.jsonl --mode admission --json"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "package-lib-level-governance";
    scope = "repo-wide package-contract lib-level admission";
    inputs = [
      "governance-records-main/records/specs/package-contract.v1.jsonl"
      "governance-records-main/records/specs/package-lib-level-baseline.v1.jsonl"
      "port-adapter-library-governance architecture policy"
    ];
    guarantees = [
      "every package contract has one lib-level classification row"
      "core-port libs expose core and port/public-interface evidence"
      "adapter-like packages are extension/glue and require example/usecase/e2e evidence or explicit baseline debt"
      "new packages cannot enter without a baseline/admission row"
      "final mode fails while accepted baseline debt remains"
    ];
    failureModes = [
      "new-package-without-lib-level-admission"
      "adapter-package-without-example-usecase-e2e"
      "core-port-package-without-core-or-port-evidence"
      "classification-regression"
      "final-mode-with-baseline-debt"
    ];
    evidence = [
      "package-lib-level-summary.json"
      "package-lib-level-baseline.generated.v1.jsonl"
      "package-lib-level-report.csv"
      "python unit tests"
    ];
  };
}
