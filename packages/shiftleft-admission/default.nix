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
    "git-write-admission-check"
  ];
  requires = [
    "package-lib-level-governance"
    "functional-core-governance-gate"
    "github-exact-commit-ref"
    "ops-git-write-closure"
    "structured-diagnostic"
  ];
  responsibility = "Intake an exact policy bundle, normalize implementation-, language-, and execution-specific evidence, fold met/unmet/unobserved/not-applicable, emit deterministic receipts bound to policy/base/candidate trees, and verify that a live Git worktree still matches a PASS receipt before Git write preparation.";
  mission = "Make code without an exact, evidence-backed Shift Left receipt remain draft, without implementing GitHub write effects, runtime diagnostic behavior, or duplicating Rule/Outcome authority.";
  publicInterface = {
    version = "shiftleft-admission.interface.v1";
    exports = [
      { name = "policyctl hash"; kind = "cli"; contract = "Input: policy bundle bytes. Output: deterministic policy hash. Errors: missing/invalid member. Effects: read-only filesystem."; }
      { name = "policyctl observe"; kind = "cli"; contract = "Input: profiles and source or executable fixtures. Output: ShiftLeftObservation JSONL. Errors: missing tool/unsupported/provider failure become unobserved. Effects: declared local provider only, no network."; }
      { name = "policyctl admit"; kind = "cli"; contract = "Input: exact policy ref/hash, normalized observations, base/candidate trees. Output: ShiftLeftReceipt. Errors: blocker/unobserved/mismatch. Effects: receipt file only."; }
      { name = "policyctl verify"; kind = "cli"; contract = "Input: receipt and expected policy/base/candidate identity. Output: PASS. Errors: digest or binding mismatch. Effects: none."; }
      { name = "policyctl verify-worktree"; kind = "cli"; contract = "Input: PASS receipt, expected policy hash, and Git worktree. Output: worktree verification with actual base/candidate tree and receipt digest. Errors: missing/non-PASS/tampered/stale receipt or invalid worktree. Effects: temporary Git index and unreachable local Git objects only; no worktree or network mutation."; }
    ];
  };
  sourceLayout = {
    core = "packages/shiftleft-admission/internal/admission";
    bin = "packages/shiftleft-admission/cmd/policyctl";
    adapters = "packages/shiftleft-admission/adapters";
    policy = "packages/shiftleft-admission/policy";
    tests = "packages/shiftleft-admission/fixtures, internal/admission/*_test.go, and tests/git-write-admission.sh";
    rule = "common gate owns no language AST or runtime feature; evidence providers emit normalized observations; #114 consumes the worktree-bound check while #115 remains external Rule/Outcome authority.";
  };
  allowedPaths = [
    "packages/shiftleft-admission/"
    "packages/ops-purity/bin/purity.mjs"
    "flake.nix"
    "ci.intent.v1.jsonl"
    ".github/workflows/issue-116-shiftleft-proof.yml"
    "build/packages.jsonl"
    "build/checks.jsonl"
  ];
  forbiddenPaths = [
    "GitHub write effect implementation"
    "Rule or Outcome authority duplication"
    "common AST"
    "runtime diagnostic implementation"
    "tool missing or skipped converted to PASS"
    "mutable policy ref"
  ];
  requiredOutputs = [ "policyctl" "shiftleft-proof artifact" ];
  requiredChecks = [ "issue-116-shiftleft-proof" ];
  requiredCommands = [
    "go test ./..."
    "policyctl proof --bundle policy --fixtures fixtures --policy-ref <commit> --base-tree <tree> --candidate-tree <tree> --out-dir <dir>"
    "policyctl verify-worktree --receipt <receipt> --policy-sha256 <hash> --repo <worktree>"
    "bash tests/git-write-admission.sh"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "shiftleft-admission";
    inputs = [ "policy/*.jsonl" "fixtures/**" "normalized observations" "structured-diagnostic contract and executable boundary" "Git candidate worktree" "ShiftLeftReceipt" ];
    guarantees = [
      "mutable ref, missing input, and policy hash mismatch fail before admission"
      "public contracts declare input/output/error/effect plus golden/negative routes and current consumers"
      "36 executable fixtures cover all 7 blocker rules; fixtureKinds declarations alone never satisfy SL-TEST-001"
      "providers assigned to the same rule return the same status and finding meaning"
      "diagnostic process evidence rejects primary-output pollution and host-owned field forgery without message-token false positives"
      "diagnostic process evidence is bound to the exact structured-diagnostic contract SHA-256"
      "observed unmet remains BLOCKED_RULE rather than being reclassified as unobserved"
      "missing tool, unsupported language, and skipped required test are not Green"
      "clean two-run receipt bytes are identical"
      "receipt is bound to policy/base/candidate identity"
      "#114 prepare passes with the exact PASS receipt and actual worktree tree"
      "#114 prepare emits no effect plan for a wrong candidate tree or missing receipt"
      "the same policy/base/candidate binding can be reverified after the effect plan is fixed"
    ];
    failureModes = [
      "false-green-unobserved"
      "provider-finding-drift"
      "diagnostic-input-closure-missing"
      "stale-tree-receipt"
      "missing-receipt"
      "mutable-policy-intake"
      "nondeterministic-receipt"
    ];
    evidence = [
      "GitHub Actions proof artifact"
      "language-import provider fixture observations"
      "diagnostic-process provider fixture observations"
      "receipt.1.json"
      "receipt.2.json"
      "proof-summary.json"
      "git-write-admission stdout/stderr assertions"
    ];
  };
}
