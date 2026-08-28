import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const expectedProjectionSha = '8c992e2d47abe3d4ee3b920d2941ccfc6f4d9e611a01bc7d09215068b9c47225';
const expectedAcceptance = 'https://github.com/roccho-dev/adrs/issues/322#issuecomment-5448293184';
const expectedAcceptanceCommentId = 5448293184;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function canonical(value) { return `${JSON.stringify(stable(value))}\n`; }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }

const projectionText = readFileSync(resolve(root, 'public/projection.json'), 'utf8');
const projection = JSON.parse(projectionText);
if (projectionText !== canonical(projection)) throw new Error('projection.json is not canonical');
if (sha(projectionText) !== expectedProjectionSha) throw new Error('public projection digest mismatch');
if (projection.schema !== 'ops.publicDecisionProjection/1') throw new Error('projection schema mismatch');
if (projection.status !== 'ACCEPTED' || projection.authority !== false || projection.public_safe !== true) throw new Error('projection authority/public status mismatch');
if (projection.source?.acceptance_comment_id !== expectedAcceptanceCommentId) throw new Error('acceptance comment mismatch');
if (projection.source?.acceptance_url !== expectedAcceptance) throw new Error('acceptance URL mismatch');
if (projection.source?.record !== 'LOG_PROJECTED_APPLICATION_KERNEL_ACCEPTANCE_001') throw new Error('accepted record mismatch');
if (projection.source?.accepted_status !== 'ACCEPTED__BOUNDED_FEASIBILITY_PROVEN') throw new Error('accepted state mismatch');
if (projection.permitted_action?.action_id !== 'continue') throw new Error('single action mismatch');
if (projection.proof_ceiling?.production_cutover_authorized !== false) throw new Error('cutover must remain false');

const publicJson = JSON.stringify(projection);
for (const forbidden of ['api_token', 'sops_age_key', 'private_key', 'access_token', 'client_secret']) {
  if (publicJson.toLowerCase().includes(forbidden)) throw new Error(`forbidden public material: ${forbidden}`);
}
if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(publicJson)) throw new Error('email-shaped value in public projection');

const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
const app = readFileSync(resolve(root, 'public/app.js'), 'utf8');
if (!html.includes(expectedAcceptance)) throw new Error('HTML source link mismatch');
if (!html.includes(expectedProjectionSha)) throw new Error('HTML projection digest mismatch');
if (!html.includes('This public page is a projection, not decision authority.')) throw new Error('authority boundary missing from HTML');

const assets = {
  'app.js': sha(app),
  'index.html': sha(html),
  'projection.json': sha(projectionText),
};
const bundleDigest = sha(canonical(assets));
const receipt = {
  schema: 'ops.publicDecisionLocalProof/1',
  status: 'PASS',
  authority: false,
  source: {
    repository: 'roccho-dev/adrs',
    issue: 322,
    acceptance_comment_id: expectedAcceptanceCommentId,
    acceptance_url: expectedAcceptance,
  },
  projection_sha256: expectedProjectionSha,
  asset_sha256: assets,
  bundle_sha256: bundleDigest,
  shared_kernel_source: 'verification/adrs-322-log-projected-application',
  public_safe: true,
  external_effect: false,
  production_cutover: false,
  qualified_market_observation: false,
};
const out = process.argv[2] || resolve(root, 'local-proof.json');
writeFileSync(out, canonical(receipt));
console.log(canonical(receipt).trim());
