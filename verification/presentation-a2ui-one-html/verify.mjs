#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assembleArtifact,
  canonicalJson,
  parseCanonicalJsonl,
  readArtifactLock,
  sha256File,
  writeAssemblyReceipt,
} from "../../packages/artifact-assembly/src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const lockPath = path.join(repo, "locks/presentation-a2ui-one-html.jsonl");
const criteriaPath = path.join(here, "data/jsonl/criteria.jsonl");
const statusPath = path.join(here, "data/jsonl/status.jsonl");
const openGatesPath = path.join(here, "data/jsonl/open-gates.jsonl");
const proofPath = path.join(here, "evidence/ui-proof-receipt.json");
const receiptPath = path.join(here, "evidence/assembly-receipt.json");
const reportPath = path.join(here, "generated/completion-gates.md");
const invariant = (condition, message) => {
  if (!condition) throw new Error(`presentation-verification: ${message}`);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readRows = (file, label) => parseCanonicalJsonl(fs.readFileSync(file, "utf8"), label);
const exactKeys = (row, keys, label) =>
  invariant(Object.keys(row).sort().join(",") === [...keys].sort().join(","), `${label} fields are invalid`);

const validateRows = () => {
  const criteria = readRows(criteriaPath, "criteria");
  const statuses = readRows(statusPath, "status");
  const openGates = readRows(openGatesPath, "open gates");
  invariant(criteria.length === 46 && statuses.length === 46, "expected 46 criteria and status rows");
  invariant(openGates.length === 5, "expected 5 external open gates");

  const ids = new Set();
  for (const row of criteria) {
    exactKeys(
      row,
      ["blocking", "evidence", "expected", "group", "id", "method", "owner", "requirement"],
      `criterion ${row.id}`,
    );
    invariant(row.blocking === true, `criterion ${row.id} must be blocking`);
    invariant(!ids.has(row.id), `duplicate criterion ${row.id}`);
    ids.add(row.id);
  }
  for (const row of statuses) {
    exactKeys(row, ["id", "note", "status"], `status ${row.id}`);
    invariant(ids.has(row.id), `orphan status ${row.id}`);
    invariant(row.status === "PASS", `status ${row.id} is not PASS`);
  }
  invariant(new Set(statuses.map((row) => row.id)).size === ids.size, "criteria/status ids differ");

  const openIds = new Set();
  for (const row of openGates) {
    exactKeys(
      row,
      ["blocking", "evidenceNeeded", "id", "note", "owner", "requirement", "status"],
      `open gate ${row.id}`,
    );
    invariant(row.blocking === false, `open gate ${row.id} must be non-blocking for repository proof`);
    invariant(row.status === "OPEN", `external gate ${row.id} must remain OPEN`);
    invariant(!ids.has(row.id) && !openIds.has(row.id), `duplicate gate ${row.id}`);
    openIds.add(row.id);
  }
  return { criteria, openGates, statuses };
};

const validateEvidence = () => {
  const [lock] = readArtifactLock(lockPath, { requireComplete: true });
  invariant(
    lock.id === "presentation-a2ui-one-html" && lock.kind === "file" && lock.target === "index.html",
    "lock identity is invalid",
  );
  invariant(lock.version === "0.7.0", "lock version is not the signed publication closure proof");

  const proof = readJson(proofPath);
  invariant(
    proof.schema === "presentation-a2ui-ui-proof/5" && proof.status === "PASS" && proof.authority === false,
    "UI proof envelope is invalid",
  );
  invariant(proof.uiRevision === lock.revision && proof.artifactSha256 === lock.sha256, "UI proof does not match lock");

  const build = proof.build;
  invariant(
    build.schema === "presentation-a2ui-one-html-build-receipt/4" &&
      build.status === "pass" &&
      build.authority === false &&
      build.pageCount === 4 &&
      build.componentPages === 3 &&
      build.urlModulePages === 1,
    "build facts are invalid",
  );
  invariant(build.sha256 === lock.sha256 && Number.isInteger(build.bytes) && build.bytes > 0, "build digest or bytes are invalid");
  invariant(JSON.stringify(build.targetKinds) === JSON.stringify(["component", "url-module"]), "target kinds are invalid");
  invariant(
    build.a2uiMessageCount === 3 && build.moduleManifestCount === 1 && build.presentationCoreIframeDependency === false,
    "A2UI or module routing facts are invalid",
  );
  invariant(JSON.stringify(build.rendererKinds) === JSON.stringify(["iframe-document"]), "renderer kinds are invalid");
  invariant(JSON.stringify(build.rendererVersions) === JSON.stringify(["iframe-document@2"]), "renderer versions are invalid");
  invariant(JSON.stringify(build.lifecycleProtocols) === JSON.stringify(["artifact-module-lifecycle/1"]), "lifecycle protocol is invalid");
  invariant(build.readinessRequired === true, "module readiness must be required");
  invariant(
    JSON.stringify(build.sourcePolicyKinds) === JSON.stringify(["https", "inline-html", "relative"]),
    "source policy kinds are invalid",
  );
  invariant(build.sandbox.allowScripts === true && build.sandbox.allowSameOrigin === false, "sandbox facts are invalid");
  invariant(
    build.publicationPolicy?.signed === true &&
      build.publicationPolicy?.artifactBound === true &&
      build.publicationPolicy?.algorithm === "RS256" &&
      build.publicationPolicy?.policySchema === "artifact-publication-policy/2" &&
      JSON.stringify(build.publicationPolicy?.audienceModes) === JSON.stringify(["portable", "exact"]),
    "publication policy build facts are invalid",
  );
  invariant(
    build.artifactReference?.digest === "sha256" &&
      build.artifactReference?.policyBoundOrigin === true &&
      build.artifactReference?.maximumBytes === 8 * 1024 * 1024,
    "artifact reference build facts are invalid",
  );
  invariant(build.noRedeployCustomerUrls >= 7, "no-redeploy customer URL fixtures are incomplete");
  invariant(build.defaultUrlChars === 5472, "default presentation URL size differs from final proof");

  const browser = proof.browser;
  invariant(
    browser.schema === "presentation-a2ui-browser-proof/4" &&
      browser.status === "pass" &&
      browser.authority === false &&
      browser.artifactSha256 === lock.sha256 &&
      browser.assertions >= 57 &&
      browser.noRedeploy === true,
    "browser facts are invalid",
  );
  invariant(browser.browser?.engine === "chromium", "browser engine is invalid");
  invariant(browser.errors.length === 0 && browser.forbiddenNetworkRequests.length === 0, "browser errors or forbidden requests exist");
  invariant(Number.isInteger(browser.requestCount) && browser.requestCount >= 0, "browser request count is invalid");
  invariant(
    browser.customerDomains?.owner === "https://present.owner.test" &&
      browser.customerDomains?.["customer-a"] === "https://slides.customer-a.test" &&
      browser.customerDomains?.["customer-b"] === "https://slides.customer-b.test",
    "customer-domain proof origins are invalid",
  );
  const requiredAssertions = [
    "same-one-html-owner-and-two-customer-domains",
    "signed-portable-policy",
    "signed-exact-domain-audience",
    "tenant-binding",
    "signed-artifact-digest-binding",
    "external-https-module",
    "manifest-versioned-iframe-adapter",
    "post-message-readiness",
    "opaque-origin-sandbox",
    "reference-plus-sha256",
    "mutated-reference-binding-blocked-before-network",
    "tampered-inline-binding-blocked-before-runtime",
    "disallowed-module-origin-blocked-before-network",
    "wrong-audience-blocked-before-artifact-or-module-network",
    "mobile-layout-and-interaction",
    "enterprise-value-signed-url-runtime",
  ];
  for (const assertion of requiredAssertions) {
    invariant(browser.verified.includes(assertion), `browser assertion missing: ${assertion}`);
  }

  const fixturePath = path.join(here, "evidence", proof.publicationFixtures?.path ?? "");
  invariant(proof.publicationFixtures?.path === "publication-fixtures.json", "publication fixture path is invalid");
  invariant(
    fs.existsSync(fixturePath) && sha256File(fixturePath) === proof.publicationFixtures.sha256,
    "publication fixture evidence differs",
  );
  const fixtures = readJson(fixturePath);
  invariant(
    fixtures.schema === "presentation-publication-fixtures/2" &&
      fixtures.artifactSha256 === lock.sha256 &&
      fixtures.noRedeploy === true &&
      Object.keys(fixtures.urls ?? {}).length >= 7 &&
      typeof fixtures.bindings?.defaultInline === "string" &&
      Object.keys(fixtures.policyBindings ?? {}).length >= 5,
    "publication fixture facts are invalid",
  );
  invariant(
    fixtures.reference?.schema === "artifact-reference/1" &&
      fixtures.reference?.mediaType === "application/json" &&
      typeof fixtures.reference?.sha256 === "string",
    "artifact reference fixture is invalid",
  );

  const enterpriseEvidence = proof.enterpriseValuePublication;
  invariant(
    enterpriseEvidence?.receiptPath === "enterprise-value-example.receipt.json" &&
      enterpriseEvidence?.urlPath === "enterprise-value-example.url.txt",
    "enterprise-value publication evidence paths are invalid",
  );
  const enterpriseReceiptPath = path.join(here, "evidence", enterpriseEvidence.receiptPath);
  const enterpriseUrlPath = path.join(here, "evidence", enterpriseEvidence.urlPath);
  invariant(
    fs.existsSync(enterpriseReceiptPath) && sha256File(enterpriseReceiptPath) === enterpriseEvidence.receiptSha256,
    "enterprise-value receipt evidence differs",
  );
  invariant(
    fs.existsSync(enterpriseUrlPath) && sha256File(enterpriseUrlPath) === enterpriseEvidence.urlSha256,
    "enterprise-value URL evidence differs",
  );
  const enterpriseReceipt = readJson(enterpriseReceiptPath);
  invariant(
    enterpriseReceipt.schema === "enterprise-value-presentation-example-receipt/2" &&
      enterpriseReceipt.status === "pass" &&
      enterpriseReceipt.authority === false &&
      enterpriseReceipt.runtimeConsumable === true &&
      enterpriseReceipt.signedPublication === true &&
      enterpriseReceipt.policyId === "customer-a:enterprise-value-example" &&
      enterpriseReceipt.results?.annualEbitdaDeltaJpy === 4_080_000 &&
      enterpriseReceipt.results?.riskAdjustedContributionJpy === 19_584_000,
    "enterprise-value publication receipt is invalid",
  );
  const enterpriseUrlText = fs.readFileSync(enterpriseUrlPath, "utf8").trim();
  const enterpriseUrl = new URL(enterpriseUrlText);
  invariant(
    enterpriseUrl.origin === "https://slides.customer-a.test" &&
      enterpriseUrl.searchParams.get("page") === "summary" &&
      enterpriseUrl.hash.includes("policy=") &&
      enterpriseUrl.hash.includes("presentation="),
    "enterprise-value URL is not a signed runtime publication",
  );

  const screenshotNames = [
    "browser-proof-customer-a.png",
    "browser-proof-customer-b-mobile.png",
    "browser-proof-blocked-origin.png",
  ];
  for (const name of screenshotNames) {
    const screenshotPath = path.join(here, "evidence", name);
    invariant(typeof proof.screenshots?.[name] === "string", `screenshot digest missing: ${name}`);
    invariant(
      fs.existsSync(screenshotPath) && sha256File(screenshotPath) === proof.screenshots[name],
      `screenshot evidence differs: ${name}`,
    );
  }

  const receipt = readJson(receiptPath);
  invariant(
    receipt.schema === "roccho.artifact.assembly-receipt/2" && receipt.status === "PASS" && receipt.authority === false,
    "assembly receipt is invalid",
  );
  invariant(
    receipt.inputs.length === 1 &&
      receipt.inputs[0].id === lock.id &&
      receipt.inputs[0].kind === "file" &&
      receipt.inputs[0].revision === lock.revision &&
      receipt.inputs[0].sha256 === lock.sha256,
    "assembly input does not match lock",
  );
  invariant(
    receipt.files.length === 1 && receipt.files[0].path === "index.html" && receipt.files[0].sha256 === lock.sha256,
    "assembly output is not the locked one HTML",
  );
  invariant(receipt.locks.length === 1 && canonicalJson(receipt.locks[0]) === canonicalJson(lock), "assembly lock snapshot differs");
  return { browser, build, enterpriseReceipt, lock, proof, receipt };
};

const report = ({ criteria, openGates, statuses }, { browser, build, enterpriseReceipt, lock, receipt }) => {
  const byId = new Map(statuses.map((row) => [row.id, row]));
  const lines = [
    "# Presentation A2UI one-HTML — completion gates",
    "",
    "> Generated from canonical JSONL and non-authority receipts. Do not hand-edit.",
    "",
    `- Repository gates: **${criteria.length} / ${criteria.length} PASS**`,
    `- External gates: **${openGates.length} OPEN**`,
    "- Product completion: **NOT CLAIMED**",
    `- UI revision: \`${lock.revision}\``,
    `- Artifact SHA-256: \`${lock.sha256}\``,
    `- Artifact: **${build.bytes} bytes**, **${build.pageCount} pages**, **${build.defaultUrlChars} default URL characters**`,
    `- Publication: **RS256 signed**, **${build.noRedeployCustomerUrls} no-redeploy customer URLs**, exact audience supported`,
    `- Enterprise-value publication: **runtime PASS**, EBITDA **${enterpriseReceipt.results.annualEbitdaDeltaJpy} JPY**, risk-adjusted contribution **${enterpriseReceipt.results.riskAdjustedContributionJpy} JPY**`,
    `- Browser: **${browser.assertions} assertions**, **${browser.errors.length} errors**, **${browser.requestCount} routed requests**, **${browser.forbiddenNetworkRequests.length} forbidden requests**`,
    `- OPS output tree SHA-256: \`${receipt.outputTreeSha256}\``,
    "",
    "## Repository gates",
    "",
    "| ID | Group | Owner | Status | Requirement | Evidence | Note |",
    "|---|---|---|---|---|---|---|",
  ];
  const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
  for (const criterion of criteria) {
    const status = byId.get(criterion.id);
    lines.push(
      `| ${cell(criterion.id)} | ${cell(criterion.group)} | ${cell(criterion.owner)} | ${status.status} | ${cell(criterion.requirement)} | ${cell(criterion.evidence)} | ${cell(status.note)} |`,
    );
  }
  lines.push(
    "",
    "## External gates kept open",
    "",
    "| ID | Owner | Status | Requirement | Evidence needed | Note |",
    "|---|---|---|---|---|---|",
  );
  for (const gate of openGates) {
    lines.push(
      `| ${cell(gate.id)} | ${cell(gate.owner)} | ${gate.status} | ${cell(gate.requirement)} | ${cell(gate.evidenceNeeded)} | ${cell(gate.note)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const reproduce = (source) => {
  invariant(typeof source === "string" && source.length > 0, "source index.html is required");
  const [lock] = readArtifactLock(lockPath, { requireComplete: true });
  invariant(sha256File(source) === lock.sha256, "source digest differs from lock");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-a2ui-assembly-"));
  try {
    return assembleArtifact({ lockPath, outputDir: path.join(root, "out"), sources: { [lock.id]: source } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const mode = process.argv[2] ?? "check";
if (mode === "write") {
  const source = process.argv[3];
  const receipt = reproduce(source);
  writeAssemblyReceipt(receiptPath, receipt);
  const rows = validateRows();
  const evidence = validateEvidence();
  fs.writeFileSync(reportPath, report(rows, evidence));
  process.stdout.write(
    `${JSON.stringify({ externalOpen: rows.openGates.length, gates: rows.criteria.length, outputTreeSha256: receipt.outputTreeSha256, status: "PASS" })}\n`,
  );
} else if (mode === "check") {
  const rows = validateRows();
  const evidence = validateEvidence();
  const expected = report(rows, evidence);
  invariant(fs.readFileSync(reportPath, "utf8") === expected, "generated report is stale");
  process.stdout.write(
    `${JSON.stringify({ externalOpen: rows.openGates.length, gates: rows.criteria.length, outputTreeSha256: evidence.receipt.outputTreeSha256, status: "PASS" })}\n`,
  );
} else if (mode === "reproduce") {
  const actual = reproduce(process.argv[3]);
  const expected = readJson(receiptPath);
  invariant(canonicalJson(actual) === canonicalJson(expected), "reproduced receipt differs");
  process.stdout.write(`${JSON.stringify({ outputTreeSha256: actual.outputTreeSha256, status: "PASS" })}\n`);
} else {
  throw new Error(`presentation-verification: unknown mode ${mode}`);
}
