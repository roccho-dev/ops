import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF=fileURLToPath(import.meta.url),hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const read=p=>JSON.parse(readFileSync(p,"utf8"));
const save=(p,value)=>writeFileSync(p,JSON.stringify(value));
const mode=process.argv[2];

// A small, explicitly non-authoritative provider double. Production never
// accepts its address. Actual Wrangler and actual adapter code use this HTTP
// boundary; no deployment/app success is claimed from its responses.
if(mode==="--server") {
  const artifact=process.argv[3],manifest=read(path.join(artifact,"manifest.json"));
  const worker=readFileSync(path.join(artifact,"worker/worker.mjs"));
  const deployment={id:"fixture-deployment",project_name:"voice-ui",url:"https://fixture.voice-ui.pages.dev/",environment:"production",production_branch:"proposals",
    latest_stage:{name:"deploy",status:"success"},deployment_trigger:{metadata:{branch:"proposals",commit_hash:manifest.sources.apps}},aliases:["https://voice-ui.pages.dev"]};
  const stats={projectReads:0,deployments:0,workerBytesMatched:0,publicReads:0,rejectedAppCalls:0,unexpected:[]};
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,"http://fixture"),p=url.pathname;
      const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
      const json=(result,status=200)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(result));};
      const ok=result=>json({success:true,errors:[],messages:[],result});
      if(p==="/__stats")return json(stats);
      if(p.startsWith("/client/v4/")) {
        if(p.endsWith("/user/tokens/verify"))return ok({id:"fixture",status:"active"});
        if(p.endsWith("/memberships"))return ok([{account:{id:"account-dev-fixture",name:"fixture"},status:"accepted"}]);
        if(p.endsWith("/pages/projects/voice-ui")) {stats.projectReads++;return ok({name:"voice-ui",subdomain:"voice-ui.pages.dev",production_branch:"proposals",deployment_configs:{production:{compatibility_date:"2026-09-01"},preview:{compatibility_date:"2026-09-01"}}});}
        if(p.endsWith("/upload-token"))return ok({jwt:`e30.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString("base64url")}.signature`});
        if(p.endsWith("/pages/assets/check-missing"))return ok([]);
        if(p.endsWith("/pages/assets/upsert-hashes"))return ok({});
        if(p.endsWith("/deployments") && req.method==="POST") {
          const form=await new Response(body,{headers:{"content-type":req.headers["content-type"]}}).formData();
          assert.equal(form.get("branch"),"proposals");assert.equal(form.get("commit_hash"),manifest.sources.apps);
          const files=JSON.parse(form.get("manifest"));
          assert.equal(Object.keys(files).length,manifest.files.filter(row=>row.path.startsWith("site/") && !["site/_headers","site/_redirects","site/_routes.json"].includes(row.path)).length);
          const bundle=form.get("_worker.bundle")??form.get("_worker.js");assert.ok(bundle,"compiled Worker must be uploaded");
          const bytes=Buffer.from(await bundle.arrayBuffer());assert.ok(bytes.includes(worker),"Wrangler must preserve the app-built Worker bytes");
          stats.workerBytesMatched++;stats.deployments++;return ok(deployment);
        }
        if(p.endsWith("/deployments/fixture-deployment"))return ok(deployment);
        stats.unexpected.push(p);return json({success:false,errors:[{code:1000,message:"unrecognized fixture API"}]},400);
      }
      assert.equal(req.headers.authorization,undefined,"public readback/browser must not receive effect token");
      if(p==="/favicon.ico") {res.writeHead(204);return res.end();}
      if(p==="/api/jev") {
        if(body.toString()==="not json")return json({error:"invalid_json"},400);
        stats.rejectedAppCalls++;return json({error:"jev_unavailable"},503);
      }
      // Controlled bootstrap page tests the real packaged browser/HTTP entry,
      // not product behavior. Byte readback uses the actual prebuilt site.
      if((req.headers.accept??"").includes("text/html") && p==="/") {
        res.writeHead(200,{"content-type":"text/html"});return res.end("<!doctype html><script>window.voiceUiReady=true</script>");
      }
      const relative=p==="/"?"index.html":decodeURIComponent(p.slice(1));
      assert.ok(!relative.split("/").includes(".."));
      const bytes=readFileSync(path.join(artifact,"site",relative));stats.publicReads++;
      res.writeHead(200,{"content-type":"application/octet-stream"});res.end(bytes);
    } catch(error) {res.writeHead(500);res.end("fixture rejected request");stats.unexpected.push(error.message);}
  });
  server.listen(0,"127.0.0.1",()=>process.send({port:server.address().port}));
} else if(mode==="--adapter") {
  const [which,configPath,...argv]=process.argv.slice(3),config=read(configPath);
  const pages=await import(pathToFileURL(path.join(config.root,"pages.mjs")));
  const request=read(argv[argv.indexOf("--request")+1]),output=argv[argv.indexOf("--receipt")+1];
  try {
    const result=which==="deploy"?await pages.deploy(request,{wrangler:config.wrangler,api:config.base+"/client/v4"})
      :await pages.readback(request,{fetcher:(url,options)=>fetch(new URL(new URL(url).pathname,config.base),options)});
    save(output,result);
  } catch(error) {console.error(error.message);process.exitCode=1;}
} else {
  const [runtime,artifact,acceptance,wrangler]=process.argv.slice(2);
  const root=path.join(runtime,"share/voice-ui-target-runtime"),config=read(path.join(root,"configuration.json"));
  const {runTargetRuntime}=await import(pathToFileURL(path.join(root,"lib.mjs")));
  const work=mkdtempSync(path.join(tmpdir(),"voice-ui-composed-ci-"));
  const server=fork(SELF,["--server",artifact],{env:{PATH:process.env.PATH},stdio:["ignore","inherit","inherit","ipc"]});
  try {
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("controlled provider startup timed out")),10000);
      server.once("message",m=>{clearTimeout(timer);resolve(m.port);});
      server.once("error",error=>{clearTimeout(timer);reject(error);});
      server.once("exit",code=>{clearTimeout(timer);reject(new Error(`controlled provider exited (${code})`));});
    });
    const base=`http://127.0.0.1:${port}`,testConfig=path.join(work,"transport.json");save(testConfig,{root,base,wrangler});
    const accountId="account-dev-fixture",envsSha="e".repeat(40);
    const exactSource=/^[0-9a-f]{40}$/.test(config.opsSha);
    // --override-input can deliberately remove self.rev in another contract's
    // Nix check. Keep that installed package non-deployable; only the synthetic
    // receipts of this controlled test get an explicitly non-authority identity.
    const opsSha=exactSource?config.opsSha:"f".repeat(40);
    const installed=path.join(runtime,"bin/voice-ui-target-runtime");
    const refused=spawnSync(installed,["--request",path.join(work,"missing-approved-request.json")],
      {encoding:"utf8",env:{PATH:process.env.PATH,HOME:work,TMPDIR:work},timeout:10000});
    assert.equal(refused.status,1);
    assert.match(refused.stderr,exactSource?/runtime request|JSON is unreadable/:/installed ops revision must be an exact/);
    const projection={kind:"envs.projectionReceipt.v1",status:"PASS",envs_sha:envsSha,environment:"dev",capability:"jev-api",
      source:{kind:"public_sops",ref:"ciphertexts/dev-jev-api.sops.yaml",sha256:`sha256:${"4".repeat(64)}`},
      target:{provider:"cloudflare-pages",account_id:accountId,project:"voice-ui",secret_name:"JEV_API_KEY"},
      projector:{workflow:".github/workflows/project-dev-jev-api.yml",adapter:"adapters/jev_api.py"},
      effect:{operation:"cloudflare_pages_secret_put",status:"PASS"},readback:{kind:"secret_name_presence",status:"PASS",present:true},
      workflow:{repository:"roccho-dev/envs",ref:"proposals",run_id:1,run_attempt:1},created_at:"2026-09-29T00:00:00Z"};
    const isolation={kind:"ops.secretEffectBoundary.check.v1",status:"PASS",opsSha,active:1,secretBearingEffects:1,unclassified:0,
      workflows:[{path:".github/workflows/fixture.yml",classification:"secret_bearing_effect"}],
      inputs:{checkerSha256:`sha256:${"1".repeat(64)}`,intentSha256:`sha256:${"2".repeat(64)}`,boundarySha256:`sha256:${"3".repeat(64)}`,workflowTreeSha:"4".repeat(40)}};
    const projectionPath=path.join(work,"projection.json"),isolationPath=path.join(work,"isolation.json");save(projectionPath,projection);save(isolationPath,isolation);
    const executable=p=>({path:p,sha256:hash(readFileSync(p))});
    for(let run=1;run<=2;run++) {
      const output=path.join(work,`run-${run}`);
      const request={kind:"ops.voiceUiTargetRuntimeRequest.v1",expected:{opsSha,appsSha:config.appsSha,envsSha,
        artifactManifestSha256:config.artifactManifestSha256,projectionReceiptSha256:hash(readFileSync(projectionPath)),isolationVerdictSha256:hash(readFileSync(isolationPath)),
        target:{provider:"cloudflare-pages",accountId,project:"voice-ui",branch:"proposals"}},
        inputs:{artifactRoot:artifact,projectionReceipt:projectionPath,isolationVerdict:isolationPath},
        adapters:{deploy:executable(path.join(root,"deploy.mjs")),readback:executable(path.join(root,"readback.mjs")),acceptance:executable(acceptance)},output};
      let observedError;
      try {runTargetRuntime(request,{env:{PATH:process.env.PATH,CLOUDFLARE_ACCOUNT_ID:accountId,CLOUDFLARE_API_TOKEN:"test-effect-token"},
        spawn:(command,args,options)=>{
          if(args[0]===request.adapters.deploy.path||args[0]===request.adapters.readback.path) {
            const which=args[0]===request.adapters.deploy.path?"deploy":"readback";
            const result=spawnSync(process.execPath,[SELF,"--adapter",which,testConfig,...args.slice(1)],{...options,timeout:180000,maxBuffer:4*1024*1024});
            assert.equal(result.status,0,result.stderr);return result;
          }
          assert.equal(command,acceptance);
          const actual=[...args];actual[actual.indexOf("--url")+1]=base+"/";
          const result=spawnSync(command,actual,{...options,timeout:120000,maxBuffer:4*1024*1024});
          assert.equal(result.status,1,result.stderr);assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND|browserType.launch|Executable doesn't exist/);
          return result;
        }});
      } catch(error) {observedError=error;}
      assert.match(observedError?.message??"",/application acceptance failed/);
      assert.equal(read(path.join(output,"deploy.json")).status,"PASS");
      assert.equal(read(path.join(output,"readback.json")).status,"PASS");
      const application=read(path.join(output,"acceptance-1.json"));
      assert.equal(application.status,"RED");assert.equal(application.stage,"application-e2e");
      assert.throws(()=>read(path.join(output,"receipt.json")),"overall PASS must not exist");
    }
    const stats=await (await fetch(base+"/__stats")).json();
    assert.deepEqual(stats.unexpected,[]);assert.equal(stats.deployments,2);assert.equal(stats.workerBytesMatched,2);assert.equal(stats.rejectedAppCalls,2);
    assert.ok(stats.publicReads>0);
    console.log(JSON.stringify({kind:"ops.voiceUiCiBoundary.v1",status:"PASS",actualWranglerStarts:2,exactWorkerUploads:2,realBrowserStarts:2,
      allFileReadbackHosts:4,sourceIdentity:exactSource?"EXACT":"UNVERSIONED_NON_DEPLOYABLE",applicationResult:"RED_EXPECTED",provider:"controlled_fixture",liveEffects:0}));
  } finally {server.kill("SIGTERM");rmSync(work,{recursive:true,force:true});}
}
