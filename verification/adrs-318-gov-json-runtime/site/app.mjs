const CURRENT_SCHEMA = 'ops.govJsonRuntimeCurrent/1';
const VIEW_CONTRACT = 'ui.govReleaseRuntimeView/1';

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  return `sha256:${hex(await crypto.subtle.digest('SHA-256', bytes))}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function acceptedContentType(response) {
  const value = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  return ['application/json', 'text/json', 'text/plain', 'application/octet-stream'].includes(value);
}

async function fetchCurrent() {
  const response = await fetch('./current.json', {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  assert(response.ok, `current.json HTTP ${response.status}`);
  assert(acceptedContentType(response), 'current.json content type denied');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const current = JSON.parse(text);
  assert(current.schema === CURRENT_SCHEMA, 'current schema unsupported');
  assert(current.claim_ceiling === 'PR_CANDIDATE_GREEN', 'claim ceiling mismatch');
  assert(current.authority === false, 'authority boundary mismatch');
  assert(current.view_contract === VIEW_CONTRACT, 'view contract mismatch');
  assert(current.view_reduce === 'display-only' && current.semantic_reduce === false, 'reduce boundary mismatch');
  assert(Array.isArray(current.assets) && current.assets.length > 0, 'assets missing');
  return { current, bytes, digest: await sha256(bytes) };
}

async function fetchExact(asset) {
  const response = await fetch(`./${asset.path}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  assert(response.ok, `${asset.name} HTTP ${response.status}`);
  assert(acceptedContentType(response), `${asset.name} content type denied`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert(bytes.byteLength === asset.bytes, `${asset.name} byte mismatch`);
  const digest = await sha256(bytes);
  assert(digest === asset.sha256, `${asset.name} digest mismatch`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { ...asset, digest, value: JSON.parse(text), text };
}

function flatten(value, prefix = '', rows = [], depth = 0) {
  if (rows.length >= 160) return rows;
  if (depth > 8) {
    rows.push([prefix || '$', '[depth limit]']);
    return rows;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push([prefix || '$', '[]']);
    for (const [index, child] of value.entries()) flatten(child, `${prefix}[${index}]`, rows, depth + 1);
    return rows;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) rows.push([prefix || '$', '{}']);
    for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, rows, depth + 1);
    return rows;
  }
  rows.push([prefix || '$', value === null ? 'null' : String(value)]);
  return rows;
}

function renderKv(element, value) {
  element.replaceChildren();
  for (const [key, item] of flatten(value)) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = key;
    detail.textContent = item;
    row.append(term, detail);
    element.append(row);
  }
}

function addCheck(title, detail, digest) {
  const fragment = document.getElementById('check-template').content.cloneNode(true);
  fragment.querySelector('h3').textContent = title;
  fragment.querySelector('p').textContent = detail;
  fragment.querySelector('code').textContent = digest;
  document.getElementById('checks').append(fragment);
}

function publishRuntimeState(state) {
  window.__govJsonRuntime = state;
  document.getElementById('runtime-state').textContent = JSON.stringify(state);
}

async function main() {
  const { current, digest: currentDigest } = await fetchCurrent();
  const assets = [];
  for (const asset of current.assets) assets.push(await fetchExact(asset));
  const byRole = Object.fromEntries(assets.map((asset) => [asset.role, asset]));
  assert(byRole.decision && byRole.manifest && byRole.readback, 'required asset roles missing');

  addCheck('Current pointer', current.source.tag, currentDigest);
  for (const asset of assets) addCheck(asset.name, `${asset.bytes} bytes · exact same-origin mirror`, asset.digest);

  renderKv(document.getElementById('decision'), byRole.decision.value);
  renderKv(document.getElementById('manifest'), byRole.manifest.value);
  renderKv(document.getElementById('evidence'), byRole.readback.value);
  document.getElementById('raw').textContent = JSON.stringify({ current, assets: Object.fromEntries(assets.map((a) => [a.name, a.value])) }, null, 2);

  const state = {
    status: 'PASS',
    claimCeiling: current.claim_ceiling,
    currentDigest,
    sourceRelease: current.source.tag,
    sourceCommit: current.source.target_commit,
    viewContract: current.view_contract,
    assetCount: assets.length,
    assets: assets.map(({ name, role, bytes, digest }) => ({ name, role, bytes, digest, verified: true })),
    semanticReduce: false,
    byteIdenticalMirror: current.assertions.byte_identical_same_origin_mirror === true,
    productionPackageContract: false,
    authenticatedUi: false,
    providerE2e: false,
    authorityChanged: false,
    cutover: false,
  };
  publishRuntimeState(state);
  document.getElementById('status').textContent = 'PASS';
  document.body.dataset.status = 'ready';
}

main().catch((error) => {
  console.error(error);
  publishRuntimeState({ status: 'FAIL', error: String(error) });
  document.getElementById('status').textContent = 'FAIL';
  document.body.dataset.status = 'error';
  const box = document.createElement('pre');
  box.className = 'error';
  box.textContent = String(error?.stack || error);
  document.querySelector('main').prepend(box);
});
