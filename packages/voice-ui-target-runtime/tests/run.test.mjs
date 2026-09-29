import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { captureIsolation } from "../capture-isolation.mjs";
import { runTargetRuntime } from "../lib.mjs";
import { sanitizedEnv, sha256File } from "../modules/core.mjs";
import { validateArtifact, validateIsolationVerdict, validateProjectionReceipt } from "../modules/input-contracts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../run.mjs");
const OPS_SHA = "1".repeat(40), APPS_SHA = "3".repeat(40);
// Reviewed provider-produced shape, NOT a real deployment receipt.
// envs#16, d0bfafec05c467c8ebd89ed75c4abe8a6b8c8477:
// adapters/jev_api.py::build_receipt. Dummy account, digest and run values only.
const projection = () => JSON.parse(readFileSync(path.join(HERE, "fixtures/envs-projection.json"), "utf8"));
const ENVS_SHA = projection().envs_sha;
const ACCOUNT_ID = projection().target.account_id;
const digest = value => createHash("sha256").update(value).digest("hex");
const read = file => JSON.parse(readFileSync(file, "utf8"));
function write(file, value) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
const effectEnv = () => ({ PATH: process.env.PATH, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: "offline-effect-fixture" });

function isolation() {
  return { kind: "ops.secretEffectBoundary.check.v1", status: "PASS", opsSha: OPS_SHA,
    active: 2, secretBearingEffects: 1, obsolete: 6, unclassified: 0,
    workflows: [{ path: ".github/workflows/check.yml", classification: "secret_free_verify" },
      { path: ".github/workflows/effect.yml", classification: "secret_bearing_effect" }],
    inputs: { checkerSha256: `sha256:${"5".repeat(64)}`, intentSha256: `sha256:${"6".repeat(64)}`,
      boundarySha256: `sha256:${"7".repeat(64)}`, workflowTreeSha: "8".repeat(40) } };
}

// These are deterministic offline process fixtures, not provider adapters.
const preamble = `import fs from "node:fs"; import path from "node:path";
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
const save=value=>fs.writeFileSync(args["--receipt"],JSON.stringify(value));\n`;
// The artifact's acceptance entrypoint is data to ops. If anything ever
// executes it, it leaves this marker, and the tests below fail.
const sentinelCode = marker => `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "executed");\n`;
const deployCode = preamble + `
const r=JSON.parse(fs.readFileSync(args["--request"])),e=r.expected;
save({kind:"ops.voiceUiDeployReceipt.v1",status:"PASS",opsSha:e.opsSha,appsSha:e.appsSha,artifactManifestSha256:e.artifactManifestSha256,target:e.target,
 deployment:{id:"deployment-1",url:"https://deployment-1.voice-ui.pages.dev/",stableUrl:"https://voice-ui.pages.dev/",commitSha:e.appsSha},effect:{status:"PASS"}});
console.log("do-not-forward-effect-output");
`;
const readbackCode = preamble + `
const r=JSON.parse(fs.readFileSync(args["--request"])),e=r.expected;
const files=JSON.parse(fs.readFileSync(path.join(r.artifactRoot,"manifest.json"))).files.filter(row=>row.path.startsWith("site/"));
save({kind:"ops.voiceUiReadbackReceipt.v1",status:"PASS",opsSha:e.opsSha,appsSha:e.appsSha,artifactManifestSha256:e.artifactManifestSha256,
 deploymentId:r.deployment.id,publicBytes:{status:"PASS",fileCount:files.length,files},function:{status:"PASS",path:"/api/jev"}});
`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "voice-ui-target-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactRoot = path.join(root, "artifact"), marker = path.join(root, "artifact-code-executed");
  const contents = new Map([
    ["e2e/runtime-acceptance.mjs", sentinelCode(marker)], ["e2e/public-e2e.mjs", sentinelCode(marker)],
    ["e2e/fixture.wav", "offline wav"], ["e2e/golden.json", "{}\n"],
    ["functions/api/jev.mjs", sentinelCode(marker)], ["site/index.html", "<!doctype html>\n"],
    ["site/app.mjs", sentinelCode(marker)],
    [".envs/artifact.jsonl", JSON.stringify({ artifact: "voice-ui", kind: "artifact.auth.v1", requiredCapabilities: ["jev-api"] }) + "\n"],
  ]);
  for (const [name, text] of contents) { const p = path.join(artifactRoot, name); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); }
  const manifest = { schema: "voice-ui-dist/1", sources: { apps: APPS_SHA }, auth: ".envs/artifact.jsonl",
    e2e: { runtime_entrypoint: "e2e/runtime-acceptance.mjs", public_entrypoint: "e2e/public-e2e.mjs", wav: "e2e/fixture.wav", golden: "e2e/golden.json" },
    files: [...contents].map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text), sha256: digest(text) })) };
  write(path.join(artifactRoot, "manifest.json"), manifest);
  const projectionPath = path.join(root, "projection.json"), isolationPath = path.join(root, "isolation.json");
  write(projectionPath, projection()); write(isolationPath, isolation());
  const deploy = path.join(root, "deploy.mjs"), readback = path.join(root, "readback.mjs");
  writeFileSync(deploy, deployCode); writeFileSync(readback, readbackCode);
  const request = { kind: "ops.voiceUiTargetRuntimeRequest.v1",
    expected: { opsSha: OPS_SHA, envsSha: ENVS_SHA, appsSha: APPS_SHA,
      artifactManifestSha256: sha256File(path.join(artifactRoot, "manifest.json")),
      projectionReceiptSha256: sha256File(projectionPath), isolationVerdictSha256: sha256File(isolationPath),
      target: { provider: "cloudflare-pages", accountId: ACCOUNT_ID, project: "voice-ui", branch: "proposals" } },
    inputs: { artifactRoot, projectionReceipt: projectionPath, isolationVerdict: isolationPath },
    adapters: {
      deploy: { path: deploy, sha256: sha256File(deploy) },
      readback: { path: readback, sha256: sha256File(readback) },
    },
    output: path.join(root, "output") };
  return { root, artifactRoot, marker, manifest, request, projectionPath, isolationPath, deploy, readback };
}
function refreshArtifact(f) {
  for (const row of f.manifest.files) { const bytes = readFileSync(path.join(f.artifactRoot, row.path)); row.bytes = bytes.length; row.sha256 = digest(bytes); }
  write(path.join(f.artifactRoot, "manifest.json"), f.manifest);
  f.request.expected.artifactManifestSha256 = sha256File(path.join(f.artifactRoot, "manifest.json"));
}
function beforeEffect(t, mutate, pattern) {
  const f = fixture(t), env = effectEnv(); mutate(f, env); let calls = 0;
  assert.throws(() => runTargetRuntime(f.request, { env, spawn: () => { calls++; return {status:0}; } }), pattern);
  assert.equal(calls, 0);
}

test("current envs#16 contract is accepted; provider-owned paths are opaque evidence", () => {
  const r = projection(); assert.equal(validateProjectionReceipt(r, ENVS_SHA), r);
  r.source.ref = "ciphertexts/renamed.sops.yaml"; r.projector.adapter = "adapters/renamed.py";
  assert.equal(validateProjectionReceipt(r, ENVS_SHA), r); // admission separately pins whole receipt bytes
});
for (const [name, mutate, message] of [
  ["old script schema", r => { r.projector.script = r.projector.adapter; delete r.projector.adapter; }, /projector fields/],
  ["readback missing", r => {r.readback.present=false;}, /readback is not PASS/],
  ["effect unexecuted", r => {r.effect.status="NOT_RUN";}, /effect is not PASS/],
  ["branch instead of SHA", r => {r.envs_sha="proposals";}, /exact 40/],
  ["wrong capability", r => {r.capability="other";}, /capability/],
  ["source traversal", r => {r.source.ref="../secret";}, /evidence path/],
]) test(`projection rejects ${name}`, () => { const r=projection(); mutate(r); assert.throws(()=>validateProjectionReceipt(r,ENVS_SHA),message); });

for (const [name, mutate, message] of [
  ["artifact digest mismatch", f=>{f.request.expected.artifactManifestSha256="f".repeat(64);}, /manifest digest/],
  ["receipt changed after approval", f=>{const r=read(f.projectionPath);r.workflow.run_id++;write(f.projectionPath,r);}, /projection receipt digest/],
  ["isolation changed after approval", f=>{write(f.isolationPath,{...read(f.isolationPath),status:"RED"});}, /isolation verdict digest/],
  ["readback adapter changed", f=>{writeFileSync(f.readback,"// tampered");}, /readback digest mismatch/],
  ["deploy adapter changed", f=>{writeFileSync(f.deploy,"// tampered");}, /deploy digest mismatch/],
  ["acceptance runtime supplied", f=>{f.request.adapters.acceptance={path:process.execPath,sha256:sha256File(process.execPath)};}, /runtime adapters fields differ/],
  ["extra executable supplied", f=>{f.request.adapters.build={path:process.execPath,sha256:sha256File(process.execPath)};}, /runtime adapters fields differ/],
  ["missing readback adapter", f=>{delete f.request.adapters.readback;}, /runtime adapters fields differ/],
  ["no effect capability", (_f,e)=>{delete e.CLOUDFLARE_API_TOKEN;}, /effect capability/],
  ["wrong effect account", (_f,e)=>{e.CLOUDFLARE_ACCOUNT_ID="other";}, /effect account/],
  ["unlisted executable file", f=>{writeFileSync(path.join(f.artifactRoot,"unlisted.mjs"),"// extra");}, /unlisted files/],
  ["artifact symlink", f=>{symlinkSync(path.join(f.artifactRoot,"site"),path.join(f.artifactRoot,"link"));}, /symlink forbidden/],
  ["missing voice fixture declaration", f=>{delete f.manifest.e2e.wav;refreshArtifact(f);}, /wav fixture/],
  ["previous PASS output", f=>{write(path.join(f.request.output,"receipt.json"),{status:"PASS"});}, /output must be empty/],
]) test(`effect count is zero: ${name}`, t=>beforeEffect(t,mutate,message));

test("isolation count, unique paths and source evidence must agree", () => {
  const r=isolation();r.secretBearingEffects=5;assert.throws(()=>validateIsolationVerdict(r,OPS_SHA),/count differs/);
  r.secretBearingEffects=1;r.workflows[1].path=r.workflows[0].path;assert.throws(()=>validateIsolationVerdict(r,OPS_SHA),/not unique/);
});
test("only a bounded environment enters child processes", () => {
  const env=sanitizedEnv({...effectEnv(),NEW_PROVIDER_TOKEN:"secret",NODE_OPTIONS:"--import x",HOME:"/owner",SOPS_AGE_KEY_FILE:"/key"});
  assert.deepEqual(Object.keys(env),["PATH"]);
});
test("native CLI reaches argument admission rather than import failure", () => {
  const r=spawnSync(process.execPath,[CLI],{encoding:"utf8",env:sanitizedEnv(process.env)});
  assert.notEqual(r.status,0);assert.match(r.stderr,/--request is required/);assert.doesNotMatch(r.stderr,/SyntaxError/);
});
test("real offline processes exercise CLI, deploy and readback without claiming acceptance or a live provider", t => {
  const f=fixture(t),req=path.join(f.root,"request.json");write(req,f.request);
  const r=spawnSync(process.execPath,[CLI,"--request",req],{encoding:"utf8",env:{...effectEnv(),NEW_PROVIDER_TOKEN:"not-in-children"}});
  assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/do-not-forward-effect-output/);
  const result=read(path.join(f.request.output,"receipt.json"));
  assert.equal(result.claim,"DEPLOY_READBACK_PASS");
  assert.deepEqual(Object.keys(result.stages).sort(),["deploy","isolation","projection","readback"]);
  assert.equal(result.sources.acceptanceRuntimeSha256,undefined);
  assert.deepEqual(readdirSync(f.request.output).sort(),["deploy.json","readback.json","receipt.json"]);
  assert.equal(existsSync(f.marker),false,"artifact code must never be executed");
});
test("only the package's deploy and readback adapters are started; artifact bytes stay data", t=>{
  const f=fixture(t);
  const commands=[];
  const result=runTargetRuntime(f.request,{env:effectEnv(),spawn:(command,args,options)=>{
    commands.push([command,args[0]]);return spawnSync(command,args,options);
  }});
  assert.equal(result.status,"PASS");
  assert.deepEqual(commands,[[process.execPath,f.deploy],[process.execPath,f.readback]]);
  assert.equal(existsSync(f.marker),false,"artifact code must never be executed");
});
test("partial public readback is not full deployment readback", t=>{
  const f=fixture(t);writeFileSync(f.readback,readbackCode.replace('files.length,files','1,files:files.slice(0,1)'));
  f.request.adapters.readback.sha256=sha256File(f.readback);
  assert.throws(()=>runTargetRuntime(f.request,{env:effectEnv()}),/file set is incomplete/);
});
test("Git-bound capture rejects archive claims and dirty or untracked workflows", t=>{
  const root=mkdtempSync(path.join(tmpdir(),"isolation-source-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const output=path.join(root,"result.json");
  assert.throws(()=>captureIsolation({root,opsSha:OPS_SHA,output}),/Git source checkout/);
  for(const file of ["ci.intent.v1.jsonl","contracts/secret-effect-boundary.v1.jsonl",".github/workflows/check.yml"]) {
    mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),"{}\n");
  }
  const checker=path.join(root,"tools/check-ci-intent-workflow-branches.mjs");mkdirSync(path.dirname(checker));
  writeFileSync(checker,`console.log(${JSON.stringify(JSON.stringify(isolation()))});\n`);
  const git=(...args)=>{const p=spawnSync("git",["-C",root,...args],{encoding:"utf8"});assert.equal(p.status,0,p.stderr);return p.stdout.trim();};
  git("init","-q");git("add",".");git("-c","user.name=fixture","-c","user.email=fixture@example.invalid","commit","-qm","fixture");
  const opsSha=git("rev-parse","HEAD");assert.equal(captureIsolation({root,opsSha,output}).opsSha,opsSha);
  writeFileSync(path.join(root,".github/workflows/extra.yml"),"{}\n");
  assert.throws(()=>captureIsolation({root,opsSha,output}),/committed tree/);
  rmSync(path.join(root,".github/workflows/extra.yml"));writeFileSync(checker,"// tampered\n");
  assert.throws(()=>captureIsolation({root,opsSha,output}),/committed tree/);
});
