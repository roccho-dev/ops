// Merge send-time DOM preflight evidence with `hq ui get` artifacts.
// Runtime: quickjs-ng (qjs) with `--std`.

function usage() {
  std.err.puts(
    "usage: qjs --std -m hq-run-manifest.mjs --sendDir <dir> --uiGetDir <dir> --outDir <dir>\n",
  );
  std.err.flush();
}

function parseArgs(argv) {
  const out = { sendDir: null, uiGetDir: null, outDir: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sendDir" && i + 1 < argv.length) out.sendDir = argv[++i];
    else if (a === "--uiGetDir" && i + 1 < argv.length) out.uiGetDir = argv[++i];
    else if (a === "--outDir" && i + 1 < argv.length) out.outDir = argv[++i];
    else if (a === "-h" || a === "--help") return null;
    else return null;
  }
  if (!out.sendDir || !out.uiGetDir || !out.outDir) return null;
  return out;
}

function ensureDir(path) {
  if (!path) return;
  try {
    os.mkdir(path, 0o755);
  } catch {
    // ignore if exists
  }
}

function readJson(path) {
  const raw = std.loadFile(path);
  if (raw === null || raw === undefined) throw new Error(`read_failed: ${path}`);
  return JSON.parse(String(raw));
}

function moveFile(src, dest) {
  const rc = os.rename(src, dest);
  if (rc === 0) return;
  // Fallback to read/write/remove. Manifest artifacts are text files.
  const data = std.loadFile(src);
  if (data === null || data === undefined) throw new Error(`copy read failed: ${src}`);
  std.writeFile(dest, data);
  os.remove(src);
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    usage();
    return 2;
  }

  ensureDir(args.outDir);

  const sendDir = String(args.sendDir);
  const uiGetDir = String(args.uiGetDir);
  const outDir = String(args.outDir);

  const sendDomPath = `${sendDir}/DOM_MODEL_PRE_SEND.json`;
  const sendMetaPath = `${sendDir}/SEND_META.json`;
  const uiManifestPath = `${uiGetDir}/MANIFEST.json`;

  const domPreSend = readJson(sendDomPath);
  const sendMeta = readJson(sendMetaPath);
  const uiManifest = readJson(uiManifestPath);

  const runManifest = {
    run_manifest_version: 1,
    ts_utc: new Date().toISOString(),
    send: {
      dir: sendDir,
      dom_model_pre_send_path: sendDomPath,
      send_meta_path: sendMetaPath,
      dom_model_pre_send: domPreSend && domPreSend.dom_model ? domPreSend.dom_model : null,
      dom_pre_send_ts_utc: domPreSend && domPreSend.ts_utc ? domPreSend.ts_utc : null,
      require_dom_pro: !!(domPreSend && domPreSend.require_dom_pro),
    },
    ui_get: {
      dir: uiGetDir,
      manifest_path: uiManifestPath,
      manifest: uiManifest,
    },
    cross_check: {
      dom_model_text: domPreSend && domPreSend.dom_model ? String(domPreSend.dom_model.model_text || "") : "",
      worker_model_label: uiManifest && uiManifest.model_label ? String(uiManifest.model_label) : "",
      worker_model_confirmation: uiManifest && uiManifest.model_confirmation ? String(uiManifest.model_confirmation) : "",
    },
  };

  const tmpPath = `${outDir}/RUN_MANIFEST.json.tmp`;
  const finalPath = `${outDir}/RUN_MANIFEST.json`;
  std.writeFile(tmpPath, JSON.stringify(runManifest, null, 2) + "\n");
  moveFile(tmpPath, finalPath);

  std.out.puts(JSON.stringify({ ok: true, run_manifest: finalPath }, null, 2) + "\n");
  std.out.flush();
  return 0;
}

try {
  std.exit(main(scriptArgs));
} catch (e) {
  std.err.puts(String(e && e.stack ? e.stack : e) + "\n");
  std.err.flush();
  std.exit(1);
}
