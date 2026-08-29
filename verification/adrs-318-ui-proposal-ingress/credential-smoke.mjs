import { createHash, createSign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const API = 'https://api.github.com';
const TARGET_REPOSITORY = 'roccho-dev/adrs';
const TARGET_ISSUE = 318;
const PROPOSAL_ID = 'adrs318-ui-proposal-credential-canary-v1';
const MARKER = `<!-- adrs.uiProposal.canary.v1 proposal_id=${PROPOSAL_ID} -->`;
const RECEIPT_PATH = process.env.RECEIPT_PATH || 'adrs-proposal-credential-smoke.json';
const HEAD_SHA = process.env.CANDIDATE_SHA || 'unbound';

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const canonical = value => `${JSON.stringify(stable(value))}\n`;
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const b64url = value => Buffer.from(value).toString('base64url');

function commentBody() {
  const event = {
    schema: 'adrs.uiProposal.canary.v1',
    sample: true,
    authority: false,
    target_repository: TARGET_REPOSITORY,
    target_issue: TARGET_ISSUE,
    proposal_id: PROPOSAL_ID,
    base_release_digest: 'sha256:8f087d7babfbb04bce7e9e6a1bd21169dec5d37299c58bfcbb49c5756468c461',
    operations: [],
    reason: 'Prove a server-side bounded credential can append and exactly read back one non-authority UI proposal canary.',
    idempotency_key: PROPOSAL_ID,
    implementation_candidate: HEAD_SHA,
    cutover: false,
  };
  return `${MARKER}\n\n\`\`\`jsonl\n${canonical(event)}\`\`\`\n`;
}

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'roccho-ops-adrs318-ui-proposal-credential-smoke',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    redirect: 'error',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value = null;
  if (text) {
    try { value = JSON.parse(text); } catch { value = { raw: text.slice(0, 512) }; }
  }
  return { response, value, text };
}

function appJwt(appId, privateKeyRaw) {
  const privateKey = privateKeyRaw.includes('\\n') ? privateKeyRaw.replaceAll('\\n', '\n') : privateKeyRaw;
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const encodedPayload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`;
}

async function installationToken(label, appId, privateKey, installationId) {
  if (!appId || !privateKey || !installationId) return null;
  const jwt = appJwt(appId, privateKey);
  const { response, value } = await request(`/app/installations/${installationId}/access_tokens`, {
    token: jwt,
    method: 'POST',
    body: {},
  });
  if (!response.ok || !value?.token) {
    return { label, token: null, app_token_status: response.status, app_token_error: value?.message || 'token request failed' };
  }
  return { label, token: value.token, app_token_status: response.status, expires_at: value.expires_at || null };
}

async function listComments(token) {
  const comments = [];
  for (let page = 1; page <= 50; page += 1) {
    const { response, value } = await request(`/repos/${TARGET_REPOSITORY}/issues/${TARGET_ISSUE}/comments?per_page=100&page=${page}`, { token });
    if (!response.ok || !Array.isArray(value)) throw new Error(`comment list HTTP ${response.status}`);
    comments.push(...value);
    if (value.length < 100) break;
  }
  return comments;
}

async function proveCandidate(candidate, expectedBody) {
  const result = {
    label: candidate.label,
    configured: Boolean(candidate.token),
    app_token_status: candidate.app_token_status ?? null,
    issue_read_status: null,
    comment_list_status: null,
    write_status: null,
    readback_status: null,
    recorded: false,
    duplicate: false,
    comment_id: null,
    comment_url: null,
    body_sha256: sha256(expectedBody),
  };
  if (!candidate.token) return result;

  const issue = await request(`/repos/${TARGET_REPOSITORY}/issues/${TARGET_ISSUE}`, { token: candidate.token });
  result.issue_read_status = issue.response.status;
  if (!issue.response.ok) return result;

  let comments;
  try {
    comments = await listComments(candidate.token);
    result.comment_list_status = 200;
  } catch (error) {
    result.comment_list_status = 0;
    result.error = String(error);
    return result;
  }

  let comment = comments.find(item => typeof item?.body === 'string' && item.body.includes(MARKER));
  if (comment) {
    result.duplicate = true;
    result.write_status = 200;
  } else {
    const created = await request(`/repos/${TARGET_REPOSITORY}/issues/${TARGET_ISSUE}/comments`, {
      token: candidate.token,
      method: 'POST',
      body: { body: expectedBody },
    });
    result.write_status = created.response.status;
    if (!created.response.ok) {
      result.error = created.value?.message || `write HTTP ${created.response.status}`;
      return result;
    }
    comment = created.value;
  }

  const readback = await request(`/repos/${TARGET_REPOSITORY}/issues/comments/${comment.id}`, { token: candidate.token });
  result.readback_status = readback.response.status;
  if (!readback.response.ok || readback.value?.body !== expectedBody) {
    result.error = readback.response.ok ? 'comment body readback mismatch' : (readback.value?.message || 'readback failed');
    return result;
  }

  result.recorded = true;
  result.comment_id = comment.id;
  result.comment_url = comment.html_url || null;
  return result;
}

const direct = [
  ['ADRS_PROPOSAL_TOKEN', process.env.ADRS_PROPOSAL_TOKEN || ''],
  ['ADRS_READER_TOKEN', process.env.ADRS_READER_TOKEN || ''],
  ['GITHUB_RELEASE_TOKEN', process.env.GITHUB_RELEASE_TOKEN || ''],
].map(([label, token]) => ({ label, token }));

const apps = [];
for (const prefix of ['ADRS_PROPOSAL', 'ADRS_READER', 'ADRS']) {
  try {
    const candidate = await installationToken(
      `${prefix}_APP`,
      process.env[`${prefix}_APP_ID`] || '',
      process.env[`${prefix}_PRIVATE_KEY`] || process.env[`${prefix}_APP_PRIVATE_KEY`] || '',
      process.env[`${prefix}_INSTALLATION_ID`] || process.env[`${prefix}_APP_INSTALLATION_ID`] || '',
    );
    if (candidate) apps.push(candidate);
  } catch (error) {
    apps.push({ label: `${prefix}_APP`, token: null, app_token_status: 0, app_token_error: String(error) });
  }
}

const expectedBody = commentBody();
const candidates = [...direct, ...apps];
const results = [];
let winner = null;
for (const candidate of candidates) {
  const result = await proveCandidate(candidate, expectedBody);
  results.push(result);
  if (result.recorded) {
    winner = result;
    break;
  }
}

const receipt = {
  schema: 'ops.adrsUiProposalCredentialSmoke/1',
  status: winner ? 'PASS' : 'BLOCKED',
  claim_ceiling: winner ? 'ADRS_ISSUE_WRITE_CREDENTIAL_PROVEN' : 'ADRS_ISSUE_WRITE_CREDENTIAL_MISSING',
  authority: false,
  target: { repository: TARGET_REPOSITORY, issue: TARGET_ISSUE },
  proposal_id: PROPOSAL_ID,
  canary_body_sha256: sha256(expectedBody),
  candidate_sha: HEAD_SHA,
  candidates: results,
  winner: winner ? {
    label: winner.label,
    comment_id: winner.comment_id,
    comment_url: winner.comment_url,
    duplicate: winner.duplicate,
    exact_readback: true,
  } : null,
  secret_values_persisted: false,
  semantic_reduce: false,
  gov_materialized: false,
  current_changed: false,
  authority_changed: false,
  cutover: false,
};
await writeFile(RECEIPT_PATH, canonical(receipt));
console.log(canonical(receipt).trim());
if (!winner) process.exitCode = 2;
