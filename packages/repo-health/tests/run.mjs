import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_REPOSITORIES, JEV_MODEL, buildOutputs, evaluateObservation, flakePackageNames, isSafeSemanticPath,
  parseJsonl, semanticReviewInput, sha256, unknownEvaluation, validateJevBudget, validateObservation, validateRules, validateScope,
} from '../lib/core.mjs';
import { materializeBareScope } from '../lib/source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = parseJsonl(fs.readFileSync(path.join(here, '..', 'artifact.jsonl'), 'utf8'));
assert.deepEqual(artifact, [{artifact:'repo-health',kind:'artifact.auth.v1',requiredCapabilities:['jev-api']}]);
assert.equal(isSafeSemanticPath('README.md'), true);
assert.equal(isSafeSemanticPath('secrets/jev-api-key.sops.yaml'), false);
assert.equal(isSafeSemanticPath('package/.env.local'), false);
assert.equal(isSafeSemanticPath('keys/id_ed25519'), false);

const destructive = parseJsonl(fs.readFileSync(path.join(here, 'destructive.jsonl'), 'utf8'));
assert.equal(destructive.length, 18);
assert.equal(new Set(destructive.map((row) => row.id)).size, 18);

const scope = EXPECTED_REPOSITORIES.map((repository) => ({
  kind:'repoHealth.scope.v1', id:repository.split('/')[1], repository, path:repository.split('/')[1],
}));
const rules = [
  { kind:'repoHealth.rule.v2', id:'purpose-misalignment', concern:'The target may contradict its declared purpose.' },
];
const observation = {
  kind:'repoHealth.observation.v1', repoId:'ops', repository:'roccho-dev/ops',
  revision:'a'.repeat(40), tree:'b'.repeat(40), dirty:false,
  root:{purpose:'Operations packages.', files:['README.md']},
  packages:[{id:'repo-health',path:'packages/repo-health',purpose:'health',evidence:{tests:['tests/run.mjs'],checks:['repo-health']}}],
};

validateScope(scope); validateRules(rules); validateObservation(observation);
assert.deepEqual(flakePackageNames({packages:{'x86_64-linux':{dataset:{type:'derivation'},'codex-cli':{type:'derivation'}},'aarch64-linux':{dataset:{type:'derivation'}}}}), ['codex-cli','dataset']);
assert.deepEqual(flakePackageNames({checks:{}}), []);
assert.throws(() => flakePackageNames({packages:[]}), /invalid Nix packages surface/u);
validateObservation({...observation, packages:[{id:'dataset',path:'flake.nix#packages.*.dataset',purpose:'Declared Nix package output dataset.'}]});
assert.throws(() => validateScope(scope.slice(0,6)), /exactly 7/u);
assert.throws(() => validateScope([...scope.slice(0,6), {...scope[6], repository:'roccho-dev/governance'}]), /duplicate repository/u);
assert.throws(() => validateRules([{...rules[0], failAt:0.2}]), /invalid rule contract/u);
assert.throws(() => validateRules([]), /at least one rule/u);
assert.throws(() => validateObservation({...observation, dirty:true}), /must be clean/u);
assert.throws(() => validateObservation({...observation, packages:[{id:'x',path:'packages/x'}]}), /package subject missing/u);

const reviewInput = semanticReviewInput(observation, rules);
assert.deepEqual(reviewInput.themes, ['purpose-misalignment']);
assert.equal(reviewInput.items.length, 2);
assert.ok(validateJevBudget(observation, Object.fromEntries(reviewInput.items.map((_, i) => [`q${i}`, {type:'noul',instructions:'x',criteria:{true:'x',false:'y'}}]))).stateBytes > 0);

const evaluateWith = (noul) => evaluateObservation({
  observation,
  rules,
  ask: async (_, questions) => ({
    model:JEV_MODEL,
    answers:Object.fromEntries(Object.keys(questions).map((id) => [id,{type:'noul',noul}])),
  }),
});
const high = await evaluateWith(0.95);
const low = await evaluateWith(0.05);
const middle = await evaluateWith(0.5);
for (const value of [high, low, middle]) {
  assert.equal(value.repo.deterministicStatus, 'PASS');
  assert.equal(value.repo.semanticStatus, 'EVALUATED');
  assert.equal(value.packages[0].deterministicStatus, 'PASS');
  assert.equal(value.packages[0].semanticStatus, 'EVALUATED');
  assert.equal(Object.hasOwn(value.repo, 'status'), false);
  assert.equal(Object.hasOwn(value.judgments[0], 'status'), false);
}
assert.equal(high.judgments[0].noul, 0.95);
assert.equal(low.judgments[0].noul, 0.05);
assert.equal(middle.judgments[0].noul, 0.5);
assert.match(high.judgments[0].subjectDigest, /^sha256:[0-9a-f]{64}$/u);

await assert.rejects(() => evaluateObservation({
  observation, rules,
  ask: async () => ({model:JEV_MODEL,answers:{}}),
}), /INVALID_JEV_ANSWERS/u);

const semanticError = unknownEvaluation({scopeRow:scope[2], observation, reason:'jev: timeout'});
assert.equal(semanticError.repo.deterministicStatus, 'PASS');
assert.equal(semanticError.repo.semanticStatus, 'ERROR');
const observationBlocked = unknownEvaluation({scopeRow:scope[0], reason:'observation: missing'});
assert.equal(observationBlocked.repo.deterministicStatus, 'UNKNOWN');
assert.equal(observationBlocked.repo.semanticStatus, 'BLOCKED');

const evaluations = scope.map((s) => s.id === 'ops' ? high : unknownEvaluation({scopeRow:s,reason:'fixture unavailable'}));
const outputs = buildOutputs({scope,rules,evaluations});
assert.throws(() => buildOutputs({scope,rules,evaluations:[high,high]}),/duplicate evaluation repository/u);
assert.equal(outputs.summary.expected,7);
assert.equal(outputs.summary.observed,1);
assert.equal(outputs.summary.deterministicPass,1);
assert.equal(outputs.summary.deterministicUnknown,6);
assert.equal(outputs.summary.semanticEvaluated,1);
assert.equal(outputs.summary.semanticBlocked,6);
assert.equal(outputs.receipt.complete,false);
assert.equal(outputs.receipt.model,JEV_MODEL);
assert.match(outputs.html,/deterministic unknown/u);
assert.match(outputs.html,/authority=false/u);
assert.doesNotMatch(outputs.html,/fixture-secret/u);
assert.equal(parseJsonl('{"a":1}\n')[0].a,1);
assert.throws(()=>parseJsonl('{bad}\n'),/line 1/u);
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

await import('../design/test.mjs');
await import('../closure/test.mjs');
await import('../dag/test.mjs');
await import('../dag/benchmark/test.mjs');
console.log(JSON.stringify({
  status:'PASS',
  destructive:destructive.length,
  scope:7,
  semanticThresholds:0,
  noulAuthority:false,
  closureEvaluation:true,
  dagSemanticEvaluation:true,
}));
