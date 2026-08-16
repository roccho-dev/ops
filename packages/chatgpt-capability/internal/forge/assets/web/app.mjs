const summary = document.querySelector("#summary");
const recordsNode = document.querySelector("#records");
const queryNode = document.querySelector("#query");
const statusNode = document.querySelector("#status");
const proofNode = document.querySelector("#proof");

function parseJSONL(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`registry line ${index + 1}: ${error}`); }
  });
}

function escapeHTML(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function loadSearch(rawPath) {
  if (typeof Go !== "function") throw new Error("Go WASM host is unavailable");
  const go = new Go();
  const response = await fetch(rawPath, { cache: "no-store" });
  if (!response.ok) throw new Error(`search WASM HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  for (let i = 0; i < 200; i += 1) {
    if (typeof globalThis.capSearchScore === "function") return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("search WASM did not expose capSearchScore");
}

function renderRecord(record) {
  const impl = record.implementation;
  const decision = record.decision;
  const carrier = impl?.carrierPath ? `<a href="${escapeHTML(impl.carrierPath)}">carrier</a>` : "—";
  const projectionEntries = Object.keys(impl?.projection?.outputs || {}).sort();
  const projections = projectionEntries.length
    ? projectionEntries.map(path => `<a href="${escapeHTML(path)}">${escapeHTML(path.replace(/^\.\//, ""))}</a>`).join(" · ")
    : "—";
  const issues = record.issues?.length ? `<p><strong>issues:</strong> ${escapeHTML(record.issues.join(" / "))}</p>` : "";
  return `<article class="record">
    <h3>${escapeHTML(record.title || record.id)}</h3>
    <p><span class="status status-${escapeHTML(record.status)}">${escapeHTML(record.status)}</span> <code>${escapeHTML(record.id)}</code></p>
    <p>${escapeHTML(record.purpose || "")}</p>
    ${issues}
    <dl class="meta">
      <dt>decision at</dt><dd><code>${escapeHTML(decision?.at || "—")}</code></dd>
      <dt>observed at</dt><dd><code>${escapeHTML(impl?.at || "—")}</code></dd>
      <dt>runtime</dt><dd>${escapeHTML(impl ? `${impl.kind}/${impl.target}` : decision?.execution || "—")}</dd>
      <dt>payload</dt><dd>${impl?.payloadBytes ? `${impl.payloadBytes.toLocaleString()} bytes` : "—"}</dd>
      <dt>SHA-256</dt><dd><code>${escapeHTML(impl?.payloadSha256 || "—")}</code></dd>
      <dt>carrier</dt><dd>${carrier}</dd>
      <dt>projections</dt><dd>${projections}</dd>
    </dl>
  </article>`;
}

function filterAndRender(records) {
  const query = queryNode.value.trim();
  const status = statusNode.value;
  const ranked = records
    .filter(record => !status || record.status === status)
    .map(record => ({ record, score: query ? globalThis.capSearchScore(query, record.id, record.title || "", record.purpose || "", (record.tags || []).join(" "), record.status) : 1 }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  recordsNode.innerHTML = ranked.map(item => renderRecord(item.record)).join("") || "<p>該当なし</p>";
}

async function main() {
  const [bootstrapResponse, registryResponse] = await Promise.all([
    fetch("./.well-known/bootstrap.json", { cache: "no-store" }),
    fetch("./.well-known/registry.jsonl", { cache: "no-store" })
  ]);
  if (!bootstrapResponse.ok) throw new Error(`bootstrap HTTP ${bootstrapResponse.status}`);
  if (!registryResponse.ok) throw new Error(`registry HTTP ${registryResponse.status}`);
  const bootstrap = await bootstrapResponse.json();
  const records = parseJSONL(await registryResponse.text());
  await loadSearch(bootstrap.search.rawPath);
  queryNode.addEventListener("input", () => filterAndRender(records));
  statusNode.addEventListener("change", () => filterAndRender(records));
  filterAndRender(records);
  const counts = Object.fromEntries([...new Set(records.map(record => record.status))].sort().map(status => [status, records.filter(record => record.status === status).length]));
  const pass = !records.some(record => ["drift", "unobserved"].includes(record.status));
  document.body.dataset.proofStatus = pass ? "PASS" : "FAIL";
  summary.textContent = `${records.length}件 / active ${counts.active || 0} / platform cacheを再利用可能`;
  const proof = { schema: "capforge-browser-proof/1", status: pass ? "PASS" : "FAIL", counts, search: bootstrap.search.payloadSha256, registry: "./.well-known/registry.jsonl" };
  proofNode.textContent = JSON.stringify(proof, null, 2);
  if (new URL(location.href).searchParams.get("proof") === "1") {
    void fetch(`./__proof?status=${encodeURIComponent(proof.status)}&active=${counts.active || 0}&search=${encodeURIComponent(proof.search)}`, { cache: "no-store" });
  }
}

main().catch(error => {
  document.body.dataset.proofStatus = "FAIL";
  summary.textContent = `FAIL: ${error}`;
  proofNode.textContent = String(error?.stack || error);
  if (new URL(location.href).searchParams.get("proof") === "1") {
    void fetch(`./__proof?status=FAIL&error=${encodeURIComponent(String(error))}`, { cache: "no-store" });
  }
});
