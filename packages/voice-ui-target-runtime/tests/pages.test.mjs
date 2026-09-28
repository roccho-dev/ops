import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deploy, readback, stageArtifact } from "../pages.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),"pages-adapter-test-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const files={"site/index.html":"<!doctype html>exact bytes", "site/app.mjs":"// exact public code",
    "worker/worker.mjs":"export default {fetch(){return new Response('x')}};",
    "functions/api/jev.mjs":"// app source", "e2e/runtime.mjs":"// entry", "e2e/public.mjs":"// public entry",
    "e2e/voice.wav":"fixture", "e2e/golden.json":"{}",
    ".envs/artifact.jsonl":JSON.stringify({artifact:"voice-ui",kind:"artifact.auth.v1",requiredCapabilities:["jev-api"]})};
  for(const [rel,data] of Object.entries(files)) {const p=path.join(root,rel);mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,data);}
  const manifest={schema:"voice-ui-dist/1",sources:{apps:"a".repeat(40)},e2e:{runtime_entrypoint:"e2e/runtime.mjs",public_entrypoint:"e2e/public.mjs",wav:"e2e/voice.wav",golden:"e2e/golden.json"},
    files:Object.entries(files).map(([p,data])=>({path:p,bytes:Buffer.byteLength(data),sha256:sha(data)}))};
  const bytes=JSON.stringify(manifest);writeFileSync(path.join(root,"manifest.json"),bytes);
  const request={kind:"ops.voiceUiEffectRequest.v1",artifactRoot:root,expected:{opsSha:"b".repeat(40),appsSha:"a".repeat(40),artifactManifestSha256:sha(bytes),
    target:{provider:"cloudflare-pages",accountId:"account",project:"voice-ui",branch:"proposals"}}};
  return {root,files,manifest,request};
}
const live={id:"deployment-id",url:"https://aabbccdd.voice-ui.pages.dev/",environment:"production",latest_stage:{name:"deploy",status:"success"},deployment_trigger:{metadata:{commit_hash:"a".repeat(40)}}};
const environment={PATH:process.env.PATH,CLOUDFLARE_API_TOKEN:"test-only-token",CLOUDFLARE_ACCOUNT_ID:"account",UNRELATED_SECRET:"not-forwarded",NODE_OPTIONS:"not-forwarded"};
function operations(f, overrides={}) {
  let calls=0;
  return {
    wrangler:"/fixed/wrangler",env:environment,
    fetcher:async url=>Response.json({success:true,result:String(url).includes("/deployments/")?{...live,...overrides.live}:{name:"voice-ui",production_branch:"proposals",...overrides.project}}),
    execute:(_bin,args,options)=>{
      calls++;
      assert.equal(_bin,"/fixed/wrangler"); assert.ok(args.includes("--no-bundle"));assert.ok(args.includes("--commit-dirty=false"));
      const stage=args[2];assert.equal(readFileSync(path.join(stage,"_worker.js"),"utf8"),f.files["worker/worker.mjs"]);
      assert.equal(options.env.UNRELATED_SECRET,undefined);assert.equal(options.env.NODE_OPTIONS,undefined);
      writeFileSync(options.env.WRANGLER_OUTPUT_FILE_PATH,JSON.stringify({type:"pages-deploy",version:1,pages_project:"voice-ui",deployment_id:live.id,url:live.url})+"\n");
      return {status:0};
    },count:()=>calls,
  };
}
test("actual deploy code stages exact Worker/site and requires provider completion",async t=>{
  const f=fixture(t),ops=operations(f),r=await deploy(f.request,ops);
  assert.equal(r.status,"PASS");assert.equal(ops.count(),1);assert.equal(r.deployment.commitSha,f.request.expected.appsSha);
});
for(const [name,project,observation] of [
  ["wrong production branch",{production_branch:"main"},{}],
  ["unconfirmed deployment",{}, {latest_stage:{name:"deploy",status:"active"}}],
  ["wrong observed source",{}, {deployment_trigger:{metadata:{commit_hash:"f".repeat(40)}}}],
]) test(`deploy rejects ${name}`,async t=>{
  const f=fixture(t),ops=operations(f,{project,live:observation});await assert.rejects(deploy(f.request,ops));
  if(project.production_branch)assert.equal(ops.count(),0);
});
test("wrong account and changed artifact cannot cause a deploy",async t=>{
  const f=fixture(t),ops=operations(f);ops.env={...environment,CLOUDFLARE_ACCOUNT_ID:"other"};
  await assert.rejects(deploy(f.request,ops));assert.equal(ops.count(),0);
  ops.env=environment;writeFileSync(path.join(f.root,"site/index.html"),"tampered");
  await assert.rejects(deploy(f.request,ops));assert.equal(ops.count(),0);
});
test("failed tool never yields a deploy receipt",async t=>{
  const f=fixture(t),ops=operations(f);ops.execute=()=>({status:1});await assert.rejects(deploy(f.request,ops),/failed/);
});
function publicReader(f, corrupt=false) {return async (url,options)=>{
  assert.equal(options.headers.Authorization,undefined);
  const u=new URL(url);
  if(u.pathname==="/api/jev")return Response.json({error:"invalid_json"},{status:400});
  return new Response(corrupt?"wrong":f.files["site/"+(u.pathname==="/"?"index.html":u.pathname.slice(1))]);
};}
test("readback observes complete bytes on both hosts without secrets",async t=>{
  const f=fixture(t),d=await deploy(f.request,operations(f));
  const r=await readback({...f.request,deployment:d.deployment},{fetcher:publicReader(f)});
  assert.equal(r.hosts.length,2);assert.equal(r.publicBytes.fileCount,2);
  assert.equal(r.publicBytes.files[0].sha256,sha(f.files["site/index.html"]));
});
test("changed public bytes, absent auth and cross-origin redirects cannot pass",async t=>{
  const f=fixture(t),d=await deploy(f.request,operations(f)),request={...f.request,deployment:d.deployment};
  await assert.rejects(readback(request,{fetcher:publicReader(f,true)}),/bytes differ/);
  await assert.rejects(readback(request,{fetcher:async(url,opt)=>new URL(url).pathname==="/api/jev"?Response.json({error:"jev_unavailable"},{status:503}):publicReader(f)(url,opt),wait:async()=>{}}),/Function rejection/);
  await assert.rejects(readback(request,{fetcher:async()=>new Response(null,{status:302,headers:{location:"https://other.invalid/"}})}),/cross-origin/);
});
