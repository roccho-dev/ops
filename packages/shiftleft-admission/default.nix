{
  package = "shiftleft-admission";
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "ops-check";
  repoSourceUri = "path:.";
  packageRole = "check";
  artifactKind = "ops-package";
  provides = [
    "shiftleft-admission"
    "policyctl"
    "shiftleft-rule-observation-receipt"
    "tree-bound-shiftleft-receipt"
  ];
  requires = [
    "package-lib-level-governance"
    "functional-core-governance-gate"
    "github-exact-commit-ref"
  ];
  responsibility = "Intake an exact policy bundle, normalize language-specific evidence, fold met/unmet/unobserved/not-applicable, and emit deterministic receipts bound to policy, base tree, and candidate tree.";
  mission = "Make code without an exact, evidence-backed Shift Left receipt remain draft, without implementing GitHub write effects or duplicating Rule/Outcome authority.";
  publicInterface = {
    version = "shiftleft-admission.interface.v1";
    exports = [
      { name = "policyctl hash"; kind = "cli"; contract = "Input: policy bundle bytes. Output: deterministic policy hash. Errors: missing/invalid member. Effects: read-only filesystem."; }
      { name = "policyctl observe"; kind = "cli"; contract = "Input: profiles and source fixtures. Output: ShiftLeftObservation JSONL. Errors: missing tool/unsupported/provider failure become unobserved. Effects: declared local provider only, no network."; }
      { name = "policyctl admit"; kind = "cli"; contract = "Input: exact policy ref/hash, normalized observations, base/candidate trees. Output: ShiftLeftReceipt. Errors: blocker/unobserved/mismatch. Effects: receipt file only."; }
      { name = "policyctl verify"; kind = "cli"; contract = "Input: receipt and expected policy/base/candidate identity. Output: PASS. Errors: digest or binding mismatch. Effects: none."; }
    ];
  };
  sourceLayout = {
    core = "packages/shiftleft-admission/internal/admission";
    bin = "packages/shiftleft-admission/cmd/policyctl";
    adapters = "packages/shiftleft-admission/adapters";
    policy = "packages/shiftleft-admission/policy";
    tests = "packages/shiftleft-admission/fixtures and internal/admission/*_test.go";
    rule = "common gate owns no language AST; language adapters emit normalized observations; #114/#115 remain external.";
  };
  allowedPaths = [
    "packages/shiftleft-admission/"
    "flake.nix"
    ".github/workflows/issue-116-shiftleft-proof.yml"
    "build/packages.jsonl"
    "build/checks.jsonl"
  ];
  forbiddenPaths = [
    "GitHub write implementation"
    "Rule or Outcome authority duplication"
    "common AST"
    "tool missing or skipped converted to PASS"
    "mutable policy ref"
  ];
  requiredOutputs = [ "policyctl" "shiftleft-proof artifact" ];
  requiredChecks = [ "issue-116-shiftleft-proof" ];
  requiredCommands = [ "go test ./..." "policyctl proof --bundle policy --fixtures fixtures --policy-ref <commit> --base-tree <tree> --candidate-tree <tree> --out-dir <dir>" ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "shiftleft-admission";
    inputs = [ "policy/*.jsonl" "fixtures/**" "normalized observations" ];
    guarantees = [
      "mutable ref, missing input, and policy hash mismatch fail before admission"
      "public contracts declare input/output/error/effect plus golden/negative routes and current consumers"
      "32 executable fixtures cover all 6 blocker rules; fixtureKinds declarations alone never satisfy SL-TEST-001"
      "JS/Python/Go return the same SL-CORE-001 status and finding meaning"
      "observed unmet remains BLOCKED_RULE rather than being reclassified as unobserved"
      "missing tool, unsupported language, and skipped required test are not Green"
      "clean two-run receipt bytes are identical"
      "receipt is bound to policy/base/candidate identity"
    ];
    failureModes = [
      "false-green-unobserved"
      "language-finding-drift"
      "stale-tree-receipt"
      "mutable-policy-intake"
      "nondeterministic-receipt"
    ];
    evidence = [ "GitHub Actions proof artifact" "provider fixture observations" "receipt.1.json" "receipt.2.json" "proof-summary.json" ];
  };
}
