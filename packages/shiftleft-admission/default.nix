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
    "chatpro-local-completion-receipt"
    "git-write-admission-check"
  ];
  requires = [
    "package-lib-level-governance"
    "functional-core-governance-gate"
    "github-exact-commit-ref"
    "ops-git-write-closure"
    "structured-diagnostic"
  ];
  responsibility = "Intake exact or explicitly local policy sources, normalize implementation-, language-, and execution-specific evidence, run declared local tests, fold met/unmet/unobserved/not-applicable, emit deterministic Git- or directory-bound local completion receipts, and verify formal receipts before Git write preparation.";
  mission = "Make Chat Pro code without an exact evidence-backed local completion receipt remain draft while keeping GitHub adoption, runtime diagnostic behavior, and Rule/Outcome authority outside this package.";
  publicInterface = {
    version = "shiftleft-admission.interface.v2";
    exports = [
      { name = "policyctl intake"; kind = "cli"; contract = "Input: materialized exact artifact/commit/release source or explicit local policy experiment, expected source/policy identity, session output. Output: verified policy/adapters/runtime plus session-local intake receipt. Errors: unsafe path, manifest/runtime/policy mismatch, mutable formal identity. Effects: copies verified bytes to a local session only; no network."; }
      { name = "policyctl run"; kind = "cli"; contract = "Input: verified intake session, local workspace, task/package contract, language profile. Output: Observations, native-test evidence, diagnostics, and deterministic local completion receipt. Errors: missing policy/tool/test, unmet rule, invalid contract, candidate drift. Effects: executes declared local tools and writes evidence outside the workspace; no GitHub write."; }
      { name = "policyctl hash"; kind = "cli"; contract = "Input: policy bundle bytes. Output: deterministic policy hash. Errors: missing/invalid member. Effects: read-only filesystem."; }
      { name = "policyctl observe"; kind = "cli"; contract = "Input: profiles and source or executable fixtures. Output: ShiftLeftObservation JSONL. Errors: missing tool/unsupported/provider failure become unobserved. Effects: declared local provider only, no network."; }
      { name = "policyctl admit"; kind = "cli"; contract = "Input: exact or local policy ref/hash, normalized observations, base/candidate trees. Output: ShiftLeftReceipt. Errors: blocker/unobserved/mismatch. Effects: receipt file only."; }
      { name = "policyctl verify"; kind = "cli"; contract = "Input: receipt and expected policy/base/candidate identity. Output: PASS. Errors: digest or binding mismatch. Effects: none."; }
      { name = "policyctl verify-worktree"; kind = "cli"; contract = "Input: formal exact-commit PASS receipt, expected policy hash, and Git worktree. Output: actual base/candidate tree verification. Errors: local-policy, missing/non-PASS/tampered/stale receipt or invalid worktree. Effects: temporary Git index and unreachable local Git objects only; no worktree or network mutation."; }
    ];
  };
  sourceLayout = {
    core = "packages/shiftleft-admission/internal/admission";
    bin = "packages/shiftleft-admission/cmd/policyctl";
    adapters = "packages/shiftleft-admission/adapters";
    policy = "packages/shiftleft-admission/policy";
    fixtures = "packages/shiftleft-admission/fixtures and local-fixtures";
    tests = "packages/shiftleft-admission/internal/admission/*_test.go and tests/*.sh|*.mjs";
    rule = "common gate owns no language AST or runtime feature; replaceable providers and native tests emit normalized evidence; local completion precedes optional #114 adoption while #115 remains external Rule/Outcome authority.";
  };
  allowedPaths = [
    "packages/shiftleft-admission/"
    "packages/ops-purity/bin/purity.mjs"
    "flake.nix"
    "ci.intent.v1.jsonl"
    ".github/workflows/issue-116-shiftleft-proof.yml"
    ".github/workflows/issue-161-chatpro-local-proof.yml"
    "build/packages.jsonl"
    "build/checks.jsonl"
  ];
  forbiddenPaths = [
    "GitHub write effect implementation"
    "Rule or Outcome authority duplication"
    "common AST"
    "runtime diagnostic implementation"
    "native test runner replacement"
    "tool missing or skipped converted to PASS"
    "mutable formal policy ref"
    "local-experiment receipt accepted for formal Git write"
  ];
  requiredOutputs = [
    "policyctl"
    "shiftleft-proof artifact"
    "issue-161 exact policy-source artifact"
    "issue-161 local completion proof artifact"
  ];
  requiredChecks = [
    "issue-116-shiftleft-proof"
    "issue-161-chatpro-local-proof"
  ];
  requiredCommands = [
    "go test ./..."
    "policyctl intake --source-dir <source> --source-kind <kind> --out-dir <session> ..."
    "policyctl run --session <session> --workspace <workspace> --contract <task.json> --out-dir <evidence>"
    "policyctl proof --bundle policy --fixtures fixtures --policy-ref <commit> --base-tree <tree> --candidate-tree <tree> --out-dir <dir>"
    "policyctl verify-worktree --receipt <receipt> --policy-sha256 <hash> --repo <worktree>"
    "bash tests/git-write-admission.sh"
    "node tests/local-e2e.mjs"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "shiftleft-admission";
    inputs = [
      "policy/*.jsonl"
      "fixtures/**"
      "local-fixtures/**"
      "normalized observations"
      "structured-diagnostic contract and executable boundary"
      "local task/package contract"
      "local Git or directory candidate workspace"
      "ShiftLeftReceipt and local intake/completion receipts"
    ];
    guarantees = [
      "formal artifact intake binds exact artifact id, manifest SHA-256, runtime SHA-256, exact commit, and policy hash"
      "local policy experiments receive a content-derived local-policy-sha256 identity without GitHub mutation"
      "local-experiment receipts are rejected by formal verify-worktree"
      "Python and JavaScript local implementations use the same intake/run entry and completion receipt schema"
      "plain directories receive deterministic sha256-tree identity and arbitrary Git repositories receive actual HEAD/candidate Git trees"
      "declared golden and negative routes map to actually executed native tests"
      "missing policy, missing tool, skipped test, unmet rule, or candidate drift never becomes COMPLETE"
      "same policy, candidate, toolchain, and task contract produce byte-identical semantic completion receipts"
      "artifact-only consumer replay requires neither repository checkout/source build nor GitHub write access"
      "public contracts declare input/output/error/effect plus golden/negative routes and current consumers"
      "36 executable #116 fixtures cover all 7 blocker rules; fixtureKinds declarations alone never satisfy SL-TEST-001"
      "providers assigned to the same rule return the same status and finding meaning"
      "diagnostic process evidence rejects primary-output pollution and host-owned field forgery without message-token false positives"
      "diagnostic process evidence is bound to the exact structured-diagnostic contract SHA-256"
      "observed unmet remains blocked rather than being reclassified as unobserved"
      "#114 prepare passes only with the exact formal PASS receipt and actual worktree tree"
    ];
    failureModes = [
      "false-green-unobserved"
      "provider-finding-drift"
      "diagnostic-input-closure-missing"
      "local-policy-promoted-without-formal-identity"
      "local-candidate-drift"
      "native-test-not-executed"
      "stale-tree-receipt"
      "missing-receipt"
      "mutable-policy-intake"
      "nondeterministic-receipt"
    ];
    evidence = [
      "issue-116 GitHub Actions proof artifact"
      "issue-161 exact policy-source artifact"
      "issue-161 artifact-only replay"
      "Python directory completion receipt"
      "JavaScript Git-worktree completion receipt"
      "local policy experiment receipt"
      "language-import and diagnostic-process provider observations"
      "git-write-admission assertions"
    ];
  };
}
