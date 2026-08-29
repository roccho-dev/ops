const PROPOSAL = Object.freeze({
  schema: 'adrs.uiProposal.canary.v2',
  sample: true,
  authority: false,
  target_repository: 'roccho-dev/adrs',
  target_issue: 318,
  proposal_id: 'adrs318-ui-proposal-oidc-canary-v1',
  base_release_digest: 'sha256:8f087d7babfbb04bce7e9e6a1bd21169dec5d37299c58bfcbb49c5756468c461',
  operations: [{
    op: 'set-responsibility',
    package_id: 'pkg.adrs318.canary',
    value: 'UI proposal ingress can be recorded through an ADRS-owned OIDC relay without giving the public Worker GitHub write credentials.',
  }],
  reason: 'Prove UI submit → immutable R2 queue → ADRS-owned GitHub Actions relay → exact Issue comment readback → Worker acknowledgement.',
  idempotency_key: 'adrs318-ui-proposal-oidc-canary-v1',
  cutover: false,
});

const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
const receipt = document.querySelector('#receipt');
const proposal = document.querySelector('#proposal');

function publish(value) {
  window.__adrsUiProposal = value;
  receipt.textContent = JSON.stringify(value, null, 2);
}

function renderProposal() {
  const rows = [
    ['proposal_id', PROPOSAL.proposal_id],
    ['target', `${PROPOSAL.target_repository}#${PROPOSAL.target_issue}`],
    ['package', PROPOSAL.operations[0].package_id],
    ['operation', PROPOSAL.operations[0].op],
    ['value', PROPOSAL.operations[0].value],
    ['authority', 'false'],
    ['cutover', 'false'],
  ];
  for (const [key, value] of rows) {
    const div = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = key;
    detail.textContent = value;
    div.append(term, detail);
    proposal.append(div);
  }
}

async function request(path, init = {}) {
  const response = await fetch(path, { cache: 'no-store', redirect: 'error', ...init });
  const value = await response.json();
  if (!response.ok) throw new Error(`${value.code || 'HTTP_ERROR'}: ${value.message || response.status}`);
  return value;
}

async function currentStatus() {
  return request(`/api/proposals/${PROPOSAL.proposal_id}`);
}

async function pollRecorded() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await currentStatus();
    publish({ phase: 'status', status });
    result.textContent = status.state === 'recorded'
      ? `recorded: ${status.comment_url}`
      : 'submitted: ADRS-owned relayを待っています。';
    document.body.dataset.state = status.state;
    if (status.state === 'recorded') return status;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return null;
}

async function submitProposal() {
  submit.disabled = true;
  result.textContent = '送信中…';
  try {
    const response = await request('/api/proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PROPOSAL),
    });
    publish({ phase: 'submitted', response });
    result.textContent = `${response.state}: ${response.proposal_id}`;
    document.body.dataset.state = response.state;
    pollRecorded().catch(error => publish({ phase: 'poll-error', error: String(error) }));
  } catch (error) {
    publish({ phase: 'error', error: String(error) });
    result.textContent = String(error);
    document.body.dataset.state = 'error';
  } finally {
    submit.disabled = false;
  }
}

renderProposal();
submit.addEventListener('click', submitProposal);

try {
  const meta = await request('/api/meta');
  if (meta.proposal_id !== PROPOSAL.proposal_id || meta.github_write_credential_in_worker !== false) {
    throw new Error('runtime contract mismatch');
  }
  publish({ phase: 'ready', meta, proposal: PROPOSAL });
  result.textContent = '送信できます。';
  document.body.dataset.state = 'ready';
  submit.disabled = false;
  try {
    const status = await currentStatus();
    publish({ phase: 'status', meta, status });
    result.textContent = status.state === 'recorded' ? `recorded: ${status.comment_url}` : `${status.state}: 再送は冪等です。`;
    document.body.dataset.state = status.state;
  } catch {
    // No proposal has been submitted yet.
  }
} catch (error) {
  publish({ phase: 'error', error: String(error) });
  result.textContent = String(error);
  document.body.dataset.state = 'error';
}
