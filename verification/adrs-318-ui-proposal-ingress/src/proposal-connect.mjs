import { createJsonConnectability } from '/connectability.mjs';

const TARGET_ID = 'pkg.adrs318.canary';
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
    package_id: TARGET_ID,
    value: 'UI proposal ingress can be recorded through an ADRS-owned OIDC relay without giving the public Worker GitHub write credentials.',
  }],
  reason: 'Prove UI submit → immutable R2 queue → ADRS-owned GitHub Actions relay → exact Issue comment readback → Worker acknowledgement.',
  idempotency_key: 'adrs318-ui-proposal-oidc-canary-v1',
  cutover: false,
});

function waitFor(read, timeoutMs = 15_000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = read();
      if (value) return resolve(value);
      if (performance.now() - started > timeoutMs) return reject(new Error('Semantic Map did not become ready'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

const site = await waitFor(() => globalThis.semanticMapSite?.ready === true && globalThis.semanticMapSite);
const app = await waitFor(() => globalThis.semanticMapApp?.ready === true && globalThis.semanticMapApp);
if (site.runtime.view.pattern !== 'map/1') throw new Error('proposal connectability requires map/1');
if (!app.domain.regions.has(TARGET_ID)) throw new Error(`proposal target is missing: ${TARGET_ID}`);

const connection = createJsonConnectability({
  prepare(input) {
    if (input?.package_id !== TARGET_ID) throw new TypeError(`unsupported package: ${input?.package_id ?? 'none'}`);
    return PROPOSAL;
  },
});

const style = document.createElement('style');
style.textContent = `
  .proposal-connect-button {
    min-width: 88px; height: 34px; padding: 0 10px; border: 1px solid #5262c4; border-radius: 10px;
    background: #5d6dd2; color: #fff; font-size: 10px; font-weight: 850;
  }
  .proposal-connect-button:disabled { opacity: .42; cursor: default; }
  .proposal-connect-state { min-width: 64px; color: #607084; font: 760 9px/1.2 ui-monospace, monospace; text-align: right; }
  .proposal-connect-dialog { width: min(620px, calc(100% - 24px)); max-height: 86dvh; padding: 0; border: 1px solid #d8e0e8; border-radius: 18px; color: #17202a; box-shadow: 0 22px 70px rgba(17,24,39,.3); }
  .proposal-connect-dialog::backdrop { background: rgba(17,24,39,.48); backdrop-filter: blur(2px); }
  .proposal-connect-sheet { padding: 18px; }
  .proposal-connect-sheet h2 { margin: 0; font-size: 18px; }
  .proposal-connect-sheet p { color: #617083; font-size: 12px; line-height: 1.55; }
  .proposal-connect-sheet pre { max-height: 42dvh; overflow: auto; padding: 12px; border: 1px solid #dce4ec; border-radius: 12px; background: #f8fafc; font: 10px/1.5 ui-monospace, monospace; white-space: pre-wrap; }
  .proposal-connect-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .proposal-connect-actions button { min-height: 42px; border-radius: 11px; font-weight: 850; }
  .proposal-connect-cancel { border: 1px solid #cbd5df; background: #fff; color: #344354; }
  .proposal-connect-confirm { border: 1px solid #5262c4; background: #5d6dd2; color: #fff; }
  .proposal-connect-result { min-height: 22px; margin: 10px 0 0; color: #526170; font-size: 11px; }
  .proposal-connect-result[data-kind="ok"] { color: #207453; font-weight: 800; }
  .proposal-connect-result[data-kind="error"] { color: #a33e3e; font-weight: 800; }
  @media (max-width: 560px) { .proposal-connect-state { display: none; } .proposal-connect-button { min-width: 70px; } }
`;
document.head.append(style);

const actions = document.querySelector('.topbar-actions');
if (!actions) throw new Error('Semantic Map topbar actions are missing');
const stateOutput = document.createElement('output');
stateOutput.id = 'proposal-connect-state';
stateOutput.className = 'proposal-connect-state';
stateOutput.value = 'select package';
stateOutput.textContent = stateOutput.value;
const openButton = document.createElement('button');
openButton.id = 'proposal-connect-button';
openButton.className = 'proposal-connect-button';
openButton.type = 'button';
openButton.disabled = true;
openButton.textContent = 'Issueに記録';
actions.prepend(stateOutput, openButton);

const dialog = document.createElement('dialog');
dialog.id = 'proposal-connect-dialog';
dialog.className = 'proposal-connect-dialog';
dialog.innerHTML = `
  <form method="dialog" class="proposal-connect-sheet">
    <h2>ADRS Issueへproposalを記録</h2>
    <p><code>${TARGET_ID}</code>の非権威proposalです。記録はaccepted/currentを変更しません。</p>
    <pre id="proposal-connect-preview"></pre>
    <div class="proposal-connect-actions">
      <button class="proposal-connect-cancel" value="cancel">閉じる</button>
      <button id="proposal-connect-confirm" class="proposal-connect-confirm" value="submit" type="button">記録する</button>
    </div>
    <output id="proposal-connect-result" class="proposal-connect-result" role="status"></output>
  </form>
`;
document.body.append(dialog);
const preview = dialog.querySelector('#proposal-connect-preview');
const confirmButton = dialog.querySelector('#proposal-connect-confirm');
const result = dialog.querySelector('#proposal-connect-result');

let selected = false;
let state = 'ready';
let prepared = null;
let last = null;

function setState(next, message = next, kind = 'info') {
  state = next;
  document.body.dataset.proposalState = next;
  stateOutput.value = next;
  stateOutput.textContent = next;
  result.textContent = message;
  result.dataset.kind = kind;
}

function syncSelection() {
  const selection = app.adapter.selectionSnapshot();
  selected = selection.regionIds.length === 1
    && selection.regionIds[0] === TARGET_ID
    && selection.relationIds.length === 0;
  openButton.disabled = !selected;
  if (!selected && state === 'ready') stateOutput.textContent = 'select package';
  else stateOutput.textContent = state;
  return selected;
}
app.adapter.onSelectionChange(syncSelection);
syncSelection();

async function prepareSelected() {
  if (!syncSelection()) throw new Error(`select ${TARGET_ID}`);
  prepared = await connection.prepare({ package_id: TARGET_ID });
  preview.textContent = prepared.bytes;
  setState('prepared', 'proposalを確認してください。');
  return prepared;
}

async function open() {
  await prepareSelected();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  confirmButton.focus({ preventScroll: true });
  return prepared;
}

async function submitSelected() {
  const candidate = prepared ?? await prepareSelected();
  confirmButton.disabled = true;
  setState('submitting', '送信中…');
  try {
    const submitted = await connection.submit(candidate);
    setState(submitted.state, `${submitted.state}: ${submitted.id}`);
    const observation = await connection.observe(candidate.id);
    last = Object.freeze({ prepared: candidate, submitted, observation });
    const message = observation.value.comment_url
      ? `recorded: ${observation.value.comment_url}`
      : `${observation.state}: ${observation.id}`;
    setState(observation.state, message, observation.state === 'recorded' ? 'ok' : 'info');
    return last;
  } catch (error) {
    last = Object.freeze({ prepared: candidate, error: String(error) });
    setState('error', error instanceof Error ? error.message : String(error), 'error');
    throw error;
  } finally {
    confirmButton.disabled = false;
  }
}

openButton.addEventListener('click', () => { void open().catch(error => setState('error', error.message, 'error')); });
confirmButton.addEventListener('click', () => { void submitSelected().catch(() => {}); });

try {
  const observation = await connection.observe(PROPOSAL.proposal_id);
  last = Object.freeze({ observation });
  setState(observation.state, observation.state, observation.state === 'recorded' ? 'ok' : 'info');
} catch {
  setState('ready', 'proposalを送信できます。');
}
syncSelection();

globalThis.semanticProposalConnectability = Object.freeze({
  ready: true,
  targetId: TARGET_ID,
  proposal: PROPOSAL,
  connection,
  open,
  prepareSelected,
  submitSelected,
  selected: () => selected,
  state: () => state,
  last: () => last,
});
