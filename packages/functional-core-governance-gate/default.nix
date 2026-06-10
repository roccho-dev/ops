{
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "feat";
  packageRole = "implementation";
  artifactKind = "ops-package";
  provides = [
    "functional-core-governance-gate"
    "functional-core-governance-gate-cli"
    "functional-core-governance-v1-checker"
  ];
  requires = [
    "functional-core-governance-gate"
    "adr-jsonl-intent-input"
    "prove-feat"
  ];
  responsibility = "Implement the functional-core governance gate declared by governance-records while keeping pure evaluation in src/functional_core_governance_gate/core.py and filesystem/CLI behavior in adapter/runtime code.";
  mission = "Give governance-records-selected functional-core packages a deterministic static gate for hidden effects and adapter dependency inversion without making language-specific FP style rules mandatory.";
  publicInterface = {
    version = "functional-core-governance-gate.interface.v1";
    exports = [
      { name = "functional-core-governance-gate check"; kind = "cli"; contract = "Validate an explicit functional-core manifest and emit JSON."; }
      { name = "functional_core_governance_gate.core"; kind = "python-lib"; contract = "Pure evaluator from manifest/text inputs to result dicts."; }
    ];
  };
  sourceLayout = {
    src = "packages/functional-core-governance-gate/src/functional_core_governance_gate";
    bin = "packages/functional-core-governance-gate/bin/functional-core-governance-gate";
    example = "packages/functional-core-governance-gate/example/poc/example";
    rule = "src is lib; bin imports src; example/poc/example is explicit fixture/demo only.";
  };
  allowedPaths = [ "packages/functional-core-governance-gate/" "flake.nix" "issues/260603-functional-core-governance-gate.jsonl" ];
  forbiddenPaths = [ "governance-records executable implementation" "policy second checker semantics" "example as default authority" "style mandate rules" ];
  requiredOutputs = [ "packages.<system>.functional-core-governance-gate" ];
  requiredChecks = [ "checks.<system>.functional-core-governance-gate" ];
  requiredCommands = [
    "functional-core-governance-gate check --manifest <manifest.json> --json"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "functional-core-governance-gate";
    inputs = [ "packages/functional-core-governance-gate/default.nix" "packages/functional-core-governance-gate/src/functional_core_governance_gate/" ];
    guarantees = [
      "core evaluator has no filesystem/env/network/clock reads"
      "bin wrapper delegates to library entrypoints"
      "good fixture passes"
      "hidden-effect fixture fails"
      "adapter-dependency fixture fails"
      "example/poc/example is not scanned by default"
    ];
    failureModes = [ "hidden-effect-false-pass" "adapter-dependency-false-pass" "implementation-drift" "example-as-authority" ];
    evidence = [ "python tests" "nix check package" "fixture JSON reports" ];
  };
}
