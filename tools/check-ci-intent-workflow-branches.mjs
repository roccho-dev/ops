#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXACT = "${{ github.sha }}";
const JEV_ORG_WORKFLOW = ".github/workflows/jev-issue-comment.yml";
const JEV_MULTI_GUARD = "github.event_name == 'issue_comment' && github.event.repository.owner.type == 'Organization' && github.event.comment.body == '/jev-evaluate' && ((github.event.issue.pull_request == null && ((github.repository == 'roccho-org/ops' && github.event.issue.number == 483) || (github.repository == 'roccho-org/envs' && github.event.issue.number == 52))) || (github.event.issue.pull_request != null && github.repository == 'roccho-org/ops' && github.event.issue.number == 511))";
const JEV_PLAN_RUN = [
  'set -euo pipefail',
  '"$JEV_NODE" "$JEV_SRC/issue-executor.mjs" plan "$JEV_RUN_DIR"',
  'if [ -f "$JEV_RUN_DIR/plan.json" ]; then',
  "  echo 'planned=true' >> \"$GITHUB_OUTPUT\"",
  'fi',
].join("\n");
const WORKER_EFFECT_WORKFLOW = ".github/workflows/voice-ui-target-runtime.yml";
const WORKER_EFFECT_DEPLOY_SHA = "bce3daab76c9a4565902205cc59bb443f6e68009";
const WORKER_EFFECT_ISOLATION_SHA = "480d32a0e9e0e00ac4675c544e59c2aff325a64c6ae2bc30916e98e4ac1817c7";
const hasSecret = value => /\bsecrets(?:\s*[.\[]|")/.test(JSON.stringify(value));
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const need = (ok, message) => { if (!ok) throw new Error(message); };

// These two existing products do not consume the shared CI registry. Keep
// workflow-edit verification on PRs, but publish only for product-input pushes.
const isolatedProducts = {
  ".github/workflows/artifact-runtime-release.yml": [
    "verification/artifact-runtime-publication/**", "verification/artifact-runtime-app/**",
  ],
  ".github/workflows/ops-task-runtime-release.yml": [
    "packages/ops-task-runtime/**", "packages/gosh/**", "packages/ops-portable-runtime-pack/**",
    "packages/chatgpt-capability/ingress/carrier-job.mjs", "verification/raw-artifact-carry/**",
  ],
};
export function assertIsolatedPublisherPaths(workflow, filename) {
  const products = isolatedProducts[filename];
  if (!products) return;
  const events = workflow.on;
  need(events && typeof events === "object" && !Array.isArray(events), `${filename}: explicit events required`);
  need(same(Object.keys(events), ["pull_request", "push", "workflow_dispatch"]), `${filename}: event set differs`);
  need(Object.hasOwn(events, "workflow_dispatch"), `${filename}: manual entry missing`);
  for (const [event, expected] of [["pull_request", [...products, filename]], ["push", products]]) {
    const filter = events[event];
    need(filter && Array.isArray(filter.paths) && !Object.hasOwn(filter, "paths-ignore"), `${filename}: ${event} explicit paths required`);
    need(filter.paths.length === expected.length && same(filter.paths, expected), `${filename}: ${event} product paths differ`);
  }
  need(same(events.push.branches ?? [], ["proposals"]), `${filename}: product push branch differs`);
  need(!Object.hasOwn(events.push,"branches-ignore"), `${filename}: push branch exclusion forbidden`);
}

// Deliberately bounded admission, not a general GitHub expression interpreter.
// Unknown expression forms fail closed instead of being guessed safe.
function guarded(job, events, allowed, boundary) {
  const guard = typeof job.if === "string" ? job.if.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, "") : "";
  if (boundary?.path === JEV_ORG_WORKFLOW && boundary.secretScope === "organization"
    && guard.replace(/\s+/g, " ") === JEV_MULTI_GUARD
    && same(events, ["issue_comment", "workflow_call"]) && same(allowed, events)) return true;
  if (/[|!()?:]/.test(guard)) return false;
  const parts = guard.split(/\s*&&\s*/);
  return allowed.some(event => {
    const eventOnly = events.length === 1 && events[0] === event;
    if (!eventOnly && !parts.includes(`github.event_name == '${event}'`)) return false;
    if (event === "issue_comment") {
      const callerGate = boundary?.secretScope === "organization"
        ? boundary.path === JEV_ORG_WORKFLOW && parts.includes("github.event.repository.owner.type == 'Organization'")
          && parts.includes("github.event.issue.pull_request == null")
        : parts.includes("github.event.comment.user.login == github.repository_owner");
      return callerGate
        && parts.some(p => /^github\.event\.comment\.body == '[^']+'$/.test(p))
        && parts.some(p => /^github\.event\.issue\.number == [0-9]+$/.test(p));
    }
    return true;
  });
}

export function assertVoiceUiWorkerEffectBridge(workflow) {
  const inputs = workflow?.on?.workflow_dispatch?.inputs;
  need(inputs && inputs.worker_effect?.type === "boolean" && inputs.worker_effect.default === false,
    "voice-ui worker effect input must default false");
  for (const name of ["source_sha","approved_request_b64","approved_request_sha256","projection_receipt_b64","isolation_verdict_b64"])
    need(inputs[name]?.type === "string", "voice-ui worker effect input missing: " + name);

  const job = workflow?.jobs?.["worker-effect"];
  need(job && !job.needs, "voice-ui worker effect must be one independent job");
  const guard = typeof job.if === "string" ? job.if.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, "") : "";
  need(guard === "github.event_name == 'workflow_dispatch' && inputs.worker_effect",
    "voice-ui worker effect guard differs");
  need((typeof job.environment === "string" ? job.environment : job.environment?.name) === "cloudflare-production",
    "voice-ui worker effect Environment differs");
  need(job.permissions?.contents === "read" && Object.keys(job.permissions).length === 1,
    "voice-ui worker effect permissions differ");

  const steps = job.steps ?? [];
  const secretIndexes = steps.map((step,index)=>hasSecret(step)?index:-1).filter(index=>index>=0);
  need(secretIndexes.length === 1, "voice-ui worker effect must have exactly one secret-bearing step");
  const effectIndex = secretIndexes[0], effect = steps[effectIndex];
  need(effect.name === "Run one approved Worker deploy/readback", "voice-ui worker effect step identity differs");
  need(typeof effect.run === "string" && effect.run.includes('voice-ui-target-runtime" --request approved.json'),
    "voice-ui worker effect does not invoke installed approved request");
  need(!/\b(?:curl|gh|git|nix|nix-store|npm|npx|pip)\b/.test(effect.run),
    "voice-ui worker effect step acquires/builds source after secret exposure");
  need(steps.slice(0,effectIndex).every(step=>!hasSecret(step)),
    "voice-ui worker effect exposes secret before source/request preflight");
  for (const step of steps.slice(effectIndex+1)) {
    need(!hasSecret(step), "voice-ui worker post-effect step receives secret");
    if (step.run) need(!/\b(?:curl|gh|git\s+(?:clone|fetch|checkout|switch)|nix\s+(?:build|shell|develop)|nix-build|npm\s+(?:install|ci)|npx|pip\s+install)\b/.test(step.run),
      "voice-ui worker post-effect step acquires/builds source");
  }

  const text = JSON.stringify(job);
  const runText = steps.map(step => step.run ?? "").join("\n");
  for (const required of [
    WORKER_EFFECT_DEPLOY_SHA,
    WORKER_EFFECT_ISOLATION_SHA,
    'test "$GITHUB_REPOSITORY" = "roccho-dev/ops"',
    'test "$GITHUB_REF" = refs/heads/proposals',
    'test "$SOURCE_SHA" = "$GITHUB_SHA"',
    'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
    'test "$PUBLISH_INPUT" != true',
    'test "$CANONICAL_INPUT" != true',
    "effect capability is missing",
    "environmentPhysicalApproval",
    "NOT_PROVEN_BY_SOURCE",
  ]) need(runText.includes(required) || text.includes(JSON.stringify(required).slice(1,-1)), "voice-ui worker effect invariant missing: " + required);
  need(text.includes("actions/checkout@11d5960a326750d5838078e36cf38b85af677262"),
    "voice-ui worker effect checkout pin differs");
  need(text.includes('"ref":"${{ github.sha }}"'),
    "voice-ui worker effect checkout is not exact github.sha");
  need(workflow.jobs["build-test"] && workflow.jobs["voice-ui-cf-consumer-cleanstart"] && workflow.jobs.publish,
    "voice-ui existing build/canonical/publish modes missing");
}

export function analyzeEffectWorkflow(workflow, boundary) {
  const issues = [];
  try {
    need(workflow && typeof workflow === "object", "workflow must be an object");
    need(!/envs-old|envctl\s+auth\s+exec|auth[-_]bundle|old private artifact/i.test(JSON.stringify(workflow)), "historical auth fallback forbidden");
    const events = typeof workflow.on === "string" ? [workflow.on]
      : Array.isArray(workflow.on) ? workflow.on : Object.keys(workflow.on ?? {});
    need(!events.includes("pull_request_target"), "pull_request_target forbidden");
    need(!hasSecret(workflow.env), "workflow-scoped secret forbidden");
    const jobs = workflow.jobs ?? {};
    const effectNames = Object.keys(jobs).filter(name => hasSecret(jobs[name]));
    need(effectNames.length > 0, "declared effect workflow has no visible secret job");
    const allowed = boundary.allowedEvents;
    need(Array.isArray(allowed) && allowed.length > 0
      && allowed.every(event => ["workflow_dispatch", "issue_comment"].includes(event)
        || (event === "workflow_call" && boundary.path === JEV_ORG_WORKFLOW && boundary.secretScope === "organization")),
      "invalid effect event contract");
    const contributing = new Set(), visiting = new Set();
    function visit(name) {
      need(typeof name === "string" && jobs[name], `missing upstream job: ${name}`);
      need(!visiting.has(name), "job dependency cycle");
      if (contributing.has(name)) return;
      visiting.add(name);
      for (const parent of list(jobs[name].needs)) visit(parent);
      visiting.delete(name); contributing.add(name);
    }
    for (const name of effectNames) {
      const job = jobs[name];
      need(guarded(job, events, allowed, boundary), `${name}: automatic or unsupported event guard`);
      if (boundary.secretScope === "organization") {
        const reused = same(events, ["issue_comment", "workflow_call"]) && same(allowed, events);
        need((same(events, ["issue_comment"]) && same(allowed, ["issue_comment"])) || reused,
          `${name}: Org effect is bounded issue-comment/reusable only`);
        if (reused) {
          need(JSON.stringify(workflow.on.workflow_call) === JSON.stringify({secrets:{JEV_API_KEY:{required:true}}}),
            `${name}: reusable contract must pass only the provider slot`);
          const checkout = (job.steps ?? []).filter(step => step.uses?.startsWith("actions/checkout@"));
          need(checkout.length === 1 && checkout[0].with?.repository === "roccho-org/ops"
            && /^[0-9a-f]{40}$/.test(checkout[0].with?.ref ?? "") && checkout[0].with["persist-credentials"] === false,
            `${name}: reusable runtime source must be the fixed Ops commit`);
          const provision = (job.steps ?? []).find(step => step.name === "Resolve fixed jev-review runtime before any credential use");
          need(provision?.run?.includes(`runtime_source=${checkout[0].with.ref}`)
            && provision.run.includes('test "$(git rev-parse HEAD)" = "$runtime_source"')
            && provision.run.includes('echo "JEV_EXECUTION_SOURCE=$runtime_source" >> "$GITHUB_ENV"'),
            `${name}: runtime source must be checked before credential use`);
        }
        need(boundary.path === JEV_ORG_WORKFLOW && boundary.secretName === "JEV_API_KEY"
          && !Object.hasOwn(boundary, "environment") && !Object.hasOwn(job, "environment"), `${name}: Org Secret must not use an Environment`);
        const steps = job.steps ?? [], keyed = steps.filter(hasSecret), plans = steps.filter(step => step.id === "plan");
        need(keyed.length === 1 && plans.length === 1 && steps.indexOf(plans[0]) < steps.indexOf(keyed[0]), `${name}: Org admission must precede the only secret step`);
        need(!hasSecret(plans[0]) && !plans[0].uses && plans[0].shell === "bash"
          && JSON.stringify(plans[0].env) === JSON.stringify({GITHUB_TOKEN:"${{ github.token }}"})
          && plans[0].run?.trim() === JEV_PLAN_RUN, `${name}: Org admission must use the fixed keyless plan`);
        need(keyed[0].if === "steps.plan.outputs.planned == 'true'"
          && JSON.stringify(keyed[0].env) === JSON.stringify({JEV_API_KEY:"${{ secrets.JEV_API_KEY }}"}), `${name}: Org Secret requires an admitted plan`);
      } else {
        need(boundary.secretScope === undefined && typeof boundary.environment === "string" && boundary.environment.length > 0
          && (typeof job.environment === "string" ? job.environment : job.environment?.name) === boundary.environment,
          `${name}: static Environment differs`);
      }
      need(!hasSecret(job.env), `${name}: job-scoped secret forbidden`);
      need(!job.secrets, `${name}: inherited/reusable secrets forbidden`);
      visit(name);
    }
    for (const name of contributing) {
      const job = jobs[name];
      need(!job.uses && !job.strategy, `${name}: reusable jobs/matrix require explicit proof`);
      need(!job["continue-on-error"], `${name}: continue-on-error forbidden`);
      need(Array.isArray(job.steps) && job.steps.length > 0, `${name}: empty execution path`);
      for (const step of job.steps) {
        if (step.if === "github.event_name == 'pull_request'") {
          need(!hasSecret(step), `${name}: PR-only step cannot receive a secret`);
          continue; // all allowed effects above are manual or owner-command events
        }
        need(!step["continue-on-error"], `${name}: continued failure forbidden`);
        if (step.uses) {
          need(typeof step.uses === "string", `${name}: invalid action`);
          const action = step.uses.match(/^([A-Za-z0-9_.\/-]+)@([0-9a-f]{40})$/);
          need(action && !action[1].startsWith("./"), `${name}: all contributing Actions must use full SHA; local/reusable actions need expansion`);
          if (action[1] === "actions/checkout") {
            const fixedJev = boundary.path === JEV_ORG_WORKFLOW && boundary.secretScope === "organization"
              && same(events, ["issue_comment", "workflow_call"]) && step.with?.repository === "roccho-org/ops"
              && /^[0-9a-f]{40}$/.test(step.with?.ref ?? "") && step.with["persist-credentials"] === false;
            if (!fixedJev) {
              need((step.with?.ref ?? EXACT) === EXACT, `${name}: source must equal exact workflow revision, not a variable name or branch`);
              need(!step.with?.repository || step.with.repository === "${{ github.repository }}", `${name}: external checkout requires separate artifact admission`);
            }
          }
        }
        if (step.run) {
          need(typeof step.run === "string", `${name}: invalid run`);
          need(!/\b(?:npx|npm\s+(?:install|ci)|pip\s+install)\b/.test(step.run),
            `${name}: runtime package acquisition must move into an approved fixed closure`);
          need(!/\b(?:git\s+(?:clone|fetch|checkout|switch)|curl[^\n]*\|\s*(?:ba)?sh)\b/.test(step.run),
            `${name}: mutable source or downloaded executable inside effect path`);
        }
      }
    }
    return { issues, contributingJobs: [...contributing].sort() };
  } catch (error) { issues.push(error.message); return { issues, contributingJobs: [] }; }
}

export function selftest() {
  for (const [filename, products] of Object.entries(isolatedProducts)) {
    const isolated = {on:{pull_request:{paths:[...products, filename]},push:{branches:["proposals"],paths:[...products]},workflow_dispatch:null}};
    assertIsolatedPublisherPaths(isolated, filename);
    const mutations = [
      w=>{w.on.push.paths.push("ci.intent.v1.jsonl");},
      w=>{w.on.pull_request.paths.push("ci.intent.v1.jsonl");},
      w=>{w.on.push.paths.push(filename);},
      w=>{w.on.push.paths=["**"];},
      w=>{delete w.on.push.paths;},
      w=>{w.on.push["paths-ignore"]=["unrelated/**"];},
      w=>{w.on.push.paths.pop();},
      w=>{delete w.on.workflow_dispatch;},
      w=>{w.on.pull_request_target={};},
      w=>{w.on.push["branches-ignore"]=["proposals"];},
    ];
    for (const mutate of mutations) {const w=structuredClone(isolated);mutate(w);assert.throws(()=>assertIsolatedPublisherPaths(w,filename));}
    // Bounded literal/prefix representatives, not a general GitHub glob engine.
    const matches = file => products.some(pattern => pattern.endsWith("/**") ? file.startsWith(pattern.slice(0,-2)) : file === pattern);
    for (const pattern of products) assert.ok(matches(pattern.endsWith("/**") ? pattern.slice(0,-2)+"fixture.mjs" : pattern));
    for (const file of ["ci.intent.v1.jsonl",filename,"build/packages.jsonl","build/checks.jsonl","flake.nix","packages/jev/src/batch.mjs"]) assert.equal(matches(file),false);
  }
  const action = "actions/checkout@" + "1".repeat(40);
  const policy = {allowedEvents:["workflow_dispatch"],environment:"cloudflare-production"};
  const safe = {on:{pull_request:{},workflow_dispatch:{}},jobs:{
    materialize:{steps:[{uses:action,with:{ref:EXACT}},{run:"node checked-in-build.mjs"}]},
    effect:{needs:["materialize"],if:"github.event_name == 'workflow_dispatch'",environment:"cloudflare-production",
      steps:[{uses:action,with:{ref:EXACT}},{env:{TOKEN:"${{ secrets.TOKEN }}"},run:"node approved-effect.mjs"}]},
  }};
  assert.deepEqual(analyzeEffectWorkflow(safe,policy).issues,[]);
  const cases = [
    w=>{w.jobs.materialize.steps[0].uses="actions/checkout@v4";},
    w=>{w.jobs.materialize.steps[0].with.ref="proposals";},
    w=>{w.jobs.effect.steps[0].with.ref="${{ needs.materialize.outputs.source_sha }}";},
    w=>{w.jobs.effect.if="github.event_name == 'workflow_dispatch' || true";},
    w=>{w.jobs.effect.if="github.event_name == 'workflow_dispatch' && true ? true : true";},
    w=>{w.jobs.effect.env={TOKEN:"${{ secrets.TOKEN }}"};},
    w=>{w.jobs.effect.environment="${{ inputs.environment }}";},
    w=>{w.jobs.effect.needs=["missing"];},
    w=>{w.jobs.materialize.needs=["effect"];},
    w=>{w.jobs.materialize.steps.push({uses:"./.github/actions/install"});},
    w=>{w.jobs.materialize.steps.push({run:"npx --yes untrusted@1.0.0"});},
    w=>{w.jobs.effect.steps[0]["continue-on-error"]=true;},
    w=>{w.on={pull_request_target:{}};},
    w=>{w.jobs.effect.steps.at(-1).run="envctl auth exec node effect.mjs";},
  ];
  const commentWorkflow=structuredClone(safe);
  commentWorkflow.on={issue_comment:{}};commentWorkflow.jobs.effect.if="github.event_name == 'issue_comment'";
  assert.ok(analyzeEffectWorkflow(commentWorkflow,{...policy,allowedEvents:["issue_comment"]}).issues.length);
  for (const mutate of cases) {const w=structuredClone(safe);mutate(w);assert.ok(analyzeEffectWorkflow(w,policy).issues.length);}
  const orgPolicy = {path:JEV_ORG_WORKFLOW,allowedEvents:["issue_comment"],secretScope:"organization",secretName:"JEV_API_KEY"};
  const org = {on:{issue_comment:{types:["created"]}},jobs:{evaluate:{
    if:"github.event.issue.number == 483 && github.event.repository.owner.type == 'Organization' && github.event.comment.body == '/jev-evaluate' && github.event.issue.pull_request == null",
    steps:[
      {id:"plan",shell:"bash",env:{GITHUB_TOKEN:"${{ github.token }}"},run:JEV_PLAN_RUN},
      {if:"steps.plan.outputs.planned == 'true'",env:{JEV_API_KEY:"${{ secrets.JEV_API_KEY }}"},run:'node fixed-entry.mjs'},
    ],
  }}};
  assert.deepEqual(analyzeEffectWorkflow(org,orgPolicy).issues,[]);
  const orgCases = [
    w=>{w.jobs.evaluate.environment="jev-issue-comment";},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("Organization","User");},
    w=>{delete w.jobs.evaluate.steps[1].if;},
    w=>{w.jobs.evaluate.steps[1].if="true";},
    w=>{w.jobs.evaluate.steps[0].env.JEV_API_KEY="${{ secrets.JEV_API_KEY }}";},
    w=>{w.jobs.evaluate.steps[0].run="echo planned=true >> $GITHUB_OUTPUT";},
    w=>{w.jobs.evaluate.steps.reverse();},
    w=>{w.jobs.evaluate.steps[1].env.EXTRA="${{ secrets.EXTRA }}";},
    w=>{w.on={workflow_dispatch:{}};w.jobs.evaluate.if="github.event_name == 'workflow_dispatch'";},
  ];
  for (const mutate of orgCases) {const w=structuredClone(org);mutate(w);assert.ok(analyzeEffectWorkflow(w,orgPolicy).issues.length);}
  assert.ok(analyzeEffectWorkflow(org,{...orgPolicy,path:".github/workflows/other.yml"}).issues.length);
  assert.ok(analyzeEffectWorkflow(org,{...orgPolicy,secretName:"OTHER"}).issues.length);
  assert.ok(analyzeEffectWorkflow(org,{...orgPolicy,environment:"jev-issue-comment"}).issues.length);
  assert.ok(analyzeEffectWorkflow(org,{...orgPolicy,allowedEvents:["workflow_dispatch"]}).issues.length);
  const reusablePolicy = {...orgPolicy,allowedEvents:["issue_comment","workflow_call"]};
  const reusable = structuredClone(org);
  reusable.on.workflow_call = {secrets:{JEV_API_KEY:{required:true}}};
  reusable.jobs.evaluate.if = JEV_MULTI_GUARD;
  const runtime = "a".repeat(40);
  reusable.jobs.evaluate.steps.unshift(
    {uses:"actions/checkout@11d5960a326750d5838078e36cf38b85af677262",with:{repository:"roccho-org/ops",ref:runtime,"persist-credentials":false}},
    {name:"Resolve fixed jev-review runtime before any credential use",run:`runtime_source=${runtime}\ntest "$(git rev-parse HEAD)" = "$runtime_source"\necho "JEV_EXECUTION_SOURCE=$runtime_source" >> "$GITHUB_ENV"`});
  assert.deepEqual(analyzeEffectWorkflow(reusable,reusablePolicy).issues,[]);
  const reusableCases = [
    w=>{w.on.workflow_call.inputs={program:{type:"string"}};},
    w=>{w.on.workflow_call.secrets.EXTRA={required:true};},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("== 52","== 53");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("roccho-org/envs","other/envs");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("== 511","== 512");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("pull_request != null","pull_request == null");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("pull_request == null","pull_request != null");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("github.event.issue.pull_request != null && ","");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("Organization","User");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("/jev-evaluate","/other");},
    w=>{w.jobs.evaluate.if+=" || true";},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("== 511","== 511 || github.event.issue.number == 512");},
    w=>{w.jobs.evaluate.if=w.jobs.evaluate.if.replace("github.repository == 'roccho-org/ops' && github.event.issue.number == 511","github.event.issue.number == 511");},
    w=>{w.jobs.evaluate.steps[0].with.ref="proposals";},
    w=>{w.jobs.evaluate.steps[0].with.repository="other/ops";},
    w=>{w.jobs.evaluate.steps[0].with["persist-credentials"]=true;},
    w=>{w.jobs.evaluate.steps[1].run="echo ready";},
  ];
  for (const mutate of reusableCases) {const w=structuredClone(reusable);mutate(w);assert.ok(analyzeEffectWorkflow(w,reusablePolicy).issues.length);}
  const parity=structuredClone(safe);
  parity.jobs.materialize.steps.push({if:"github.event_name == 'pull_request'",run:"git clone public-fixture"});
  assert.deepEqual(analyzeEffectWorkflow(parity,policy).issues,[]);
  parity.jobs.materialize.steps.at(-1).env={TOKEN:"${{ secrets.TOKEN }}"};
  assert.ok(analyzeEffectWorkflow(parity,policy).issues.length);
  const bridge = {on:{pull_request:{},workflow_dispatch:{inputs:{
    publish:{type:"boolean",default:false},canonical:{type:"boolean",default:false},
    worker_effect:{type:"boolean",default:false},source_sha:{type:"string"},
    approved_request_b64:{type:"string"},approved_request_sha256:{type:"string"},
    projection_receipt_b64:{type:"string"},isolation_verdict_b64:{type:"string"},
  }}},jobs:{
    "build-test":{steps:[{run:"echo build"}]},
    "voice-ui-cf-consumer-cleanstart":{steps:[{run:"echo canonical"}]},
    publish:{steps:[{run:"echo publish"}]},
    "worker-effect":{
      if:"github.event_name == 'workflow_dispatch' && inputs.worker_effect",
      environment:"cloudflare-production",permissions:{contents:"read"},
      env:{DEPLOY_SHA:WORKER_EFFECT_DEPLOY_SHA,ISOLATION_SHA256:WORKER_EFFECT_ISOLATION_SHA},
      steps:[
        {uses:"actions/checkout@11d5960a326750d5838078e36cf38b85af677262",with:{ref:EXACT}},
        {name:"source preflight",run:'test "$GITHUB_REPOSITORY" = "roccho-dev/ops"; test "$GITHUB_REF" = refs/heads/proposals; test "$SOURCE_SHA" = "$GITHUB_SHA"; test "$(git rev-parse HEAD)" = "$GITHUB_SHA"; test "$PUBLISH_INPUT" != true; test "$CANONICAL_INPUT" != true; echo effect capability is missing; echo environmentPhysicalApproval NOT_PROVEN_BY_SOURCE'},
        {name:"Run one approved Worker deploy/readback",env:{CLOUDFLARE_API_TOKEN:"${{ secrets.CLOUDFLARE_API_TOKEN }}"},run:'"$runtime/bin/voice-ui-target-runtime" --request approved.json'},
        {name:"receipt",run:"node validate-receipt.mjs"},
      ],
    },
  }};
  assertVoiceUiWorkerEffectBridge(bridge);
  const bridgeCases = [
    w=>{w.on.workflow_dispatch.inputs.worker_effect.default=true;},
    w=>{w.jobs["worker-effect"].if="github.event_name == 'pull_request'";},
    w=>{w.jobs["worker-effect"].environment="${{ inputs.environment }}";},
    w=>{w.jobs["worker-effect"].env.DEPLOY_SHA="a".repeat(40);},
    w=>{w.jobs["worker-effect"].steps[1].env={TOKEN:"${{ secrets.TOKEN }}"};},
    w=>{w.jobs["worker-effect"].steps[2].run+='; curl https://example.invalid/source';},
    w=>{w.jobs["worker-effect"].steps[1].run=w.jobs["worker-effect"].steps[1].run.replace('test "$SOURCE_SHA" = "$GITHUB_SHA"; ','');},
    w=>{w.jobs["worker-effect"].steps[3].run="git fetch origin proposals";},
  ];
  for (const mutate of bridgeCases) {const w=structuredClone(bridge);mutate(w);assert.throws(()=>assertVoiceUiWorkerEffectBridge(w));}
  return {positive:3,negative:cases.length+2+bridgeCases.length,publisherIsolation:{positive:2,negative:20},workerEffectBridge:{positive:1,negative:bridgeCases.length},jevOrgAdmission:{positive:1,negative:orgCases.length+4},jevReusableAdmission:{positive:1,negative:reusableCases.length}};
}

export function check(root) {
  const read = p => fs.readFileSync(path.join(root,p),"utf8");
  const jsonl = p => read(p).split(/\r?\n/).filter(s=>s.trim()).map(JSON.parse);
  const intents = jsonl("ci.intent.v1.jsonl").filter(x=>x.kind==="ci.intent.v1" && x.provider==="github-actions");
  const boundaries = jsonl("contracts/secret-effect-boundary.v1.jsonl");
  need(new Set(intents.map(x=>x.path)).size===intents.length,"duplicate CI intents");
  need(new Set(boundaries.map(x=>x.path)).size===boundaries.length,"duplicate effect contracts");
  const byPath=new Map(boundaries.map(x=>[x.path,x]));
  const names=fs.readdirSync(path.join(root,".github/workflows")).filter(n=>/\.ya?ml$/.test(n)).sort().map(n=>`.github/workflows/${n}`);
  const workflows=[],failures=[];
  for(const p of names) {
    const parsed=spawnSync("yq",["-o=json",".",path.join(root,p)],{encoding:"utf8"});
    need(parsed.status===0,`${p}: YAML parser failed; yq-go must be provided by the pinned check closure`);
    const w=JSON.parse(parsed.stdout),intent=intents.find(x=>x.path===p),boundary=byPath.get(p);
    assertIsolatedPublisherPaths(w,p);
    if(p===WORKER_EFFECT_WORKFLOW) {
      try { assertVoiceUiWorkerEffectBridge(w); }
      catch(error) { failures.push(p + ": " + error.message); }
    }
    need(intent,`${p}: no CI intent`);
    const events=typeof w.on==="string"?[w.on]:Array.isArray(w.on)?w.on:Object.keys(w.on??{});
    for(const event of intent.dispatch??[]) need(events.includes(event),`${p}: intent trigger ${event} absent`);
    if(events.includes("push") && intent.dispatch.includes("push")) need(same(intent.push_branches??[],w.on.push?.branches??["*"]),`${p}: push branches differ`);
    const secret=hasSecret(w);
    if(secret) {
      if(boundary?.classification!=="secret_bearing_effect") failures.push(`${p}: unclassified secret path`);
      else failures.push(...analyzeEffectWorkflow(w,boundary).issues.map(s=>`${p}: ${s}`));
    } else if(boundary?.classification==="secret_bearing_effect") failures.push(`${p}: effect declaration without secret job`);
    if(boundary?.classification==="obsolete") failures.push(`${p}: obsolete workflow active`);
    workflows.push({path:p,classification:secret?"secret_bearing_effect":"secret_free_verify"});
  }
  for(const x of boundaries) need(x.kind==="ops.secretEffectBoundary.v1" && ["obsolete","secret_bearing_effect"].includes(x.classification),"invalid effect contract");
  for(const i of intents) need(names.includes(i.path)||byPath.get(i.path)?.classification==="obsolete",`${i.path}: missing workflow`);
  for(const b of boundaries.filter(b=>b.classification==="secret_bearing_effect")) need(names.includes(b.path),`${b.path}: missing declared effect`);
  need(failures.length===0,failures.join("\n"));
  return {kind:"ops.secretEffectBoundary.check.v1",status:"PASS",active:workflows.length,
    secretBearingEffects:workflows.filter(w=>w.classification==="secret_bearing_effect").length,
    obsolete:boundaries.filter(b=>b.classification==="obsolete").length,unclassified:0,workflows};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const tests=selftest();console.log(JSON.stringify(process.argv[2]==="--selftest"?tests:check(path.resolve(process.argv[2]??"."))));}
  catch(error){console.error(`ci intent / effect path check failed\n${error.message}`);process.exitCode=1;}
}
