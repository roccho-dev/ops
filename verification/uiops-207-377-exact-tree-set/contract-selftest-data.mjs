import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GATE_ID,
  INPUT_SCHEMA,
  OPS_CONSUMER_RECEIPT_SCHEMA,
  PROVIDER_SNAPSHOT_SCHEMA,
  UI_PUBLICATION_RECEIPT_SCHEMA,
  canonicalJson,
  sha256,
} from "./contract.mjs";
import { digest, fixtureRoot, git, mobile, ops, ui } from "./contract-selftest-repos.mjs";

function check(context, evaluated, seed, repository, evidenceSha256 = digest("0")) {
  return {
    context,
    runUrl: `https://github.com/${repository}/actions/runs/${1000 + seed}`,
    runId: 1000 + seed,
    runAttempt: 1,
    jobUrl: `https://github.com/${repository}/actions/runs/${1000 + seed}/job/${2000 + seed}`,
    jobId: 2000 + seed,
    expectedHead: evaluated.commit,
    actualHead: evaluated.commit,
    expectedTree: evaluated.tree,
    actualTree: evaluated.tree,
    conclusion: "success",
    evidenceSha256,
  };
}

function pr(repository, number, repo) {
  return {
    repository,
    url: `https://github.com/${repository}/pull/${number}`,
    number,
    state: "open",
    draft: false,
    base: repo.base,
    terminal: repo.terminal,
    evaluated: repo.evaluated,
    merge: { state: "unmerged", commit: null, tree: null },
  };
}

const snapshot = {
  schema: PROVIDER_SNAPSHOT_SCHEMA,
  authority: false,
  capturedAt: "2026-09-14T04:00:00Z",
  stage: "candidate",
  source: { provider: "github", collectorRole: "R", rawSha256: digest("f") },
  issues: {
    ui: {
      repository: "roccho-dev/ui",
      url: "https://github.com/roccho-dev/ui/issues/207",
      number: 207,
      databaseId: 100207,
      nodeId: "I_ui_207",
      state: "open",
      updatedAt: "2026-09-14T03:00:00Z",
      marker: "semantic-map-editor-core-current-v2",
      bodySha256: digest("1"),
    },
    ops: {
      repository: "roccho-dev/ops",
      url: "https://github.com/roccho-dev/ops/issues/377",
      number: 377,
      databaseId: 100377,
      nodeId: "I_ops_377",
      state: "open",
      updatedAt: "2026-09-14T03:00:00Z",
      marker: "OPS_POLICY_APP_UI_PUBLICATION_CUTOVER_003",
      bodySha256: digest("2"),
    },
  },
  repositories: {
    mobileAgent: { repository: "roccho-dev/mobile-agent", evaluated: mobile.evaluated },
  },
  pullRequests: {
    ui: pr("roccho-dev/ui", 211, ui),
    ops: pr("roccho-dev/ops", 378, ops),
  },
  checks: {
    mobileAgent: { required: ["mobile-agent-closure"], evidence: [check("mobile-agent-closure", mobile.evaluated, 1, "roccho-dev/mobile-agent", digest("9"))] },
    ui: { required: ["ui-publication"], evidence: [check("ui-publication", ui.evaluated, 2, "roccho-dev/ui")] },
    ops: { required: ["ops-policy-app"], evidence: [check("ops-policy-app", ops.evaluated, 3, "roccho-dev/ops")] },
  },
  reviews: {
    ui: {
      w: { id: 3001, url: "https://github.com/roccho-dev/ui/pull/211#issuecomment-3001", targetHead: ui.terminal.head, targetTree: ui.terminal.tree, conclusion: "READY_FOR_R" },
      r: { id: 3002, url: "https://github.com/roccho-dev/ui/pull/211#pullrequestreview-3002", targetHead: ui.terminal.head, targetTree: ui.terminal.tree, conclusion: "GREEN", unresolved: 0 },
    },
    ops: {
      w: { id: 4001, url: "https://github.com/roccho-dev/ops/pull/378#issuecomment-4001", targetHead: ops.terminal.head, targetTree: ops.terminal.tree, conclusion: "READY_FOR_R" },
      r: { id: 4002, url: "https://github.com/roccho-dev/ops/pull/378#pullrequestreview-4002", targetHead: ops.terminal.head, targetTree: ops.terminal.tree, conclusion: "GREEN", unresolved: 0 },
    },
  },
};

const artifactBytes = Buffer.from("accepted immutable UI archive\n");
const artifactPath = join(fixtureRoot, "ui-artifact.tgz");
writeFileSync(artifactPath, artifactBytes);
const uiValidatorPath = "verification/policy-app-publication/validate.mjs";
const opsValidatorPath = "verification/policy-app/validate-consumer.mjs";
const uiReceipt = {
  schema: UI_PUBLICATION_RECEIPT_SCHEMA,
  status: "PASS",
  producer: { repository: "roccho-dev/ui", pr: 211, terminal: ui.terminal, evaluated: ui.evaluated },
  contracts: { corePort: "semantic-map-editor-core-port/1", adapter: "semantic-map-maxgraph-adapter/1" },
  publication: {
    locator: { kind: "github-release-asset", url: "https://github.com/roccho-dev/ui/releases/download/test/ui.tgz", immutable: true },
    archive: { name: "ui.tgz", bytes: artifactBytes.length, sha256: sha256(artifactBytes) },
    manifest: { sha256: digest("3") },
    hostClosure: { sha256: digest("4") },
  },
  validation: {
    status: "PASS",
    checkContext: "ui-publication",
    validator: {
      repository: "roccho-dev/ui",
      head: ui.evaluated.commit,
      path: uiValidatorPath,
      blob: git(ui.root, "rev-parse", `${ui.evaluated.commit}:${uiValidatorPath}`),
    },
  },
};
const uiReceiptBytes = Buffer.from(canonicalJson(uiReceipt));
const uiReceiptPath = join(fixtureRoot, "ui-publication-receipt.json");
writeFileSync(uiReceiptPath, uiReceiptBytes);

const opsReceipt = {
  schema: OPS_CONSUMER_RECEIPT_SCHEMA,
  status: "PASS",
  consumer: { repository: "roccho-dev/ops", pr: 378, terminal: ops.terminal, evaluated: ops.evaluated },
  contracts: { policyApp: "ops-policy-app/1" },
  consumedUi: {
    publicationReceiptSha256: sha256(uiReceiptBytes),
    archiveSha256: uiReceipt.publication.archive.sha256,
    producerEvaluatedCommit: ui.evaluated.commit,
    producerEvaluatedTree: ui.evaluated.tree,
    corePortContract: uiReceipt.contracts.corePort,
    adapterContract: uiReceipt.contracts.adapter,
  },
  lock: {
    path: "locks/policy-app-ui.jsonl",
    rows: 1,
    rowSha256: digest("5"),
    locator: uiReceipt.publication.locator,
    archiveSha256: uiReceipt.publication.archive.sha256,
  },
  assembly: {
    receiptSha256: digest("6"),
    outputTreeSha256: digest("7"),
    hostClosureSha256: uiReceipt.publication.hostClosure.sha256,
  },
  packageCheck: {
    system: "x86_64-linux",
    packageAttr: "packages.x86_64-linux.policy-app",
    checkAttr: "checks.x86_64-linux.policy-app",
    packageDrvPath: "/nix/store/example-policy-app.drv",
    checkDrvPath: "/nix/store/example-policy-app.drv",
    sameDerivation: true,
  },
  browser: {
    receiptSha256: digest("8"),
    status: "PASS",
    servedHostClosureSha256: uiReceipt.publication.hostClosure.sha256,
    sourceFallbackUsed: false,
    forbiddenPaths404: true,
  },
  validation: {
    status: "PASS",
    checkContext: "ops-policy-app",
    validator: {
      repository: "roccho-dev/ops",
      head: ops.evaluated.commit,
      path: opsValidatorPath,
      blob: git(ops.root, "rev-parse", `${ops.evaluated.commit}:${opsValidatorPath}`),
    },
  },
};
const opsReceiptBytes = Buffer.from(canonicalJson(opsReceipt));
snapshot.checks.ui.evidence[0].evidenceSha256 = sha256(uiReceiptBytes);
snapshot.checks.ops.evidence[0].evidenceSha256 = sha256(opsReceiptBytes);
const opsReceiptPath = join(fixtureRoot, "ops-consumer-receipt.json");
writeFileSync(opsReceiptPath, opsReceiptBytes);

function makeInput(provider, uiReceiptValue = uiReceipt, opsReceiptValue = opsReceipt) {
  const providerBytes = Buffer.from(canonicalJson(provider));
  const input = {
    schema: INPUT_SCHEMA,
    authority: false,
    gate: GATE_ID,
    stage: provider.stage,
    providerSnapshot: { schema: PROVIDER_SNAPSHOT_SCHEMA, sha256: sha256(providerBytes) },
    contracts: {
      uiPublicationReceipt: UI_PUBLICATION_RECEIPT_SCHEMA,
      opsConsumerReceipt: OPS_CONSUMER_RECEIPT_SCHEMA,
      corePort: "semantic-map-editor-core-port/1",
      adapter: "semantic-map-maxgraph-adapter/1",
      policyApp: "ops-policy-app/1",
    },
    files: {
      uiPublicationReceiptSha256: sha256(Buffer.from(canonicalJson(uiReceiptValue))),
      opsConsumerReceiptSha256: sha256(Buffer.from(canonicalJson(opsReceiptValue))),
    },
    verifiers: {
      gate: {
        repository: "roccho-dev/ops",
        head: provider.pullRequests.ops.evaluated.commit,
        path: "verification/uiops-207-377-exact-tree-set/verify.mjs",
        blob: git(ops.root, "rev-parse", `${provider.pullRequests.ops.evaluated.commit}:verification/uiops-207-377-exact-tree-set/verify.mjs`),
      },
      presentationSharedVisual: {
        repository: "roccho-dev/ops",
        head: provider.pullRequests.ops.evaluated.commit,
        path: "verification/presentation-shared-visual/verify.mjs",
        blob: git(ops.root, "rev-parse", `${provider.pullRequests.ops.evaluated.commit}:verification/presentation-shared-visual/verify.mjs`),
      },
    },
  };
  return { input, providerBytes };
}

const base = makeInput(snapshot);
const inputPath = join(fixtureRoot, "input.json");
const providerPath = join(fixtureRoot, "provider.json");
writeFileSync(inputPath, canonicalJson(base.input));
writeFileSync(providerPath, base.providerBytes);

export {
  artifactBytes,
  artifactPath,
  base,
  inputPath,
  makeInput,
  opsReceipt,
  opsReceiptBytes,
  opsReceiptPath,
  providerPath,
  snapshot,
  uiReceipt,
  uiReceiptBytes,
  uiReceiptPath,
};
