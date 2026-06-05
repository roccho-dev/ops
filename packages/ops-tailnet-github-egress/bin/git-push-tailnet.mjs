#!/usr/bin/env node
// Human Git subcommand wrapper for route-gated GitHub pushes.
//
// Installed as git-push-tailnet, so Git exposes it as `git push-tailnet`.
//
// Node ESM port of git-push-tailnet (Python), stdlib only, behavior-identical.

import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const DISABLED_PUSHURL_PREFIXES = ["DISABLED", "DISABLED-use-git-push-tailnet", "no_push", "NO_PUSH"];
const REPO_ID_RE = /^(?!\.)(?!.*\.\.)(?!.*\.lock$)(?!.*@\{)[A-Za-z0-9._-]+$/;

class PushTailnetError extends Error {}

// ---- JSON serializer matching json.dumps(ensure_ascii=False, indent=2, sort_keys=True) ----
function jsonString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code < 0x7f) out += ch;
    else if (code > 0xffff) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
    } else {
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out + '"';
}

function ser(value, sortKeys, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent) {
      const pad = " ".repeat(indent * (depth + 1));
      const closePad = " ".repeat(indent * depth);
      return "[\n" + value.map((v) => pad + ser(v, sortKeys, indent, depth + 1)).join(",\n") + "\n" + closePad + "]";
    }
    return "[" + value.map((v) => ser(v, sortKeys, indent, depth + 1)).join(", ") + "]";
  }
  let keys = Object.keys(value);
  if (sortKeys) keys = keys.sort();
  if (keys.length === 0) return "{}";
  if (indent) {
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    return (
      "{\n" +
      keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(",\n") +
      "\n" +
      closePad +
      "}"
    );
  }
  return "{" + keys.map((k) => jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(", ") + "}";
}

function dumpsSorted2(value) {
  return ser(value, true, 2, 0);
}

function run(argv, { cwd = null, check = true, capture = true, env = null } = {}) {
  const opts = { encoding: "utf8" };
  if (cwd !== null && cwd !== undefined) opts.cwd = cwd;
  if (env !== null && env !== undefined) opts.env = env;
  if (capture) {
    opts.stdio = ["ignore", "pipe", "pipe"];
  } else {
    opts.stdio = ["ignore", "inherit", "inherit"];
  }
  const proc = spawnSync(argv[0], argv.slice(1), opts);
  let rc = proc.status;
  if (rc === null) rc = proc.signal ? 128 : 1;
  const stdout = capture ? proc.stdout || "" : null;
  const stderr = capture ? proc.stderr || "" : null;
  if (check && rc !== 0) {
    throw new PushTailnetError(
      `command failed rc=${rc}: ${argv.join(" ")}\nstdout:\n${stdout || ""}\nstderr:\n${stderr || ""}`,
    );
  }
  return { returncode: rc, stdout, stderr };
}

function git(repo, args, { check = true } = {}) {
  const argv = ["git"];
  if (repo) argv.push("-C", repo);
  argv.push(...args);
  return run(argv, { check }).stdout.trim();
}

function repoRoot(start) {
  return git(start, ["rev-parse", "--show-toplevel"]);
}

function currentBranch(repo) {
  return git(repo, ["branch", "--show-current"]);
}

function localHead(repo, ref = "HEAD") {
  return git(repo, ["rev-parse", ref]);
}

function remoteUrl(repo, name, kind) {
  const args = ["remote", "get-url"];
  if (kind === "push") args.push("--push");
  args.push(name);
  const result = run(["git", "-C", repo, ...args], { check: false });
  if (result.returncode !== 0) return null;
  const trimmed = (result.stdout || "").trim();
  const value = trimmed ? trimmed.split("\n")[0] : null;
  return value;
}

function hasRemote(repo, name) {
  return run(["git", "-C", repo, "remote", "get-url", name], { check: false }).returncode === 0;
}

function disabledPushurl(value) {
  if (value === null || value === undefined) return false;
  return DISABLED_PUSHURL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function chooseRemote(repo, explicit) {
  if (explicit) return [explicit, "explicit"];
  if (hasRemote(repo, "tailnet-github")) {
    const push = remoteUrl(repo, "tailnet-github", "push");
    const fetch = remoteUrl(repo, "tailnet-github", "fetch");
    return [disabledPushurl(push) && fetch ? fetch : push || fetch || "tailnet-github", "tailnet-github"];
  }
  if (hasRemote(repo, "origin")) {
    const push = remoteUrl(repo, "origin", "push");
    const fetch = remoteUrl(repo, "origin", "fetch");
    if (disabledPushurl(push)) {
      if (!fetch) {
        throw new PushTailnetError("origin pushurl is disabled and origin fetch URL is missing; pass --remote");
      }
      return [fetch, "origin-fetch-because-pushurl-disabled"];
    }
    return [push || fetch || "origin", "origin"];
  }
  throw new PushTailnetError("no --remote, no tailnet-github remote, and no origin remote");
}

function remoteHost(remote) {
  if (remote.startsWith("git@")) {
    const rest = remote.split("@").slice(1).join("@");
    return rest.split(":")[0].split("/")[0];
  }
  // urlparse(remote): only return hostname when a scheme is present.
  const m = remote.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (m) {
    try {
      const u = new URL(remote);
      return u.hostname || null;
    } catch {
      return null;
    }
  }
  return null;
}

function requireGithubRemote(remote) {
  const host = remoteHost(remote);
  if (host !== "github.com") {
    throw new PushTailnetError(`refusing non-GitHub remote for tailnet push: ${remote}`);
  }
}

function validateRepoId(repoId) {
  if (!repoId || repoId.includes("/") || !REPO_ID_RE.test(repoId)) {
    throw new PushTailnetError(`invalid repo-id: ${repoId}`);
  }
}

function validateBranch(branch) {
  if (!branch || branch.startsWith("/") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{")) {
    throw new PushTailnetError(`invalid branch: ${branch}`);
  }
}

function parseRefspec(refspec) {
  if (!refspec.includes(":")) {
    throw new PushTailnetError("refspec must be explicit <src>:<dst> so remote head can be verified");
  }
  const idx = refspec.indexOf(":");
  const src = refspec.slice(0, idx);
  const dst = refspec.slice(idx + 1);
  if (!src || !dst) {
    throw new PushTailnetError("refspec must include both source and destination");
  }
  return [src, dst];
}

function resolveRefspec(repo, args) {
  if (args.refs_vault) {
    if (!args.repo_id || !args.branch) {
      throw new PushTailnetError("--refs-vault requires --repo-id and --branch");
    }
    validateRepoId(args.repo_id);
    validateBranch(args.branch);
    const dst = `refs/heads/repos/${args.repo_id}/${args.branch}`;
    return ["HEAD", dst, `HEAD:${dst}`];
  }
  if (args.refspec) {
    const [src, dst] = parseRefspec(args.refspec);
    return [src, dst, args.refspec];
  }
  const branch = currentBranch(repo);
  if (!branch) {
    throw new PushTailnetError("detached HEAD requires an explicit refspec");
  }
  const dst = `refs/heads/${branch}`;
  return ["HEAD", dst, `HEAD:${dst}`];
}

function buildLowLevelCommand(repo, remote, refspec, args) {
  return [
    args.egress_bin,
    "push-local",
    "--long-transfer",
    "--repo-dir",
    repo,
    "--remote",
    remote,
    "--refspec",
    refspec,
    "--timeout",
    String(args.timeout),
    "--json",
  ];
}

function emitText(resolved, lowLevel) {
  if (lowLevel) {
    const verify = lowLevel.remoteHeadCheck || {};
    const status = lowLevel.ok ? "ok" : "failed";
    process.stdout.write(
      `git push-tailnet ${status}: ` +
        `localHead=${resolved.localHead} ` +
        `dstRef=${resolved.dstRef} ` +
        `remoteHead=${verify.remoteHead}\n`,
    );
  } else {
    process.stdout.write(
      "git push-tailnet dry-run: " +
        resolved.command.join(" ") +
        ` localHead=${resolved.localHead} dstRef=${resolved.dstRef}\n`,
    );
  }
}

function parseArgs(argv) {
  const out = {
    refspec: null,
    repo_dir: ".",
    remote: null,
    refs_vault: false,
    repo_id: null,
    branch: null,
    timeout: 600,
    egress_bin: process.env.OPS_TAILNET_GITHUB_EGRESS_BIN || "ops-tailnet-github-egress",
    dry_run: false,
    json: false,
  };
  let positionalSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo-dir") out.repo_dir = argv[++i];
    else if (a === "--remote") out.remote = argv[++i];
    else if (a === "--refs-vault") out.refs_vault = true;
    else if (a === "--repo-id") out.repo_id = argv[++i];
    else if (a === "--branch") out.branch = argv[++i];
    else if (a === "--timeout") out.timeout = parseInt(argv[++i], 10);
    else if (a === "--egress-bin") out.egress_bin = argv[++i];
    else if (a === "--dry-run") out.dry_run = true;
    else if (a === "--json") out.json = true;
    else {
      if (positionalSet) {
        process.stderr.write(`git push-tailnet: error: unrecognized arguments: ${a}\n`);
        process.exit(2);
      }
      out.refspec = a;
      positionalSet = true;
    }
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv === undefined ? process.argv.slice(2) : argv);

  try {
    const repo = repoRoot(args.repo_dir);
    const [remote, remoteSource] = chooseRemote(repo, args.remote);
    requireGithubRemote(remote);
    const [srcRef, dstRef, refspec] = resolveRefspec(repo, args);
    const localSha = localHead(repo, srcRef);
    const command = buildLowLevelCommand(repo, remote, refspec, args);
    const resolved = {
      schema: "git-push-tailnet.resolved.v1",
      repoDir: repo,
      remote,
      remoteSource,
      srcRef,
      dstRef,
      refspec,
      localHead: localSha,
      command,
    };
    if (args.dry_run) {
      const report = { ok: true, dryRun: true, ...resolved };
      if (args.json) {
        process.stdout.write(dumpsSorted2(report) + "\n");
      } else {
        emitText(report, null);
      }
      return 0;
    }

    const result = run(command, { check: false });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      parsed = null;
    }
    if (args.json) {
      process.stdout.write(
        dumpsSorted2({
          ok: result.returncode === 0 && Boolean(parsed && parsed.ok),
          resolved,
          lowLevel: parsed,
          stdout: result.stdout,
          stderr: result.stderr,
          rc: result.returncode,
        }) + "\n",
      );
    } else {
      if (parsed !== null) {
        emitText(resolved, parsed);
      } else {
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
      }
    }
    return result.returncode === 0 && parsed && parsed.ok ? 0 : 1;
  } catch (exc) {
    if (exc instanceof PushTailnetError) {
      const report = { ok: false, error: String(exc.message) };
      if (args.json) {
        process.stdout.write(dumpsSorted2(report) + "\n");
      } else {
        process.stderr.write(`git push-tailnet failed: ${exc.message}\n`);
      }
      return 2;
    }
    throw exc;
  }
}

process.exit(main());
