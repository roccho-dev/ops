#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const cli = path.join(packageRoot, "bin/world-core.py");
const fixtures = path.join(packageRoot, "world/compatibility");
const pythonCommand = process.env.OPS_PYTHON || "python3";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ops-world-core-"));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readJsonl = (file) => fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

function run(args, options = {}) {
  const result = spawnSync(pythonCommand, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function requirePass(result) {
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function requireReject(result, pattern) {
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stderr}${result.stdout}`, pattern);
}

function project(outDir, inputRoot = fixtures) {
  return run([
    "from-fcc",
    "--facts", path.join(inputRoot, "facts.jsonl"),
    "--conditions", path.join(inputRoot, "conditions.jsonl"),
    "--claims", path.join(inputRoot, "claims.jsonl"),
    "--out-dir", outDir,
  ]);
}

function cloneDir(source, target) {
  fs.cpSync(source, target, { recursive: true });
  return target;
}

try {
  const outA = path.join(work, "out-a");
  const outB = path.join(work, "out-b");
  const receiptA = requirePass(project(outA));
  const receiptB = requirePass(project(outB));

  assert.equal(receiptA.status, "PASS");
  assert.equal(receiptA.schema, "world.compatibility.receipt/1");
  assert.equal(receiptA.mapper, "ops.fcc/1");
  assert.deepEqual(receiptA, receiptB);
  assert.deepEqual(
    { items: receiptA.items, claims: receiptA.claims, mappings: receiptA.mappings, relations: receiptA.relations, identities: receiptA.identities, units: receiptA.units, scales: receiptA.scales },
    { items: 3, claims: 30, mappings: 14, relations: 15, identities: 3, units: 2, scales: 1 },
  );

  const generated = [
    "items.jsonl",
    "claims.jsonl",
    "mappings.jsonl",
    "relations.jsonl",
    "identities.jsonl",
    "units.jsonl",
    "scales.jsonl",
    "receipt.json",
    "world.sqlite3",
  ];
  for (const name of generated) {
    assert.equal(sha256(fs.readFileSync(path.join(outA, name))), sha256(fs.readFileSync(path.join(outB, name))), `nondeterministic ${name}`);
  }

  const reverse = path.join(work, "reverse");
  requirePass(run(["to-fcc", "--items", path.join(outA, "items.jsonl"), "--claims", path.join(outA, "claims.jsonl"), "--out-dir", reverse]));
  for (const stream of ["facts", "conditions", "claims"]) {
    assert.equal(
      fs.readFileSync(path.join(reverse, `${stream}.jsonl`), "utf8"),
      fs.readFileSync(path.join(fixtures, `${stream}.jsonl`), "utf8"),
      `${stream} did not reconstruct exactly`,
    );
  }

  const existingFixtures = {
    facts: path.join(packageRoot, "fixtures/facts/segment-001.jsonl"),
    conditions: path.join(packageRoot, "fixtures/conditions/segment-001.jsonl"),
    claims: path.join(packageRoot, "fixtures/claims/segment-001.jsonl"),
  };
  for (const file of Object.values(existingFixtures)) assert.ok(fs.existsSync(file), `missing existing fixture ${file}`);
  const existingA = path.join(work, "existing-a");
  const existingB = path.join(work, "existing-b");
  const projectExisting = (outDir) => run([
    "from-fcc",
    "--facts", existingFixtures.facts,
    "--conditions", existingFixtures.conditions,
    "--claims", existingFixtures.claims,
    "--out-dir", outDir,
  ]);
  const existingReceiptA = requirePass(projectExisting(existingA));
  const existingReceiptB = requirePass(projectExisting(existingB));
  assert.deepEqual(existingReceiptA, existingReceiptB);
  const existingSourceCount = Object.values(existingFixtures)
    .map((file) => readJsonl(file).length)
    .reduce((sum, count) => sum + count, 0);
  assert.equal(existingReceiptA.mappings, existingSourceCount);
  for (const name of ["items.jsonl", "claims.jsonl", "mappings.jsonl", "relations.jsonl", "identities.jsonl", "units.jsonl", "scales.jsonl", "receipt.json", "world.sqlite3"]) {
    assert.equal(sha256(fs.readFileSync(path.join(existingA, name))), sha256(fs.readFileSync(path.join(existingB, name))), `nondeterministic existing fixture ${name}`);
  }
  const existingReverse = path.join(work, "existing-reverse");
  requirePass(run(["to-fcc", "--items", path.join(existingA, "items.jsonl"), "--claims", path.join(existingA, "claims.jsonl"), "--out-dir", existingReverse]));
  for (const stream of ["facts", "conditions", "claims"]) {
    assert.equal(
      fs.readFileSync(path.join(existingReverse, `${stream}.jsonl`), "utf8"),
      fs.readFileSync(existingFixtures[stream], "utf8"),
      `${stream} existing fixture did not reconstruct exactly`,
    );
  }

  const items = readJsonl(path.join(outA, "items.jsonl"));
  assert.equal(items.filter((row) => row.name === "市場A").length, 2, "same name in different domains must not merge");
  assert.equal(new Set(items.filter((row) => row.name === "市場A").map((row) => row.id)).size, 2);

  const relations = new Map(readJsonl(path.join(outA, "relations.jsonl")).map((row) => [row.name, row]));
  assert.deepEqual(relations.get("depends_on").aliases, ["based_on", "depends_on", "grounded_in", "supported_by"]);
  assert.deepEqual(relations.get("supersedes").aliases, ["replaces", "supersedes"]);
  assert.deepEqual(relations.get("contradicts").aliases, ["contradicts", "refutes"]);
  assert.deepEqual(relations.get("result_of").aliases, ["outcome_of", "result_of"]);

  const units = new Map(readJsonl(path.join(outA, "units.jsonl")).map((row) => [row.name, row]));
  assert.deepEqual(units.get("jpy_per_year").aliases, ["JPY/year", "jpy_per_year", "円/年"]);
  assert.deepEqual(units.get("percent").aliases, ["percent"]);

  const sqliteProbe = String.raw`
import json, sqlite3, sys
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
names = ["world_items", "world_claims", "v_world_facts", "v_world_constraints", "v_world_proposals", "v_world_inferences", "world_units", "world_scales"]
result = {name: con.execute(f"select count(*) from {name}").fetchone()[0] for name in names}
result["integrity"] = con.execute("pragma integrity_check").fetchone()[0]
print(json.dumps(result, sort_keys=True, separators=(",", ":")))
`;
  const sqlite = spawnSync(pythonCommand, ["-c", sqliteProbe, path.join(outA, "world.sqlite3")], { encoding: "utf8" });
  if (sqlite.error) throw sqlite.error;
  if (sqlite.status !== 0) throw new Error(`${sqlite.stdout}\n${sqlite.stderr}`);
  assert.deepEqual(JSON.parse(sqlite.stdout), {
    integrity: "ok",
    v_world_constraints: 3,
    v_world_facts: 4,
    v_world_inferences: 1,
    v_world_proposals: 5,
    world_claims: 30,
    world_items: 3,
    world_scales: 1,
    world_units: 2,
  });

  const badType = cloneDir(fixtures, path.join(work, "bad-type"));
  const badTypeFacts = readJsonl(path.join(badType, "facts.jsonl"));
  badTypeFacts[0].record_type = "claim";
  fs.writeFileSync(path.join(badType, "facts.jsonl"), `${badTypeFacts.map((row) => JSON.stringify(row)).join("\n")}\n`);
  requireReject(project(path.join(work, "bad-type-out"), badType), /expected record_type='fact'/);

  const malformed = cloneDir(fixtures, path.join(work, "malformed"));
  fs.appendFileSync(path.join(malformed, "facts.jsonl"), "{not-json}\n");
  requireReject(project(path.join(work, "malformed-out"), malformed), /malformed JSON/);

  const duplicateSource = cloneDir(fixtures, path.join(work, "duplicate-source"));
  const duplicateSourceFacts = fs.readFileSync(path.join(duplicateSource, "facts.jsonl"), "utf8");
  fs.appendFileSync(path.join(duplicateSource, "facts.jsonl"), `${duplicateSourceFacts.split("\n")[0]}\n`);
  requireReject(project(path.join(work, "duplicate-source-out"), duplicateSource), /duplicate FCC id/);

  const unresolvedInput = cloneDir(fixtures, path.join(work, "unresolved-input"));
  const unresolvedClaims = readJsonl(path.join(unresolvedInput, "claims.jsonl"));
  unresolvedClaims[0].rel.push({ target: "missing-record", type: "depends_on" });
  fs.writeFileSync(path.join(unresolvedInput, "claims.jsonl"), `${unresolvedClaims.map((row) => JSON.stringify(row)).join("\n")}\n`);
  requireReject(project(path.join(work, "unresolved-input-out"), unresolvedInput), /unresolved target ref missing-record/);

  const noRelation = cloneDir(outA, path.join(work, "no-relation"));
  const relationRows = readJsonl(path.join(noRelation, "relations.jsonl")).filter((row) => row.name !== "depends_on");
  fs.writeFileSync(path.join(noRelation, "relations.jsonl"), `${relationRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  requireReject(run(["verify", "--items", path.join(noRelation, "items.jsonl"), "--claims", path.join(noRelation, "claims.jsonl"), "--mappings", path.join(noRelation, "mappings.jsonl"), "--relations", path.join(noRelation, "relations.jsonl")]), /unregistered relation depends_on/);

  const badSubject = cloneDir(outA, path.join(work, "bad-subject"));
  const subjectRows = readJsonl(path.join(badSubject, "claims.jsonl"));
  subjectRows.find((row) => row.data?.legacy).subject = "missing-item";
  fs.writeFileSync(path.join(badSubject, "claims.jsonl"), `${subjectRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  requireReject(run(["verify", "--items", path.join(badSubject, "items.jsonl"), "--claims", path.join(badSubject, "claims.jsonl"), "--mappings", path.join(badSubject, "mappings.jsonl"), "--relations", path.join(badSubject, "relations.jsonl")]), /unresolved subject missing-item/);

  const badMapping = cloneDir(outA, path.join(work, "bad-mapping"));
  const mappingRows = readJsonl(path.join(badMapping, "mappings.jsonl"));
  mappingRows[0].outputs.push("missing-output");
  fs.writeFileSync(path.join(badMapping, "mappings.jsonl"), `${mappingRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  requireReject(run(["verify", "--items", path.join(badMapping, "items.jsonl"), "--claims", path.join(badMapping, "claims.jsonl"), "--mappings", path.join(badMapping, "mappings.jsonl"), "--relations", path.join(badMapping, "relations.jsonl")]), /unresolved mapping output missing-output/);

  const badBasis = cloneDir(outA, path.join(work, "bad-basis"));
  const basisRows = readJsonl(path.join(badBasis, "claims.jsonl"));
  basisRows[0].basis = "certain";
  fs.writeFileSync(path.join(badBasis, "claims.jsonl"), `${basisRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  requireReject(run(["verify", "--items", path.join(badBasis, "items.jsonl"), "--claims", path.join(badBasis, "claims.jsonl"), "--mappings", path.join(badBasis, "mappings.jsonl"), "--relations", path.join(badBasis, "relations.jsonl")]), /invalid basis 'certain'/);

  const duplicateItem = cloneDir(outA, path.join(work, "duplicate-item"));
  const itemBytes = fs.readFileSync(path.join(duplicateItem, "items.jsonl"), "utf8");
  fs.writeFileSync(path.join(duplicateItem, "items.jsonl"), `${itemBytes}${itemBytes.split("\n")[0]}\n`);
  requireReject(run(["verify", "--items", path.join(duplicateItem, "items.jsonl"), "--claims", path.join(duplicateItem, "claims.jsonl"), "--mappings", path.join(duplicateItem, "mappings.jsonl"), "--relations", path.join(duplicateItem, "relations.jsonl")]), /duplicate item id/);

  const corpusProof = JSON.parse(fs.readFileSync(path.join(packageRoot, "world/evidence/corpus-proof.json"), "utf8"));
  assert.equal(corpusProof.status, "PASS");
  assert.equal(corpusProof.authority, false);
  assert.equal(corpusProof.proof_zip_sha256, "51ae1e5a8a84f4dfe1b41f8d0d65fff378f0dd1e779cb20848441ef517fee832");
  assert.deepEqual(corpusProof.counts, { claims: 65201, items: 6256, mapper_fields: 8925, mappers: 800, mappings: 10494, source_files: 93, source_records: 10494, source_shapes: 608 });
  assert.deepEqual(corpusProof.mapping_quality, { preserved: 2248, semantic: 3035, structural: 5211 });

  process.stdout.write(`${JSON.stringify({ status: "PASS_WORLD_CORE_COMPATIBILITY", ...receiptA, existingFixtureRecords: existingSourceCount, destructiveCases: 9 })}\n`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
