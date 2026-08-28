const params = new URLSearchParams(location.search);
const subjectId = params.get('subject_id') || `proof-external-${crypto.randomUUID().toLowerCase()}`;
const requestId = params.get('request_id') || `continue-${crypto.randomUUID().toLowerCase()}`;
const internalSubject = 'proof-internal-release';
const stateNode = document.querySelector('#runtime-state');
const runtimeMetaNode = document.querySelector('#runtime-meta');
const evidenceNode = document.querySelector('#pool-evidence');
let runtime = {};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function record(patch) {
  runtime = { ...runtime, ...patch, subject_id: subjectId, request_id: requestId };
  stateNode.textContent = canonical(runtime);
}

async function getJson(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${value.code || 'HTTP_ERROR'}: ${value.message || canonical(value)}`);
  return value;
}

function renderMeta(meta) {
  runtimeMetaNode.replaceChildren();
  for (const [term, value] of Object.entries({ app: meta.app_version, store: meta.observation_store, currentStateStore: meta.current_state_store })) {
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = String(value);
    runtimeMetaNode.append(dt, dd);
  }
}

function renderSurface(cardId, surface) {
  const card = document.querySelector(cardId);
  card.dataset.state = surface.state_id;
  card.querySelector('h2').textContent = surface.current_value.title;
  card.querySelector('.summary').textContent = surface.current_value.summary;
  card.querySelector('.digest').textContent = `${surface.kernel_id}\n${surface.kernel_digest}\n${surface.surface_digest}`;
  const actions = card.querySelector('.actions');
  actions.replaceChildren();
  for (const action of surface.permitted_actions) {
    if (action.effect_class === 'append-observation') {
      const button = document.createElement('button');
      button.id = 'next-action';
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => append(action.action_id, button));
      actions.append(button);
    } else {
      const link = document.createElement('a');
      link.id = action.action_id === 'open-next' ? 'open-next' : '';
      link.href = action.href;
      link.textContent = action.label;
      if (action.href.startsWith('http')) { link.target = '_blank'; link.rel = 'noreferrer'; }
      actions.append(link);
    }
  }
}

async function refresh() {
  const [meta, internal, external, evidence] = await Promise.all([
    getJson('/api/meta'),
    getJson(`/api/surface?profile_id=internal&subject_id=${encodeURIComponent(internalSubject)}`),
    getJson(`/api/surface?profile_id=external&subject_id=${encodeURIComponent(subjectId)}`),
    getJson(`/api/evidence?subject_id=${encodeURIComponent(subjectId)}`),
  ]);
  if (internal.kernel_digest !== external.kernel_digest) throw new Error('kernel identity mismatch');
  renderMeta(meta);
  renderSurface('#internal-card', internal);
  renderSurface('#external-card', external);
  evidenceNode.textContent = canonical(evidence);
  record({ status: 'PASS', meta, internal, external, evidence });
  document.body.dataset.status = 'ready';
  document.body.dataset.externalState = external.state_id;
  return { meta, internal, external, evidence };
}

async function append(actionId, button) {
  button.disabled = true;
  document.body.dataset.status = 'posting';
  try {
    const result = await getJson('/api/observations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: 'adrs322.actionObservationRequest/1',
        request_id: requestId,
        subject_id: subjectId,
        profile_id: 'external',
        action_id: actionId,
      }),
    });
    record({ append_result: result });
    await refresh();
  } catch (error) {
    document.body.dataset.status = 'error';
    record({ status: 'ERROR', error: String(error) });
    throw error;
  }
}

refresh().catch((error) => {
  document.body.dataset.status = 'error';
  record({ status: 'ERROR', error: String(error) });
  console.error(error);
});
