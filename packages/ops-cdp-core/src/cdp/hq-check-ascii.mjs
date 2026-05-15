// Check a text file is ASCII-only (plus tab/newline/CR).
// Runtime: quickjs-ng (qjs) with `--std`.

function usage() {
  std.err.puts(
    "usage: qjs --std -m hq-check-ascii.mjs --path <file> [--max 20]\n",
  );
  std.err.flush();
}

function parseArgs(argv) {
  const out = { path: null, max: 20 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path" && i + 1 < argv.length) out.path = argv[++i];
    else if (a === "--max" && i + 1 < argv.length) out.max = Number(argv[++i]) || out.max;
    else if (a === "-h" || a === "--help") return null;
    else return null;
  }
  if (!out.path) return null;
  return out;
}

function isAllowedAsciiCode(code) {
  // Allow: tab, LF, CR, and printable ASCII.
  if (code === 0x09 || code === 0x0A || code === 0x0D) return true;
  return code >= 0x20 && code <= 0x7E;
}

function lineColAt(s, index) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x0A) {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    usage();
    return 2;
  }

  const raw = std.loadFile(args.path);
  if (raw === null || raw === undefined) {
    std.out.puts(JSON.stringify({ ok: false, path: String(args.path), reason: "read_failed" }, null, 2) + "\n");
    std.out.flush();
    return 2;
  }

  const s = String(raw);
  const bad = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (isAllowedAsciiCode(code)) continue;
    const lc = lineColAt(s, i);
    bad.push({ index: i, line: lc.line, col: lc.col, code });
    if (bad.length >= Math.max(1, args.max | 0)) break;
  }

  const ok = bad.length === 0;
  std.out.puts(JSON.stringify({
    ok,
    path: String(args.path),
    len: s.length,
    bad_count: bad.length,
    bad_examples: bad,
  }, null, 2) + "\n");
  std.out.flush();
  return ok ? 0 : 3;
}

try {
  std.exit(main(scriptArgs));
} catch (e) {
  std.err.puts(String(e && e.stack ? e.stack : e) + "\n");
  std.err.flush();
  std.exit(1);
}
