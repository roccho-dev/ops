import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const docPath = 'docs/editor-queue-ui-ops-boundary.md';
const doc = readFileSync(docPath, 'utf8');

const requiredFragments = [
  'Purpose lineage',
  'editor -> queue -> ui',
  '`ops = queue runtime + admission + receipt + projection builder + source evidence lane + model/source reconcile lane`',
  '`hq-modeling-runtime`',
  '`hq-source-evidence-runtime`',
  '`model-source-reconcile`',
  '`hq-admission-gate`',
  '`repo-map-projection-builder`',
  '`cue-append-contract-core`',
  'Core / port / adapter split',
  'Pure / effect rule',
  'Authority boundary',
  'False-positive and false-negative gates',
  'Repo cleanliness rule',
  'Queue rows are intent.',
  'Receipts are evidence.',
  'Projections and previews are generated read models.',
  'Source observations and source receipts are evidence only.',
  'Reconcile findings compare model expectations with source evidence.',
  'payload smuggling boundary',
  'source evidence boundary',
  'reconcile boundary',
  'must not import or implement editor UX',
  'browser renderer behavior',
  'UI state storage',
];

for (const fragment of requiredFragments) {
  assert.ok(
    doc.includes(fragment),
    `missing required boundary fragment: ${fragment}`,
  );
}

function boundaryViolations(text) {
  const forbiddenClaims = [
    /\bops\b.*\bowns\b.*\beditor UX\b/i,
    /\bops\b.*\bowns\b.*\bVim\b/i,
    /\bops\b.*\bowns\b.*\b(browser|UI) renderer\b/i,
    /\bops\b.*\bimplements\b.*\b(browser|UI) renderer\b/i,
    /\bops\b.*\bwrites\b.*\bUI state\b/i,
    /\bops\b.*\bstores\b.*\bUI state\b/i,
  ];
  const negationOrBoundary = /\b(does not|do not|must not|must fail|cannot|never|no|non-goal|forbidden|fail if|outside|not)\b/i;

  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .filter(({ line }) => !negationOrBoundary.test(line))
    .filter(({ line }) => forbiddenClaims.some((claim) => claim.test(line)));
}

const violations = boundaryViolations(doc);
assert.deepEqual(
  violations,
  [],
  `ops boundary doc contains forbidden ownership claims: ${JSON.stringify(violations)}`,
);

const falsePositiveFixtures = [
  'ops does not own editor UX, browser renderer, or UI state.',
  'ops must not import or implement editor UX.',
  'docs fail if ops owns UI renderer.',
  'browser renderer is outside ops.',
  'must fail: docs that claim ops owns editor UX.',
];

for (const fixture of falsePositiveFixtures) {
  assert.deepEqual(
    boundaryViolations(fixture),
    [],
    `false positive boundary fixture was rejected: ${fixture}`,
  );
}

const falseNegativeFixtures = [
  'ops owns editor UX for hq commands.',
  'ops implements browser renderer behavior.',
  'ops writes UI state for preview.',
  'ops stores UI state in the runtime package.',
  'ops owns UI renderer and queue runtime.',
];

for (const fixture of falseNegativeFixtures) {
  assert.ok(
    boundaryViolations(fixture).length > 0,
    `false negative boundary fixture was missed: ${fixture}`,
  );
}

console.log('ops editor-to-queue-to-ui boundary check: PASS');
