{
  package = "shiftleft-python-provider";
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "ops-check";
  repoSourceUri = "path:.";
  packageRole = "check";
  artifactKind = "ops-package";
  provides = [
    "shiftleft-python-imports"
    "python-ast-import-observation"
  ];
  requires = [ "python-stdlib-ast" ];
  responsibility = "Parse Python source with the standard-library AST and emit deterministic import observations for shiftleft-admission.";
  mission = "Keep Python source and runtime ownership outside the Go admission core while preserving the shared rule ID, finding meaning, and executable bad/false-negative/false-positive/good evidence.";
  publicInterface = {
    version = "shiftleft-python-provider.interface.v1";
    exports = [
      {
        name = "shiftleft-python-imports";
        kind = "thin-cli";
        contract = "Input: one Python source path. Output: shiftleft-import-report/1 JSON. Errors: syntax/read failure. Effects: read-only filesystem; no network.";
      }
    ];
  };
  sourceLayout = {
    bin = "packages/shiftleft-python-provider/bin/shiftleft-python-imports.py";
    fixtures = "packages/shiftleft-python-provider/fixtures/python";
    rule = "This package only observes Python syntax. Policy intake, four-state folding, and Receipt authority remain in shiftleft-admission.";
  };
  allowedPaths = [
    "packages/shiftleft-python-provider/"
    "packages/shiftleft-admission/policy/profiles.jsonl"
    "packages/shiftleft-admission/fixtures/python/"
    "packages/shiftleft-admission/default.nix"
    "packages/shiftleft-admission/README.md"
    ".github/workflows/issue-116-shiftleft-proof.yml"
    "build/packages.jsonl"
    "build/checks.jsonl"
    "flake.nix"
  ];
  forbiddenPaths = [
    "policy authority"
    "receipt folding"
    "GitHub write effect"
    "network access"
    "generated output as authority"
  ];
  requiredOutputs = [ "packages.<system>.shiftleft-python-provider" ];
  requiredChecks = [ "checks.<system>.issue-116-shiftleft-proof" ];
  requiredCommands = [
    "shiftleft-python-imports packages/shiftleft-python-provider/fixtures/python/good/core.py"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "shiftleft-python-provider";
    inputs = [
      "packages/shiftleft-python-provider/bin/shiftleft-python-imports.py"
      "packages/shiftleft-python-provider/fixtures/python/"
    ];
    guarantees = [
      "good Python source emits an empty import list"
      "forbidden imports and aliased forbidden imports remain observable"
      "comments and strings that mention imports do not become findings"
      "output rows are deterministically sorted"
      "provider output is non-authoritative input to shiftleft-admission"
    ];
    failureModes = [
      "python-source-hidden-inside-go-package"
      "token-only-python-import-scan"
      "comment-as-import-false-positive"
      "aliased-import-false-negative"
      "provider-as-policy-authority"
    ];
    evidence = [
      "bad/false-negative/false-positive/good fixtures"
      "issue-116-shiftleft-proof artifact"
    ];
  };
}
