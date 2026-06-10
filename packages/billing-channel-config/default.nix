{
  repoPlacement = "fixed";
  repoId = "ops";
  repoCategory = "feat";
  packageRole = "implementation";
  artifactKind = "ops-package";
  provides = [
    "billing-channel-config"
    "billing-channel-config-lib"
    "billing-channel-config-core-port-v1"
    "billing-channel-config-core-port-v2"
    "billing-channel-selection-core"
    "billing-channel-adapter-port"
  ];
  requires = [
    "package-contracts"
    "port-adapter-library-governance"
    "functional-core-governance-gate"
  ];
  responsibility = "Provide a reusable billing-channel configuration library whose core selects product billing channels from explicit catalog data and whose port lets Stripe, PAY.JP, bank-transfer, manual-invoice, or future adapters be glued without becoming core authority.";
  mission = "Make new billing channels addable as catalog data plus adapter glue while keeping provider SDKs, secrets, webhooks, invoice state, and network I/O outside the lib/core/port package.";
  publicInterface = {
    version = "billing-channel-config.interface.v2";
    exports = [
      { name = "billing_channel_config.core.select_billing_channel"; kind = "python-lib"; contract = "Pure selection from catalog/request to selected channel; no provider/runtime I/O."; }
      { name = "billing_channel_config.core.validate_catalog"; kind = "python-lib"; contract = "Reject malformed catalogs, hidden product references, generated authority leaks, and runtime secret/endpoint leakage."; }
      { name = "billing_channel_config.core.validate_request"; kind = "python-lib"; contract = "Reject invalid amount, currency, cadence, customer kind, unknown preferred channel, and unknown blocked provider before selection."; }
      { name = "billing_channel_config.core.add_channel"; kind = "python-lib"; contract = "Return patched catalog data so new channels can be declared without core code changes."; }
      { name = "billing_channel_config.port.BillingChannelAdapter"; kind = "port-contract"; contract = "Adapters implement supports/prepare behind the selected channel boundary."; }
      { name = "billing_channel_config.port.validate_prepared_action"; kind = "port-contract"; contract = "Reject adapter actions that change selected channel/provider or mark generated output as authority."; }
      { name = "billing-channel-config validate"; kind = "thin-cli"; contract = "Smoke-check bundled catalog JSON; CLI is wrapper, not package authority."; }
    ];
  };
  sourceLayout = {
    src = "packages/billing-channel-config/src/billing_channel_config";
    core = "packages/billing-channel-config/src/billing_channel_config/core.py";
    port = "packages/billing-channel-config/src/billing_channel_config/port.py";
    catalog = "packages/billing-channel-config/src/billing_channel_config/catalog.py";
    bin = "packages/billing-channel-config/bin/billing-channel-config";
    testRoot = "packages/billing-channel-config/tests";
    example = "packages/billing-channel-config/example/poc/example";
    rule = "src is lib/core/port authority; test root may refer to example adapters as glue; src must not import example/poc/example.";
  };
  channelPolicy = {
    kind = "billingChannelConfig.channelPolicy.v1";
    defaultCatalog = [
      "robot-audit -> stripe-payment-link, fallback stripe-invoice-bank-transfer/bank-transfer-instructions/manual-estimate-invoice"
      "robot-build -> stripe-invoice-bank-transfer, fallback bank-transfer-instructions/manual-estimate-invoice/stripe-payment-link"
      "robot-squad-build -> manual-estimate-invoice, fallback bank-transfer-instructions/stripe-invoice-bank-transfer"
      "robot-retainer -> stripe-recurring-invoice, fallback manual-monthly-invoice/stripe-invoice-bank-transfer"
      "skill-pack -> stripe-payment-link or payjp-checkout when domestic_card_heavy"
    ];
    extensionRule = "Add provider/channel/product catalog data first; add runtime adapter package only when provider SDK, webhooks, lifecycle, audit, or reuse justify promotion.";
    runtimeBoundary = [
      "Stripe/PAY.JP SDK calls stay outside core/port"
      "provider secrets and webhook secrets stay outside catalog"
      "invoice/payment state stays outside catalog"
      "network retries and idempotency stay outside catalog"
      "amount/currency/cadence/product eligibility are core selection constraints, not adapter-side surprises"
      "preferred_channel may only select channels declared for the product"
    ];
  };
  destructiveUsecaseHardening = {
    kind = "billingChannelConfig.destructiveUsecaseHardening.v1";
    semanticsProfile = "billing-channel-config-core-port-v2";
    policy = [
      "all destructive request/catalog/adapter cases are represented as structured diagnostics"
      "adapter examples support exact channel ids and modes, not only provider ids"
      "bank-transfer-instructions exists as provider-independent fallback for Stripe-blocked B2B one-shot flows"
      "generatedIsAuthority remains false for catalog, selection, and prepared actions"
    ];
    evidence = [
      "packages/billing-channel-config/DESTRUCTIVE_USECASES.md"
      "packages/billing-channel-config/tests/test_billing_channel_config.py"
      "artifacts/billing-channel-config-destructive-hardening-260605/check-summary.json"
    ];
  };

  productScopePurposeContribution = {
    kind = "billingChannelConfig.productScopePurposeContribution.v1";
    principle = "Product must know and serve the upper CEO/owner purpose, but only through the billing-channel-config product scope.";
    ultimatePurpose = "Build a high-value corporation through low-cost, high-margin, recursive software products and make a future sale possible.";
    productScope = "Select billing channels, validate catalog/request constraints, expose adapter port, and prove example glue from test-root.";
    directContributionGenerations = [ "Meta^0" "Meta^1" "Meta^2" "Meta^3" "Meta^4" "Meta^5" "Meta^6" ];
    indirectContributionGenerations = [ "Meta^7" "Meta^8" "Meta^9" "Meta^10" ];
    contribution = [
      "turn concrete billing choices into reusable catalog/core/port structure"
      "reduce provider lock-in and payment-channel failure paths"
      "make billing-channel addition cheaper, safer, and testable"
      "create DD-readable evidence for billing-channel repeatability and transferability"
      "contribute indirectly to high-value corporation and future sale only inside billing scope"
    ];
    scopeBoundary = [
      "does not own corporate identity, ownership, contracts, accounting, tax, legal compliance, KPI exports, or exit transaction workflow"
      "does not run Stripe/PAY.JP SDKs, secrets, webhooks, retries, idempotency, live invoice state, or reconciliation"
      "does not claim complete sale readiness; it contributes to saleability through billing optionality and evidence"
    ];
    rejectIf = [
      "claims product is purpose-ignorant"
      "claims this package completes high-value corporation or sale readiness"
      "moves CEO/owner objective, legal, accounting, or DD workflow into billing-channel core"
      "moves secrets/webhooks/live invoice state into lib catalog"
      "lets provider adapter override selected channel/provider authority"
      "treats generated LP/admin UI as billing authority"
    ];
    evidence = [
      "packages/billing-channel-config/PRODUCT_SCOPE_PURPOSE_CONTRIBUTION.md"
      "packages/billing-channel-config/product_scope_purpose_contribution.json"
      "packages/billing-channel-config/tests/test_product_scope_purpose_contribution.py"
      "artifacts/billing-channel-config-product-scope-purpose-contribution-260606/check-summary.json"
    ];
  };

  allowedPaths = [
    "packages/billing-channel-config/"
    "flake.nix"
    "issues/260605-billing-channel-config-lib-core-port.jsonl"
  ];
  forbiddenPaths = [
    "provider secret in src/catalog"
    "Stripe or PAY.JP SDK import in src/core.py"
    "webhook implementation in lib package"
    "runtime invoice state in catalog"
    "example as canonical behavior authority"
    "src importing example/poc/example"
  ];
  requiredOutputs = [ "packages.<system>.billing-channel-config" ];
  requiredChecks = [ "checks.<system>.billing-channel-config" ];
  requiredCommands = [
    "billing-channel-config validate"
    "billing-channel-config select --product robot-audit --amount 55000"
  ];
  checkPackageContract = {
    kind = "spec.checkPackageContract.v1";
    checkId = "billing-channel-config";
    inputs = [
      "packages/billing-channel-config/default.nix"
      "packages/billing-channel-config/src/billing_channel_config/"
      "packages/billing-channel-config/tests/"
      "packages/billing-channel-config/example/poc/example/"
    ];
    guarantees = [
      "default catalog validates with billing-channel-config-core-port-v2"
      "robot-audit selects stripe-payment-link by default"
      "business high-value audit selects stripe-invoice-bank-transfer"
      "robot-retainer recurring selects stripe-recurring-invoice"
      "blocking stripe falls back to manual-monthly-invoice for recurring retainer"
      "blocking stripe for robot-build selects bank-transfer-instructions before manual invoice"
      "domestic-card-heavy skill-pack can select payjp-checkout"
      "new channel/provider can be added as catalog data without core code change"
      "runtime secret, URL, endpoint, and generated-authority leaks are rejected from core catalog"
      "invalid requests are structured failures, not crashes"
      "unsupported currency, amount, and cadence reject candidates before adapter glue"
      "provider/channel disabled states produce diagnostics and deterministic fallback"
      "adapter exceptions, wildcard support, and channel/provider-mismatched prepared actions are rejected"
      "src does not import example/poc/example"
      "test root can refer to example adapters through the port glue"
      "product-scope purpose contribution is explicit without claiming full corporation sale readiness"
    ];
    failureModes = [
      "adapter-as-authority"
      "secret-in-catalog"
      "provider-sdk-in-core"
      "new-channel-requires-core-code-change"
      "example-imported-by-src"
      "webhook-runtime-leak"
      "request-typo-silent-fallback"
      "provider-wildcard-adapter"
      "product-channel-policy-escape"
      "channel-capability-mismatch"
      "preferred-channel-policy-escape"
      "recurring-to-one-shot-fallback"
      "provider-disabled-still-selected"
      "adapter-wildcard-or-generated-authority-leak"
      "overclaim-complete-sale-readiness"
    ];
    evidence = [ "python unittest" "product-scope purpose contribution unittest" "thin CLI smoke" "Nix check package" ];
  };

  saleableCorporationPurposeGate = {
    guarantee = "saleable corporation purpose gate explicitly limits approval to billing subsystem scope";
    failureMode = "overclaim-complete-saleable-corporation";
    evidence = [ "saleable purpose gate unittest" ];
  };
}
