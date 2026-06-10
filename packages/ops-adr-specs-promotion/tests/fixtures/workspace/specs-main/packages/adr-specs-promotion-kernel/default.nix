{
  name = "adr-specs-promotion-kernel";
  version = "v1";
  specId = "spec.packages.adr-specs-promotion-kernel.v1";

  repoPlacement = "ownRepo";
  repoId = "ops";
  repoCategory = "feat";
  repoSourceUri = "devenv-pkg://repo/ops/target.bundle";
  packageRole = "contract";
  artifactKind = "spec-contract";
  implementationPackageName = "ops-adr-specs-promotion";

  provides = [
    "spec.packages.adr-specs-promotion-kernel.v1"
    "adr-to-specs-promotion-contract"
    "single-spec-issue-scope-contract"
    "spec-record-ledger-contract"
    "nix-projection-readiness-contract"
    "provisional-feat-finding-escalation-contract"
  ];

  requires = [
    "adr-jsonl-intent-input"
    "issue-ledger-unified-kernel"
    "package-contracts"
    "prove-feat"
  ];

  responsibility = "Define how ADR raw records, specs issue records, specs definition records, Nix projections, and feat implementation findings interoperate without collapsing authority boundaries.";
  mission = "Let ADR discussion be required before accepted specs, specs be required before ordinary feat implementation, and implementation discoveries escalate through bounded provisional evidence instead of hidden local tests.";

  allowedPaths = [
    "packages/adr-specs-promotion-kernel/"
    "records/specs/spec.v1.jsonl"
    "records/specs/spec-issue-scope.v1.jsonl"
    "records/specs/spec-promotion.v1.jsonl"
    "issues/260604-adr-specs-promotion-kernel.jsonl"
    "../ops-main/packages/ops-adr-specs-promotion/"
    "../ops-main/spec/implements.json"
    "../ops-main/flake.nix"
    "../adr-main/records/raw/adr.v1.jsonl"
    "../adr-main/records/promoted/purpose-lineage.v1.jsonl"
    "../adr-main/records/promoted/destructive-case.v1.jsonl"
    "../adr-main/records/relations/adr-promotion.v1.jsonl"
  ];

  forbiddenPaths = [
    "specs executable bridge implementation"
    "policy second validator semantics"
    "raw ADR as issue authority"
    "issue closed as spec accepted"
    "generated view as spec authority"
    "Nix deletion before projection parity"
  ];

  packageContents = [
    "packages/adr-specs-promotion-kernel/default.nix"
    "issues/260604-adr-specs-promotion-kernel.jsonl"
    "records/specs/spec.v1.jsonl"
    "records/specs/spec-issue-scope.v1.jsonl"
    "records/specs/spec-promotion.v1.jsonl"
  ];

  authorityModel = {
    kind = "spec.adrSpecsPromotionAuthorityModel.v1";
    adr = "rationale, purpose lineage, destructive case candidate, and raw-to-promoted relations";
    issue = "work lifecycle, review status, owner, blockers, and evidence pointers only";
    specsRecord = "proposed or accepted machine-readable spec definition and promotion state";
    nix = "deterministic projection adapter; not semantic SSOT after specs JSONL parity is introduced";
    feat = "implementation plus TTL-bound provisional findings; not conformance authority until specs accepts the case";
  };

  placementContract = {
    kind = "spec.featPlacementContract.v1";
    owningRepo = "ops";
    implementationPackageName = "ops-adr-specs-promotion";
    implementationPath = "../ops-main/packages/ops-adr-specs-promotion/";
    mustDeclareImplements = {
      file = "../ops-main/spec/implements.json";
      contractId = "spec.packages.adr-specs-promotion-kernel.v1";
      package = "ops-adr-specs-promotion";
    };
    decision = "Use existing ops repo because the contract is an operational bridge/audit feat, not a new product repo.";
    forbidden = [
      "creating a separate repo while repoId is ops"
      "placing executable bridge code inside specs"
      "placing validator semantics inside policy"
    ];
  };

  promotionContract = {
    kind = "spec.adrSpecsPromotionContract.v1";
    ordinaryFlow = [
      "adr.raw.v1"
      "adr.purposeLineage.v1 and adr.destructiveCase.v1"
      "issue.record.v1 opened or updated in specs"
      "spec.issueScope.v1 binds issue to specId"
      "spec.promotion.v1 records proposed promotion"
      "spec.record.v1 becomes proposed or accepted"
      "Nix projection adapter exposes selected fields"
      "feat implementation starts only when placement and promotion state allow it"
    ];
    discoveryFlow = [
      "feat.finding.v1 provisional local evidence"
      "specs issue escalation"
      "ADR raw/update if rationale or destructive case changes"
      "spec.promotion.v1 update"
      "canonical feat conformance after spec acceptance"
    ];
    hardFailures = [
      "raw ADR contains issue lifecycle fields"
      "issue closed is interpreted as spec accepted"
      "missing spec.issueScope.v1 for a single-spec issue"
      "Nix definition thinned before projection parity and omitted-field manifest"
      "provisional feat finding lacks ttl or escalation target"
    ];
  };

  nixCompression = {
    kind = "spec.nixCompressionReadiness.v1";
    currentStatus = "not-yet-compressed";
    projectionAdapterStatus = "proposed-only";
    sourceOfTruthAfterPromotion = "records/specs/spec.v1.jsonl";
    mustExistBeforeDeletion = [
      "spec.record.v1 canonical schema"
      "spec.record.v1 to Nix projection adapter"
      "projection roundtrip digest gate"
      "omitted-field manifest for every removed Nix field"
      "nix flake check evidence in canonical environment"
    ];
    explicitNonClaim = "This proposal does not delete or thin existing Nix definitions.";
  };

  requiredOutputs = [
    "packages.<system>.ops-adr-specs-promotion"
  ];

  requiredChecks = [
    "checks.<system>.ops-adr-specs-promotion"
    "ops-adr-specs-promotion audit --workspace <full-worktree> --json"
  ];

  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "adr-specs-promotion-kernel";
    scope = "package";
    inputs = [
      "packages/adr-specs-promotion-kernel/default.nix"
      "records/specs/spec.v1.jsonl"
      "records/specs/spec-issue-scope.v1.jsonl"
      "records/specs/spec-promotion.v1.jsonl"
    ];
    guarantees = [
      "ADR is not issue status"
      "issue closed is not spec accepted"
      "single-spec issue scope is explicit"
      "feat implementation placement follows repoId ops"
      "Nix compression is not claimed without parity evidence"
    ];
    failureModes = [
      "authority-collapse"
      "issue-as-spec"
      "adr-as-issue"
      "nix-hidden-ssot"
      "wrong-feat-placement"
      "provisional-test-permanent"
    ];
    evidence = [
      "ops-adr-specs-promotion audit JSON"
      "ops-adr-specs-promotion unit tests"
      "issue-ledger workspace audit"
    ];
  };
}
