import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_REPOSITORIES, buildOutputs, classifyNoul, evaluateObservation, flakePackageNames, makeQuestions,
  parseJsonl, sha256, unknownEvaluation, validateObservation, validateRules, validateScope,
} from '../lib/core.mjs';
import { materializeBareScope } from '../lib/source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = parseJsonl(fs.readFileSync(path.join(here, '..', 'artifact.jsonl'), 'utf8'));
assert.deepEqual(artifact, [{artifact:'repo-health',kind:'artifact.auth.v1',requiredCapabilities:['jev-api']}]);
const destructive = parseJsonl(fs.readFileSync(path.join(here, 'destructive.jsonl'), 'utf8'));
assert.equal(destructive.length, 18);
assert.equal(new Set(destructive.map((row) => row.id)).size, 18);

const scope = EXPECTED_REPOSITORIES.map((repository) => ({ kind:'repoHealth.scope.v1', id: repository.split('/')[1], repository, path: repository.split('/')[1] }));
const rules = [
  { kind:'repoHealth.rule.v1', id:'purpose-alignment', instructions:'The target is consistent with its declared purpose.', criteria:{true:'No obvious contradiction.',false:'Observable implementation contradicts its purpose.'}, failAt:0.2, passAt:0.8, blocking:true },
];
const observation = { kind:'repoHealth.observation.v1', repoId:'ops', repository:'roccho-dev/ops', revision:'a'.repeat(40), tree:'b'.repeat(40), dirty:false, root:{purpose:'Operations packages.', files:['README.md']}, packages:[{id:'repo-health',path:'packages/repo-health',purpose:'health',evidence:{tests:['tests/run.mjs'],checks:['repo-health']}}] };

validateScope(scope); validateRules(rules); validateObservation(observation);
assert.deepEqual(flakePackageNames({packages:{'x86_64-linux':{dataset:{type:'derivation'},'codex-cli':{type:'derivation'}},'aarch64-linux':{dataset:{type:'derivation'}}}}), ['codex-cli','dataset']);
assert.deepEqual(flakePackageNames({checks:{}}), []);
assert.throws(() => flakePackageNames({packages:[]}), /invalid Nix packages surface/u);
validateObservation({...observation, packages:[{id:'dataset',path:'flake.nix#packages.*.dataset',purpose:'Declared Nix package output dataset.'}]});
assert.throws(() => validateScope(scope.slice(0,6)), /exactly 7/u);
assert.throws(() => validateScope([...scope.slice(0,6), {...scope[6], repository:'roccho-dev/governance'}]), /duplicate repository/u);
assert.throws(() => validateRules([{...rules[0], passAt:undefined}]), /explicit valid/u);
assert.throws(() => validateRules([]), /at least one rule/u);
assert.throws(() => validateObservation({...observation, dirty:true}), /must be clean/u);
assert.throws(() => validateObservation({...observation, packages:[{id:'x',path:'packages/x'}]}), /package subject missing/u);
assert.equal(classifyNoul(.9,rules[0]),'PASS'); assert.equal(classifyNoul(.1,rules[0]),'FAIL'); assert.equal(classifyNoul(.5,rules[0]),'UNKNOWN');
const {questions,mapping}=makeQuestions(observation,rules);
assert.equal(Object.keys(questions).length,2);
const response={model:'jev-test',answers:Object.fromEntries(Object.keys(questions).map((id)=>[id,{type:'noul',noul:.95}]))};
const evaluated=evaluateObservation({observation,rules,response,mapping});
assert.equal(evaluated.repo.status,'PASS'); assert.equal(evaluated.packages[0].status,'PASS');
assert.match(evaluated.judgments[0].subjectDigest, /^sha256:[0-9a-f]{64}$/u);
assert.throws(()=>evaluateObservation({observation,rules,response:{model:'jev-test',answers:{}},mapping}),/answer set mismatch/u);
const middle={model:'jev-test',answers:Object.fromEntries(Object.keys(questions).map((id)=>[id,{type:'noul',noul:.5}]))};
assert.equal(evaluateObservation({observation,rules,response:middle,mapping}).repo.status,'UNKNOWN');
const bad={model:'jev-test',answers:Object.fromEntries(Object.keys(questions).map((id)=>[id,{type:'choice',noul:.9}]))};
assert.throws(()=>evaluateObservation({observation,rules,response:bad,mapping}),/invalid Noul/u);
const failAnswers={model:'jev-test',answers:Object.fromEntries(Object.keys(questions).map((id,i)=>[id,{type:'noul',noul:i===1?.05:.95}]))};
const failed=evaluateObservation({observation,rules,response:failAnswers,mapping});
assert.equal(failed.packages[0].status,'FAIL'); assert.equal(failed.repo.status,'FAIL');
const evaluations=scope.map((s)=>s.id==='ops'?evaluated:unknownEvaluation({scopeRow:s,rules,reason:'fixture unavailable'}));
const outputs=buildOutputs({scope,rules,evaluations});
assert.throws(()=>buildOutputs({scope,rules,evaluations:[evaluated,evaluated]}),/duplicate evaluation repository/u);
assert.equal(outputs.summary.expected,7); assert.equal(outputs.summary.observed,1); assert.equal(outputs.summary.unknown,6); assert.equal(outputs.receipt.complete,false);
assert.match(outputs.html,/Major Repo Health/u); assert.match(outputs.html,/authority=false/u); assert.doesNotMatch(outputs.html,/fixture-secret/u);
assert.equal(parseJsonl('{"a":1}\n')[0].a,1); assert.throws(()=>parseJsonl('{bad}\n'),/line 1/u);
assert.match(sha256('x'),/^sha256:[0-9a-f]{64}$/u);

function git(cwd, ...argv) {
  return execFileSync('git', ['-C', cwd, ...argv], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
}

const bareFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-health-bare-fixture-'));
try {
  const source = path.join(bareFixture, 'source');
  const bareRoot = path.join(bareFixture, 'bare');
  fs.mkdirSync(source, { recursive:true });
  fs.mkdirSync(bareRoot, { recursive:true });
  execFileSync('git', ['init', '--quiet', source]);
  git(source, 'config', 'user.email', 'repo-health@example.invalid');
  git(source, 'config', 'user.name', 'repo-health fixture');
  fs.writeFileSync(path.join(source, 'README.md'), '# fixture\n');
  fs.mkdirSync(path.join(source, 'packages', 'fixture'), { recursive:true });
  fs.writeFileSync(path.join(source, 'packages', 'fixture', 'README.md'), '# package fixture\n');
  git(source, 'add', '.');
  git(source, 'commit', '--quiet', '-m', 'fixture');
  const revision = git(source, 'rev-parse', 'HEAD');
  const tree = git(source, 'rev-parse', 'HEAD^{tree}');
  execFileSync('git', ['init', '--quiet', '--bare', path.join(bareRoot, 'ops.git')]);
  git(source, 'push', '--quiet', path.join(bareRoot, 'ops.git'), 'HEAD:refs/remotes/github/proposals');

  const snapshot = materializeBareScope(
    [{ kind:'repoHealth.scope.v1', id:'ops', repository:'roccho-dev/ops', path:'ops' }],
    bareRoot,
  );
  try {
    assert.equal(snapshot.refs.length, 1);
    assert.equal(snapshot.refs[0].revision, revision);
    assert.equal(snapshot.refs[0].tree, tree);
    assert.equal(git(path.join(snapshot.root, 'ops'), 'rev-parse', 'HEAD'), revision);
    assert.equal(git(path.join(snapshot.root, 'ops'), 'status', '--porcelain=v1'), '');
  } finally {
    const snapshotRoot = snapshot.root;
    snapshot.cleanup();
    assert.equal(fs.existsSync(snapshotRoot), false);
  }

  assert.throws(
    () => materializeBareScope(
      [{ kind:'repoHealth.scope.v1', id:'missing', repository:'roccho-dev/ops', path:'missing' }],
      bareRoot,
    ),
    /bare repository missing/u,
  );
} finally {
  fs.rmSync(bareFixture, { recursive:true, force:true });
}

console.log(JSON.stringify({status:'PASS', destructive:destructive.length, scope:7}));
