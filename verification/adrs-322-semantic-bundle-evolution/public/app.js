const stateNode = document.querySelector('#runtime-state');
const metaNode = document.querySelector('#runtime-meta');
const titleNode = document.querySelector('#surface-title');
const summaryNode = document.querySelector('#surface-summary');
const valueNode = document.querySelector('#surface-value');
const actionsNode = document.querySelector('#surface-actions');
const digestsNode = document.querySelector('#surface-digests');
const evidenceNode = document.querySelector('#evidence');
let runtime = {};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function canonical(value) { return JSON.stringify(stable(value)); }
function record(patch) {
  runtime = { ...runtime, ...patch };
  stateNode.textContent = canonical(runtime);
}
async function getJson(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${value.code || 'HTTP_ERROR'}: ${value.message || canonical(value)}`);
  return value;
}
function renderMeta(meta) {
  metaNode.replaceChildren();
  for (const [term, value] of Object.entries({ app: meta.app_version, worker: meta.worker_name, proof: meta.proof_id, kernel: meta.kernel_id })) {
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = String(value);
    metaNode.append(dt, dd);
  }
}
function renderSurface(surface) {
  titleNode.textContent = surface.current_value.title;
  summaryNode.textContent = surface.current_value.summary;
  valueNode.textContent = `Value source: ${surface.current_value.value_surface || 'n/a'}`;
  actionsNode.replaceChildren();
  for (const action of surface.permitted_actions) {
    const link = document.createElement('a');
    link.href = action.href;
    link.textContent = action.label;
    link.dataset.actionId = action.action_id;
    actionsNode.append(link);
  }
  digestsNode.textContent = canonical({
    event: surface.event_object_digest,
    bundle: surface.semantic_bundle_digest,
    state: surface.state_digest,
    surface: surface.surface_digest,
    kernel: surface.kernel_digest,
  });
  document.body.dataset.bundleId = surface.semantic_bundle_id;
}
async function refresh() {
  document.body.dataset.status = 'loading';
  const [meta, surface, evidence] = await Promise.all([
    getJson('/api/meta'),
    getJson('/api/evolution/surface'),
    getJson('/api/evolution/evidence'),
  ]);
  renderMeta(meta);
  renderSurface(surface);
  evidenceNode.textContent = canonical(evidence);
  record({ status: 'PASS', meta, surface, evidence });
  document.body.dataset.status = 'ready';
  return { meta, surface, evidence };
}
document.querySelector('#refresh').addEventListener('click', () => refresh().catch(fail));
function fail(error) {
  document.body.dataset.status = 'error';
  record({ status: 'ERROR', error: String(error) });
  console.error(error);
}
refresh().catch(fail);
