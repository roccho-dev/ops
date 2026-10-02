import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { captureIsolation } from "../capture-isolation.mjs";
import { main } from "../entry.mjs";
import { runTargetRuntime } from "../lib.mjs";
import { sanitizedEnv, sha256File } from "../modules/core.mjs";
import { admitProduct, validateArtifact, validateIsolationVerdict, validateProjectionReceipt, validateWorkersTarget } from "../modules/input-contracts.mjs";
import { deploy, readback } from "../workers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../run.mjs");
// The installed runtime's pin and fixed unzip, and the canonical release files a consumer downloads (the Nix check
// passes both). The admission tests use the real published bytes; there is no synthetic product.
const INSTALLED = JSON.parse(readFileSync(path.join(process.env.VOICE_UI_RUNTIME, "share/voice-ui-target-runtime/configuration.json"), "utf8"));
const PRODUCT = process.env.VOICE_UI_PRODUCT;
const PIN = INSTALLED.product, OPS_SHA = "1".repeat(40), APPS_SHA = PIN.proof.merge_sha;
// Never-issued, Workers-shaped EXTERNAL EXPECTATION of the envs handoff. envs does not produce it today.
const projection = () => JSON.parse(readFileSync(path.join(HERE, "fixtures/envs-projection.json"), "utf8"));
const ENVS_SHA = projection().envs_sha;
const ACCOUNT_ID = projection().target.account_id;
const URL_OK = "https://voice-ui-nonproduct-fixture.never-issued-fixture.workers.dev/";
const SETTINGS = { workersDev: true, previewUrls: false, observability: { enabled: false }, tags: [] };
const TARGET = { provider: "cloudflare-workers", accountId: ACCOUNT_ID, workerName: projection().target.worker_name,
  url: URL_OK, nativeDeploySettings: SETTINGS };
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
const deployCode = preamble + `
const r=JSON.parse(fs.readFileSync(args["--request"])),e=r.expected,t=e.target;
save({kind:"ops.voiceUiDeployReceipt.v2",status:"PASS",opsSha:e.opsSha,appsSha:e.appsSha,artifactManifestSha256:e.artifactManifestSha256,target:t,
 preflight:{secrets:["JEV_API_KEY"],presence:"NAME_PRESENT"},settings:{grade:"CLI_READBACK",reported:t.nativeDeploySettings},deployment:{versionId:"version-1",deploymentId:"deployment-1",workerName:t.workerName,url:t.url},effect:{status:"PASS"}});
console.log("do-not-forward-effect-output");
`;
const readbackCode = preamble + `
const r=JSON.parse(fs.readFileSync(args["--request"])),e=r.expected;
const files=JSON.parse(fs.readFileSync(path.join(r.artifactRoot,"manifest.json"))).files.filter(row=>row.path.startsWith("site/"));
save({kind:"ops.voiceUiReadbackReceipt.v2",status:"PASS",opsSha:e.opsSha,appsSha:e.appsSha,artifactManifestSha256:e.artifactManifestSha256,
 versionId:r.deployment.versionId,storedModuleBytes:"NO_CAPABILITY_NOT_RUN",publicBytes:{status:"PASS",fileCount:files.length,files},
 function:{status:"PASS",path:"/api/judge",response:400,error:"invalid_json"}});
`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "voice-ui-target-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const product = path.join(root, "product");
  mkdirSync(product);
  for (const name of readdirSync(PRODUCT)) copyFileSync(path.join(PRODUCT, name), path.join(product, name));
  const projectionPath = path.join(root, "projection.json"), isolationPath = path.join(root, "isolation.json");
  write(projectionPath, projection()); write(isolationPath, isolation());
  const deploy = path.join(root, "deploy.mjs"), readback = path.join(root, "readback.mjs");
  writeFileSync(deploy, deployCode); writeFileSync(readback, readbackCode);
  const request = { kind: "ops.voiceUiTargetRuntimeRequest.v2",
    expected: { opsSha: OPS_SHA, envsSha: ENVS_SHA, appsSha: APPS_SHA, artifactManifestSha256: PIN.manifestSha256,
      projectionReceiptSha256: sha256File(projectionPath), isolationVerdictSha256: sha256File(isolationPath), target: structuredClone(TARGET) },
    inputs: { product, projectionReceipt: projectionPath, isolationVerdict: isolationPath },
    installed: { product: structuredClone(PIN), unzip: INSTALLED.unzip },
    adapters: {
      deploy: { path: deploy, sha256: sha256File(deploy) },
      readback: { path: readback, sha256: sha256File(readback) },
    },
    output: path.join(root, "output") };
  return { root, product, request, projectionPath, isolationPath, deploy, readback };
}
function beforeEffect(t, mutate, pattern) {
  const f = fixture(t), env = effectEnv(); mutate(f, env); let calls = 0;
  assert.throws(() => runTargetRuntime(f.request, { env, spawn: () => { calls++; return {status:0}; } }), pattern);
  assert.equal(calls, 0);
}
// An admitted copy of the canonical product, for artifact-level negatives on the unpacked tree.
function unpacked(t) {
  const root = mkdtempSync(path.join(tmpdir(), "voice-ui-unpacked-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifact = admitProduct({ directory: PRODUCT, pin: PIN, unzip: INSTALLED.unzip, workdir: root });
  const copy = path.join(root, "copy");
  cpSync(artifact.root, copy, { recursive: true });
  return copy;
}
function rewriteManifest(root, mutate) {
  const file = path.join(root, "manifest.json"), manifest = read(file);
  mutate(manifest); writeFileSync(file, JSON.stringify(manifest));
  return sha256File(file);
}

test("Workers-shaped handoff expectation is accepted; provider-owned paths are opaque evidence", () => {
  const r = projection(); assert.equal(validateProjectionReceipt(r, ENVS_SHA), r);
  r.source.ref = "ciphertexts/renamed.sops.yaml"; r.projector.adapter = "adapters/renamed.py";
  assert.equal(validateProjectionReceipt(r, ENVS_SHA), r); // admission separately pins whole receipt bytes
});
for (const [name, mutate, message] of [
  ["Pages receipt", r => { r.target = { provider: "cloudflare-pages", account_id: ACCOUNT_ID, project: "voice-ui", secret_name: "JEV_API_KEY" }; }, /projection target fields/],
  ["Pages secret effect", r => { r.effect.operation = "cloudflare_pages_secret_put"; }, /effect is not PASS/],
  ["old script schema", r => { r.projector.script = r.projector.adapter; delete r.projector.adapter; }, /projector fields/],
  ["readback missing", r => {r.readback.present=false;}, /readback is not PASS/],
  ["effect unexecuted", r => {r.effect.status="NOT_RUN";}, /effect is not PASS/],
  ["branch instead of SHA", r => {r.envs_sha="proposals";}, /exact 40/],
  ["wrong capability", r => {r.capability="other";}, /capability/],
  ["source traversal", r => {r.source.ref="../secret";}, /evidence path/],
]) test(`projection rejects ${name}`, () => { const r=projection(); mutate(r); assert.throws(()=>validateProjectionReceipt(r,ENVS_SHA),message); });

for (const [name, mutate, message] of [
  ["apps identity differs from the pin", f=>{f.request.expected.appsSha="f".repeat(40);}, /installed product pin/],
  ["manifest digest differs from the pin", f=>{f.request.expected.artifactManifestSha256="f".repeat(64);}, /installed product pin/],
  ["receipt changed after approval", f=>{const r=read(f.projectionPath);r.workflow.run_id++;write(f.projectionPath,r);}, /projection receipt digest/],
  ["isolation changed after approval", f=>{write(f.isolationPath,{...read(f.isolationPath),status:"RED"});}, /isolation verdict digest/],
  ["receipt for another Worker", f=>{const r=read(f.projectionPath);r.target.worker_name="other";write(f.projectionPath,r);f.request.expected.projectionReceiptSha256=sha256File(f.projectionPath);}, /Worker mismatch/],
  ["Pages target", f=>{f.request.expected.target={provider:"cloudflare-pages",accountId:ACCOUNT_ID,project:"voice-ui",branch:"proposals"};}, /expected target fields/],
  ["target URL with a query", f=>{f.request.expected.target.url=`${URL_OK}?x=1`;}, /exactly https:\/\/<workerName>/],
  ["target URL with userinfo", f=>{f.request.expected.target.url=URL_OK.replace("https://","https://user@");}, /exactly https:\/\/<workerName>/],
  ["plain http target URL", f=>{f.request.expected.target.url=URL_OK.replace("https:","http:");}, /exactly https:\/\/<workerName>/],
  ["custom domain target URL", f=>{f.request.expected.target.url="https://voice-ui.example.invalid/";}, /exactly https:\/\/<workerName>/],
  ["another Worker's workers.dev URL", f=>{f.request.expected.target.url="https://other.never-issued-fixture.workers.dev/";}, /exactly https:\/\/<workerName>/],
  ["no settings acknowledgement", f=>{delete f.request.expected.target.nativeDeploySettings;}, /expected target fields differ/],
  ["acknowledgement set to true", f=>{f.request.expected.target.nativeDeploySettings=true;}, /acknowledge exactly/],
  ["acknowledgement with previews on", f=>{f.request.expected.target.nativeDeploySettings.previewUrls=true;}, /acknowledge exactly/],
  ["acknowledgement with an extra key", f=>{f.request.expected.target.nativeDeploySettings.logpush=false;}, /acknowledge exactly/],
  ["acknowledgement missing tags", f=>{delete f.request.expected.target.nativeDeploySettings.tags;}, /acknowledge exactly/],
  ["zip byte changed", f=>{const z=path.join(f.product,"voice-ui-dist.zip"),b=readFileSync(z);b[b.length-1]^=1;writeFileSync(z,b);}, /zip differs from the pinned release/],
  ["proof changed", f=>{const p=path.join(f.product,"merged-pr-proof.json");const q=read(p);q.reviewed_head="0".repeat(40);write(p,q);}, /proof differs from the pinned release/],
  ["provenance changed", f=>{const p=path.join(f.product,"provenance.json");const q=read(p);q.source.tree="0".repeat(40);write(p,q);}, /provenance differs from the pinned release/],
  ["extra operand file", f=>{writeFileSync(path.join(f.product,"voice-ui-acceptance-runtime.nix-export"),"x");}, /exactly the release zip/],
  ["operand symlink", f=>{const z=path.join(f.product,"voice-ui-dist.zip");rmSync(z);symlinkSync(path.join(PRODUCT,"voice-ui-dist.zip"),z);}, /not a regular file/],
  ["pinned reviewed head differs", f=>{f.request.installed.product.proof.reviewed_head="0".repeat(40);}, /reviewed merge/],
  ["pinned acceptance differs", f=>{f.request.installed.product.acceptance.paths=175;}, /acceptance record differs/],
  ["pinned Worker differs", f=>{f.request.installed.product.workerSha256="0".repeat(64);}, /compiled Worker differs/],
  ["no fixed unzip", f=>{f.request.installed.unzip="unzip";}, /fixed unzip/],
  ["readback adapter changed", f=>{writeFileSync(f.readback,"// tampered");}, /readback digest mismatch/],
  ["deploy adapter changed", f=>{writeFileSync(f.deploy,"// tampered");}, /deploy digest mismatch/],
  ["acceptance runtime supplied", f=>{f.request.adapters.acceptance={path:process.execPath,sha256:sha256File(process.execPath)};}, /runtime adapters fields differ/],
  ["extra executable supplied", f=>{f.request.adapters.build={path:process.execPath,sha256:sha256File(process.execPath)};}, /runtime adapters fields differ/],
  ["missing readback adapter", f=>{delete f.request.adapters.readback;}, /runtime adapters fields differ/],
  ["no effect capability", (_f,e)=>{delete e.CLOUDFLARE_API_TOKEN;}, /effect capability/],
  ["wrong effect account", (_f,e)=>{e.CLOUDFLARE_ACCOUNT_ID="f".repeat(32);}, /effect account/],
  ["previous PASS output", f=>{write(path.join(f.request.output,"receipt.json"),{status:"PASS"});}, /output must be empty/],
]) test(`effect count is zero: ${name}`, t=>beforeEffect(t,mutate,message));

// The unpacked tree: an old schema, a changed runtime binding, an unlisted file, a symlink or a missing Worker is refused.
for (const [name, mutate, message] of [
  ["old schema", root=>rewriteManifest(root,m=>{m.schema="voice-ui-dist/1";}), /schema differs/],
  ["runtime binding renamed", root=>rewriteManifest(root,m=>{m.runtime.assets.binding="STATIC";}), /declared Worker runtime differs/],
  ["runtime secret dropped", root=>rewriteManifest(root,m=>{m.runtime.secrets=[];}), /declared Worker runtime differs/],
  ["Worker not listed", root=>rewriteManifest(root,m=>{m.files=m.files.filter(r=>r.path!=="worker/worker.mjs");rmSync(path.join(root,"worker/worker.mjs"));}), /compiled Worker is missing/],
  ["unlisted executable file", root=>{writeFileSync(path.join(root,"unlisted.mjs"),"// extra");return sha256File(path.join(root,"manifest.json"));}, /unlisted files/],
  ["artifact symlink", root=>{symlinkSync(path.join(root,"site"),path.join(root,"link"));return sha256File(path.join(root,"manifest.json"));}, /symlink forbidden/],
]) test(`unpacked product refuses ${name}`, t => {
  const root = unpacked(t);
  assert.equal(validateArtifact(root, APPS_SHA, PIN.manifestSha256).manifest.runtime.main_module, "worker/worker.mjs");
  const manifestSha256 = mutate(root);
  assert.throws(() => validateArtifact(root, APPS_SHA, manifestSha256), message);
});
test("an unversioned or near-miss installed revision refuses a request before the request file is read", () => {
  const missing = path.join(tmpdir(), "voice-ui-no-such-request.json");
  assert.equal(existsSync(missing), false);
  for (const opsSha of ["working-tree", OPS_SHA.toUpperCase().replace(/1/g, "A"), "1".repeat(39), `${OPS_SHA}-dirty`, undefined])
    assert.throws(() => main({ ...INSTALLED, opsSha }, "/nonexistent", ["--request", missing]),
      /^Error: installed ops revision must be an exact 40-character lowercase SHA$/);
  // With an exact revision the same call gets as far as the file, so the order above is the revision guard's.
  assert.throws(() => main({ ...INSTALLED, opsSha: OPS_SHA }, "/nonexistent", ["--request", missing]), /is unreadable/);
});
test("the Workers target is a bare approved https origin", () => {
  assert.equal(validateWorkersTarget({ ...TARGET }).url, TARGET.url);
  for (const url of [`${URL_OK}#x`, `${URL_OK}app`, URL_OK.slice(0, -1), "https://voice-ui-nonproduct-fixture.a.b.workers.dev/",
    "https://voice-ui-nonproduct-fixture.workers.dev/", "https://voice-ui-nonproduct-fixture.never-issued-fixture.workers.dev.example.invalid/"]) {
    assert.throws(() => validateWorkersTarget({ ...TARGET, url }), /exactly https:\/\/<workerName>/, url);
  }
  assert.throws(() => validateWorkersTarget({ ...TARGET, workerName: "Voice UI" }), /Worker name/);
});

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
  assert.deepEqual(result.limits,{targetSettings:"ACKNOWLEDGED_DATA_NOT_AUTHORITY",workerSettings:"CLI_READBACK_PROVIDER_REPORTED",
    secretPresence:"NAME_PRESENT_NOT_AUTHORITY",inheritPreservation:"NOT_PROVEN",storedModuleBytes:"NO_CAPABILITY_NOT_RUN"});
  assert.equal(result.sources.productZipSha256,`sha256:${PIN.zip.sha256}`);
  assert.deepEqual(Object.keys(result.stages).sort(),["deploy","isolation","projection","readback"]);
  assert.equal(result.sources.acceptanceRuntimeSha256,undefined);
  assert.deepEqual(readdirSync(f.request.output).sort(),["deploy.json","readback.json","receipt.json"]);
});
test("only the package's deploy and readback adapters are started; product bytes stay data", t=>{
  const f=fixture(t);
  const commands=[];
  const result=runTargetRuntime(f.request,{env:effectEnv(),spawn:(command,args,options)=>{
    commands.push([command,args[0]]);return spawnSync(command,args,options);
  }});
  assert.equal(result.status,"PASS");
  assert.deepEqual(commands,[[process.execPath,f.deploy],[process.execPath,f.readback]]);
});
for (const [name, from, to] of [
  ["without provider-reported settings", 'settings:{grade:"CLI_READBACK",reported:t.nativeDeploySettings},', ''],
  ["with other provider-reported settings", 'reported:t.nativeDeploySettings', 'reported:{...t.nativeDeploySettings,tags:["kept"]}'],
]) test(`a deploy receipt ${name} cannot become PASS`, t=>{
  const f=fixture(t);writeFileSync(f.deploy,deployCode.replace(from,to));
  f.request.adapters.deploy.sha256=sha256File(f.deploy);
  assert.throws(()=>runTargetRuntime(f.request,{env:effectEnv()}),/settings are missing or differ/);
  assert.equal(existsSync(path.join(f.request.output,"receipt.json")),false);
});
// The adapter's fixed tooling is checked before the authority guard, so a wrong tool is never reported as authority.
test("tooling is refused for its own reason before authority; valid tooling then reaches the authority guard", async t=>{
  const request={kind:"ops.voiceUiEffectRequest.v2",expected:fixture(t).request.expected,artifactRoot:"/nonexistent"};
  const good={cf:INSTALLED.cf,buildOutputUtils:INSTALLED.buildOutputUtils}, noAuthority={PATH:""};
  for (const tooling of [{}, {...good,cf:undefined}, {...good,cf:"cf"}, {...good,cf:`${INSTALLED.cf}-absent`}, {...good,cf:INSTALLED.buildOutputUtils},
    {...good,buildOutputUtils:undefined}, {...good,buildOutputUtils:path.dirname(INSTALLED.cf)}]) {
    await assert.rejects(deploy(request,{...tooling,env:noAuthority}),/fixed cf executable and build-output library required/);
  }
  await assert.rejects(deploy(request,{...good,env:noAuthority}),/effect authority\/target mismatch/);
  await assert.rejects(deploy(request,{...good,env:{...effectEnv(),CLOUDFLARE_ACCOUNT_ID:"f".repeat(32)}}),/effect authority\/target mismatch/);
});
test("a readback is refused before any fetch when the deployment is not the approved target", async t=>{
  const expected=fixture(t).request.expected; let fetches=0;
  await assert.rejects(readback({kind:"ops.voiceUiEffectRequest.v2",expected,artifactRoot:"/nonexistent",
    deployment:{versionId:"v",deploymentId:"d",workerName:TARGET.workerName,url:"https://voice-ui-nonproduct-fixture.other-fixture.workers.dev/"}},
    {fetcher:()=>{fetches++;throw new Error("no fetch");}}),/readback target differs/);
  assert.equal(fetches,0);
});
test("a readback that claims stored module bytes is refused", t=>{
  const f=fixture(t);writeFileSync(f.readback,readbackCode.replace('"NO_CAPABILITY_NOT_RUN"','"PASS"'));
  f.request.adapters.readback.sha256=sha256File(f.readback);
  assert.throws(()=>runTargetRuntime(f.request,{env:effectEnv()}),/stored module bytes cannot be claimed/);
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
