#!/usr/bin/env node
// Route-gated GitHub egress over a tailnet App Connector.
//
// Node ESM port of ops-tailnet-github-egress.py (stdlib only, behavior-identical).

import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const DEFAULT_HOST = "100.124.250.91";
const DEFAULT_USER = "nixos";
const DEFAULT_TAG = "tag:github";
const STABLE_GITHUB_SSH_COMMAND =
  "ssh -4 " +
  "-o BatchMode=yes " +
  "-o ConnectTimeout=10 " +
  "-o ServerAliveInterval=5 " +
  "-o ServerAliveCountMax=1 " +
  "-o StrictHostKeyChecking=accept-new " +
  "-o KexAlgorithms=curve25519-sha256 " +
  "-o HostKeyAlgorithms=ssh-ed25519";
const GITHUB_SSH_COMMAND = `${STABLE_GITHUB_SSH_COMMAND} -T git@github.com`;
const TCP_MTU_PROBING_SYSCTL = "net.ipv4.tcp_mtu_probing";

// ---- JSON serializer matching json.dumps(indent=2, ensure_ascii=False, sort_keys=True) ----
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

// ---- shell quoting (shlex.quote / shlex.join) ----
const SHLEX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
function shlexQuote(s) {
  if (s === "") return "''";
  if (SHLEX_SAFE.test(s)) return s;
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}
function shlexJoin(parts) {
  return parts.map(shlexQuote).join(" ");
}
// shlex.split for the fixed GITHUB_SSH_COMMAND (simple whitespace split is sufficient here;
// the command contains no quotes or escapes).
function shlexSplit(s) {
  return s.split(/\s+/).filter((x) => x.length > 0);
}

function nowIso() {
  // Python datetime.now(timezone.utc).isoformat() -> "YYYY-MM-DDTHH:MM:SS.ssssss+00:00",
  // then ".replace('+00:00', 'Z')".
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const micros = pad(d.getUTCMilliseconds(), 3) + "000";
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${micros}Z`
  );
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return parseInt(v, 10);
}

function defaultConfig(args) {
  const host = args.host || process.env.OPS_TAILNET_GITHUB_EGRESS_HOST || DEFAULT_HOST;
  const user = args.user || process.env.OPS_TAILNET_GITHUB_EGRESS_USER || DEFAULT_USER;
  const tag = args.tag || process.env.OPS_TAILNET_GITHUB_EGRESS_TAG || DEFAULT_TAG;
  const sshTimeout = String(args.timeout || envInt("OPS_TAILNET_GITHUB_EGRESS_TIMEOUT", 25));
  const retries = Number(args.retries || envInt("OPS_TAILNET_GITHUB_EGRESS_RETRIES", 3));
  return {
    host,
    user,
    tag,
    sshTarget: `${user}@${host}`,
    timeout: sshTimeout,
    retries,
  };
}

function run(argv, { timeout = null, env = null } = {}) {
  const opts = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (timeout !== null && timeout !== undefined) opts.timeout = timeout * 1000;
  if (env !== null && env !== undefined) opts.env = env;
  // stderr merged into stdout (Python used stderr=STDOUT).
  const proc = spawnSync(argv[0], argv.slice(1), opts);
  if (proc.error && proc.error.code === "ETIMEDOUT") {
    return {
      argv,
      rc: 124,
      stdout: proc.stdout || "",
      timedOut: true,
    };
  }
  let stdout = proc.stdout || "";
  if (proc.stderr) stdout += proc.stderr;
  let rc = proc.status;
  if (rc === null) {
    // killed by signal without timeout error: mimic non-zero rc.
    rc = proc.signal ? 128 : 1;
  }
  return {
    argv,
    rc,
    stdout,
    timedOut: false,
  };
}

function runWithRetries(argv, { timeout = null, retries = 1, env = null } = {}) {
  const attempts = [];
  for (let i = 0; i < Math.max(1, retries); i++) {
    const result = run(argv, { timeout, env });
    attempts.push(result);
    if (result.rc === 0) {
      result.attempts = attempts;
      return result;
    }
  }
  const result = attempts[attempts.length - 1];
  result.attempts = attempts;
  return result;
}

function stableGithubSshCommand({ hostname = null, serverAliveInterval = 5, serverAliveCountMax = 1 } = {}) {
  const options = [
    "ssh",
    "-4",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    `ServerAliveInterval=${serverAliveInterval}`,
    "-o",
    `ServerAliveCountMax=${serverAliveCountMax}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "KexAlgorithms=curve25519-sha256",
    "-o",
    "HostKeyAlgorithms=ssh-ed25519",
  ];
  if (hostname) {
    options.push("-o", `HostName=${hostname}`, "-o", "HostKeyAlias=github.com");
  }
  return shlexJoin(options);
}

function runGithubSshAuthWithRetries({ timeout = null, retries = 1 } = {}) {
  const argv = shlexSplit(GITHUB_SSH_COMMAND);
  const attempts = [];
  for (let i = 0; i < Math.max(1, retries); i++) {
    const result = run(argv, { timeout });
    attempts.push(result);
    const stdout = result.stdout || "";
    if (result.rc === 1 && stdout.includes("Hi roccho-dev! You've successfully authenticated")) {
      result.attempts = attempts;
      return result;
    }
  }
  const result = attempts[attempts.length - 1];
  result.attempts = attempts;
  return result;
}

function sshArgv(cfg, remoteCommand) {
  return [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=1",
    "-o",
    "KexAlgorithms=curve25519-sha256",
    "-o",
    "HostKeyAlgorithms=ssh-ed25519",
    cfg.sshTarget,
    remoteCommand,
  ];
}

function policyDict(cfg) {
  return {
    schema: "ops-tailnet-github-egress.policy.v1",
    generatedAt: nowIso(),
    connectorTag: cfg.tag,
    remote: {
      host: cfg.host,
      user: cfg.user,
      sshTarget: cfg.sshTarget,
    },
    localForbidden: [
      "gh auth login",
      "gh api",
      "direct local GitHub API mutation",
      "direct local GitHub push unless every resolved github.com IPv4 route is verified through the tag:github App Connector",
    ],
    allowedLocalPushMode: {
      name: "route-gated local git push",
      rule: "local git push is allowed only when every resolved github.com IPv4 route is on tailscale0 before push",
      gitSshCommand: STABLE_GITHUB_SSH_COMMAND,
      longTransferRule:
        "for non-tiny pack uploads over tailscale0, use push-local --long-transfer so tcp_mtu_probing is set to 2 only during the push and then restored",
      requiredCommands: [
        "ops-tailnet-github-egress route-check --domain github.com --json",
        "ops-tailnet-github-egress github-ssh-check-local --json",
        "ops-tailnet-github-egress push-local --repo-dir <local-repo> --remote git@github.com:<owner>/<repo>.git --refspec <src:dst>",
        "ops-tailnet-github-egress push-local --long-transfer --repo-dir <local-repo> --remote git@github.com:<owner>/<repo>.git --refspec <src:dst>",
      ],
    },
    liveChecks: [
      `tailscale ping ${cfg.host}`,
      `ssh ${cfg.sshTarget} 'hostname; whoami'`,
      `ssh ${cfg.sshTarget} '${GITHUB_SSH_COMMAND}'`,
      "ops-tailnet-github-egress route-check --domain github.com --json",
      "ops-tailnet-github-egress github-ssh-check-local --json",
    ],
    githubSshCommand: GITHUB_SSH_COMMAND,
    gitSshCommand: STABLE_GITHUB_SSH_COMMAND,
    githubSshSuccessSubstring: "Hi roccho-dev! You've successfully authenticated",
    notes: [
      "GitHub SSH success normally returns exit code 1 because GitHub does not provide shell access.",
      "Use -4 for remote GitHub SSH checks because IPv6/name-resolution behavior has been flaky in staging.",
      "Pin KexAlgorithms=curve25519-sha256 because the default sntrup761x25519-sha512 exchange has stalled through the App Connector path.",
      "Large local pushes through tailscale0 can stall after pack upload unless Linux TCP MTU probing is enabled during the push.",
      "Repository creation is intentionally out of scope unless a remote-side, explicitly authorized mechanism exists.",
    ],
  };
}

function emit(data, asJson) {
  if (asJson) {
    process.stdout.write(dumpsSorted2(data) + "\n");
  } else {
    if (typeof data === "string") {
      process.stdout.write(data + "\n");
    } else {
      process.stdout.write(dumpsSorted2(data) + "\n");
    }
  }
}

function attemptCount(result) {
  return (result.attempts || [result]).length;
}

function cmdPolicy(args) {
  const cfg = defaultConfig(args);
  emit(policyDict(cfg), args.json);
  return 0;
}

function cmdCheck(args) {
  const cfg = defaultConfig(args);
  const timeout = parseInt(cfg.timeout, 10);
  const results = [];

  if (!args.skip_ping) {
    results.push([
      "tailscalePing",
      runWithRetries(["tailscale", "ping", "--timeout=5s", "--c", "1", cfg.host], { timeout: 10, retries: cfg.retries }),
    ]);
  }

  const remoteProbe = "echo remote-ok; hostname; whoami";
  results.push(["remoteExec", runWithRetries(sshArgv(cfg, remoteProbe), { timeout, retries: cfg.retries })]);

  const githubProbe = `${GITHUB_SSH_COMMAND} 2>&1; rc=$?; echo github_ssh_rc=$rc; test $rc -eq 1`;
  results.push(["remoteGitHubSsh", runWithRetries(sshArgv(cfg, githubProbe), { timeout, retries: cfg.retries })]);

  const checks = [];
  let ok = true;
  for (const [name, result] of results) {
    const stdout = result.stdout || "";
    let passed;
    if (name === "remoteGitHubSsh") {
      passed = result.rc === 0 && stdout.includes("Hi roccho-dev! You've successfully authenticated");
    } else if (name === "tailscalePing") {
      passed = stdout.includes("pong from ");
    } else {
      passed = result.rc === 0;
    }
    ok = ok && passed;
    checks.push({
      name,
      ok: passed,
      rc: result.rc,
      timedOut: result.timedOut,
      stdout: stdout.trim(),
      argv: result.argv,
      attemptCount: attemptCount(result),
    });
  }

  const report = {
    schema: "ops-tailnet-github-egress.check.v1",
    ok,
    policy: policyDict(cfg),
    checks,
  };
  emit(report, args.json);
  return ok ? 0 : 1;
}

function cmdGithubSshCheck(args) {
  const cfg = defaultConfig(args);
  const timeout = parseInt(cfg.timeout, 10);
  const githubProbe = `${GITHUB_SSH_COMMAND} 2>&1; rc=$?; echo github_ssh_rc=$rc; test $rc -eq 1`;
  const result = runWithRetries(sshArgv(cfg, githubProbe), { timeout, retries: cfg.retries });
  const stdout = result.stdout || "";
  const ok = result.rc === 0 && stdout.includes("Hi roccho-dev! You've successfully authenticated");
  const report = {
    schema: "ops-tailnet-github-egress.githubSshCheck.v1",
    ok,
    policy: policyDict(cfg),
    rc: result.rc,
    timedOut: result.timedOut,
    stdout: stdout.trim(),
    attemptCount: attemptCount(result),
  };
  emit(report, args.json);
  return ok ? 0 : 1;
}

function sleepSeconds(seconds) {
  // Synchronous sleep to match Python time.sleep() between resolve attempts.
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    // busy-wait; only used on DNS resolution retry which is rare.
  }
}

function githubIpv4s(domain, attempts = 3, delaySeconds = 1) {
  let last = [];
  const total = Math.max(1, attempts);
  for (let attempt = 0; attempt < total; attempt++) {
    try {
      last = lookupAllIpv4Sync(domain);
      if (last.length) return last;
    } catch {
      last = [];
    }
    if (attempt + 1 < attempts) {
      sleepSeconds(delaySeconds);
    }
  }
  return last;
}

// Synchronous IPv4 resolution. Python used socket.getaddrinfo(AF_INET, SOCK_STREAM),
// returning a sorted unique set of addresses. Node's dns API is async, so we resolve
// via a child node process to keep the surrounding control flow synchronous and the
// numeric output ordering identical to Python's sorted(set(...)).
function lookupAllIpv4Sync(domain) {
  const script =
    "const dns=require('node:dns');" +
    "dns.lookup(process.argv[1],{family:4,all:true},(e,a)=>{" +
    "if(e){process.exit(1);}" +
    "const s=[...new Set(a.map(x=>x.address))];" +
    "process.stdout.write(JSON.stringify(s));});";
  const proc = spawnSync(process.execPath, ["-e", script, domain], { encoding: "utf8" });
  if (proc.status !== 0 || !proc.stdout) {
    throw new Error("gaierror");
  }
  let arr;
  try {
    arr = JSON.parse(proc.stdout);
  } catch {
    throw new Error("gaierror");
  }
  return sortedIpv4(arr);
}

// Replicate Python sorted() on a set of IPv4 strings: lexicographic by code point.
function sortedIpv4(arr) {
  const uniq = [...new Set(arr)];
  uniq.sort();
  return uniq;
}

function localRouteCheck(domain, expectedDevice) {
  const ips = githubIpv4s(domain);
  const checks = [];
  for (const ip of ips) {
    const result = run(["ip", "route", "get", ip], { timeout: 5 });
    const stdout = result.stdout || "";
    const rowOk = result.rc === 0 && ` ${stdout} `.includes(` dev ${expectedDevice} `);
    checks.push({
      ip,
      ok: rowOk,
      route: stdout.trim(),
      rc: result.rc,
      timedOut: result.timedOut,
    });
  }
  const ok = checks.length > 0 && checks.every((row) => row.ok);
  return {
    schema: "ops-tailnet-github-egress.routeCheck.v1",
    domain,
    expectedDevice,
    ok,
    checks,
    checkedAllResolvedIPv4: true,
    rule: "every resolved IPv4 address for the domain must route through expectedDevice",
    gitSshCommand: STABLE_GITHUB_SSH_COMMAND,
  };
}

function firstRouteIp(routeReport) {
  for (const check of (routeReport && routeReport.checks) || []) {
    if (check.ok && check.ip) return check.ip;
  }
  return null;
}

function sysctlGet(name) {
  const result = run(["sysctl", "-n", name], { timeout: 5 });
  const value = (result.stdout || "").trim();
  return {
    ok: result.rc === 0 && value !== "",
    name,
    value,
    result,
  };
}

function sysctlSetSudo(name, value) {
  const result = run(["sudo", "-n", "sysctl", "-w", `${name}=${value}`], { timeout: 10 });
  return {
    ok: result.rc === 0,
    name,
    value: String(value),
    result,
  };
}

function cmdRouteCheck(args) {
  const report = localRouteCheck(args.domain, args.expected_device);
  emit(report, args.json);
  return report.ok ? 0 : 1;
}

function cmdGithubSshCheckLocal(args) {
  const timeout = parseInt(args.timeout || process.env.OPS_TAILNET_GITHUB_EGRESS_TIMEOUT || "25", 10);
  const command = GITHUB_SSH_COMMAND;
  const result = runGithubSshAuthWithRetries({ timeout, retries: args.retries });
  const stdout = result.stdout || "";
  const ok = result.rc === 1 && stdout.includes("Hi roccho-dev! You've successfully authenticated");
  const report = {
    schema: "ops-tailnet-github-egress.localGithubSshCheck.v1",
    ok,
    githubSshCommand: command,
    rc: result.rc,
    timedOut: result.timedOut,
    stdout: stdout.trim(),
    attemptCount: attemptCount(result),
  };
  emit(report, args.json);
  return ok ? 0 : 1;
}

function cmdExec(args) {
  const cfg = defaultConfig(args);
  if (!args.command || args.command.length === 0) {
    process.stderr.write("missing command\n");
    return 2;
  }
  const remoteCommand = args.command.map(shlexQuote).join(" ");
  const result = run(sshArgv(cfg, remoteCommand), { timeout: parseInt(cfg.timeout, 10) });
  if (args.json) {
    emit(
      {
        schema: "ops-tailnet-github-egress.exec.v1",
        ok: result.rc === 0,
        policy: policyDict(cfg),
        result,
      },
      true,
    );
  } else {
    process.stdout.write(result.stdout || "");
  }
  return result.rc;
}

function cmdPushLocal(args) {
  const longTransfer = args.long_transfer;
  const temporaryTcpMtuProbing = args.temporary_tcp_mtu_probing || longTransfer;
  const pinResolvedHost = args.pin_resolved_host || longTransfer;
  const serverAliveInterval =
    args.server_alive_interval !== null && args.server_alive_interval !== undefined
      ? args.server_alive_interval
      : longTransfer
        ? 30
        : 5;
  const serverAliveCountMax =
    args.server_alive_count_max !== null && args.server_alive_count_max !== undefined
      ? args.server_alive_count_max
      : longTransfer
        ? 4
        : 1;

  let routeReport;
  if (!args.skip_route_check) {
    routeReport = localRouteCheck(args.route_domain, args.expected_device);
    if (!routeReport.ok) {
      emit(
        {
          schema: "ops-tailnet-github-egress.pushLocal.v1",
          ok: false,
          failure: "route-check-failed",
          routeCheck: routeReport,
        },
        args.json,
      );
      return 1;
    }
  } else {
    routeReport = null;
  }

  let pinnedIp = null;
  if (pinResolvedHost) {
    pinnedIp = routeReport ? firstRouteIp(routeReport) : null;
    if (!pinnedIp) {
      const ips = githubIpv4s(args.route_domain);
      pinnedIp = ips.length ? ips[0] : null;
    }
    if (!pinnedIp) {
      emit(
        {
          schema: "ops-tailnet-github-egress.pushLocal.v1",
          ok: false,
          failure: "pin-resolved-host-failed",
          routeCheck: routeReport,
        },
        args.json,
      );
      return 1;
    }
  }

  let mtuReport = null;
  let restoreReport = null;
  if (temporaryTcpMtuProbing) {
    const before = sysctlGet(TCP_MTU_PROBING_SYSCTL);
    const setResult = sysctlSetSudo(TCP_MTU_PROBING_SYSCTL, "2");
    mtuReport = {
      enabled: setResult.ok,
      sysctl: TCP_MTU_PROBING_SYSCTL,
      before,
      set: setResult,
      restoreTarget: before.ok ? before.value : null,
    };
    if (!before.ok || !setResult.ok) {
      emit(
        {
          schema: "ops-tailnet-github-egress.pushLocal.v1",
          ok: false,
          failure: "temporary-tcp-mtu-probing-failed",
          routeCheck: routeReport,
          tcpMtuProbing: mtuReport,
        },
        args.json,
      );
      return 1;
    }
  }

  const env = { ...process.env };
  const gitSshCommand = stableGithubSshCommand({
    hostname: pinnedIp,
    serverAliveInterval,
    serverAliveCountMax,
  });
  env.GIT_SSH_COMMAND = gitSshCommand;
  const pushArgv = ["git", "-C", args.repo_dir];
  if (longTransfer) {
    pushArgv.push("-c", "pack.threads=1", "-c", "pack.window=10", "-c", "pack.depth=50");
  }
  pushArgv.push("push");
  if (args.progress || longTransfer) {
    pushArgv.push("--progress");
  }
  pushArgv.push(args.remote, args.refspec);

  let result;
  try {
    result = run(pushArgv, { timeout: parseInt(args.timeout, 10), env });
  } finally {
    if (temporaryTcpMtuProbing && mtuReport && mtuReport.restoreTarget !== null && mtuReport.restoreTarget !== undefined) {
      restoreReport = sysctlSetSudo(TCP_MTU_PROBING_SYSCTL, mtuReport.restoreTarget);
    }
  }

  const report = {
    schema: "ops-tailnet-github-egress.pushLocal.v1",
    ok: result.rc === 0,
    mode: "route-gated-local-git-push",
    longTransfer: longTransfer,
    repoDir: args.repo_dir,
    remote: args.remote,
    refspec: args.refspec,
    routeCheck: routeReport,
    pinResolvedHost: pinResolvedHost,
    pinnedIp: pinnedIp,
    gitSshCommand: gitSshCommand,
    tcpMtuProbing: mtuReport,
    tcpMtuProbingRestore: restoreReport,
    result,
  };
  emit(report, args.json);
  return result.rc;
}

function cmdPushExisting(args) {
  const cfg = defaultConfig(args);
  const remote = args.remote;
  const repoDir = args.repo_dir;
  const refspec = args.refspec;
  const remoteCommand =
    "set -euo pipefail; " +
    `cd ${shlexQuote(repoDir)}; ` +
    "git remote -v; " +
    `git push ${shlexQuote(remote)} ${shlexQuote(refspec)}`;
  const result = run(sshArgv(cfg, remoteCommand), { timeout: parseInt(cfg.timeout, 10) });
  if (args.json) {
    emit(
      {
        schema: "ops-tailnet-github-egress.pushExisting.v1",
        ok: result.rc === 0,
        policy: policyDict(cfg),
        remoteRepoDir: repoDir,
        remote,
        refspec,
        result,
      },
      true,
    );
  } else {
    process.stdout.write(result.stdout || "");
  }
  return result.rc;
}

// ---- argument parsing (faithful argparse reproduction; prog = ops-tailnet-github-egress) ----
const PROG = "ops-tailnet-github-egress";

// argparse top-level usage, byte-reproduced from argparse with prog="ops-tailnet-github-egress".
const TOP_USAGE =
  `usage: ${PROG} [-h]\n` +
  `                                 {policy,check,github-ssh-check,route-check,github-ssh-check-local,exec,push-local,push-existing} ...\n`;

// argparse top-level help (stdout, exit 0), byte-reproduced from argparse with
// prog="ops-tailnet-github-egress". No description was set on the parser.
const TOP_HELP =
  TOP_USAGE +
  `\n` +
  `positional arguments:\n` +
  `  {policy,check,github-ssh-check,route-check,github-ssh-check-local,exec,push-local,push-existing}\n` +
  `\n` +
  `options:\n` +
  `  -h, --help            show this help message and exit\n`;

// Per-subcommand usage blocks, byte-reproduced from argparse (prog="ops-tailnet-github-egress <cmd>").
// Only the subcommands that have an argparse-reachable error path (missing required
// argument) are reproduced here; the others have no required args.
const SUB_USAGE = {
  "push-local":
    `usage: ${PROG} push-local [-h] --repo-dir REPO_DIR\n` +
    `                                            --remote REMOTE --refspec REFSPEC\n` +
    `                                            [--route-domain ROUTE_DOMAIN]\n` +
    `                                            [--expected-device EXPECTED_DEVICE]\n` +
    `                                            [--timeout TIMEOUT]\n` +
    `                                            [--skip-route-check]\n` +
    `                                            [--long-transfer]\n` +
    `                                            [--temporary-tcp-mtu-probing]\n` +
    `                                            [--pin-resolved-host]\n` +
    `                                            [--server-alive-interval SERVER_ALIVE_INTERVAL]\n` +
    `                                            [--server-alive-count-max SERVER_ALIVE_COUNT_MAX]\n` +
    `                                            [--progress] [--json]\n`,
  "push-existing":
    `usage: ${PROG} push-existing [-h] [--host HOST]\n` +
    `                                               [--user USER] [--tag TAG]\n` +
    `                                               [--timeout TIMEOUT]\n` +
    `                                               [--retries RETRIES] [--json]\n` +
    `                                               --repo-dir REPO_DIR\n` +
    `                                               [--remote REMOTE]\n` +
    `                                               --refspec REFSPEC\n`,
};

// ---- argument parsing (replaces argparse) ----
// Top-level argparse errors (invalid choice, no subcommand): emit the top-level
// usage block followed by the error line, exit 2.
function usageError(msg) {
  process.stderr.write(TOP_USAGE);
  process.stderr.write(`${PROG}: error: ${msg}\n`);
  process.exit(2);
}

// Subcommand-level argparse errors (missing required arg): emit that subcommand's
// usage block followed by the "<prog> <cmd>: error:" line, exit 2.
function subUsageError(command, msg) {
  process.stderr.write(SUB_USAGE[command]);
  process.stderr.write(`${PROG} ${command}: error: ${msg}\n`);
  process.exit(2);
}

function parseCommon(rest, opts) {
  // opts: defaults object describing recognized flags
  const out = {
    host: null,
    user: null,
    tag: null,
    timeout: null,
    retries: null,
    json: false,
  };
  Object.assign(out, opts);
  const positionals = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--host") out.host = rest[++i];
    else if (a === "--user") out.user = rest[++i];
    else if (a === "--tag") out.tag = rest[++i];
    else if (a === "--timeout") out.timeout = parseInt(rest[++i], 10);
    else if (a === "--retries") out.retries = parseInt(rest[++i], 10);
    else if (a === "--json") out.json = true;
    else if (a === "--skip-ping" && "skip_ping" in out) out.skip_ping = true;
    else positionals.push(a);
  }
  out._positionals = positionals;
  return out;
}

function main(argv) {
  const args = argv === undefined ? process.argv.slice(2) : argv;
  if (args.length === 0) {
    usageError("the following arguments are required: command");
  }
  // argparse handles -h/--help on the top-level parser before subcommand dispatch.
  if (args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(TOP_HELP);
    process.exit(0);
  }
  const command = args[0];
  const rest = args.slice(1);

  if (command === "policy") {
    return cmdPolicy(parseCommon(rest, {}));
  }
  if (command === "check") {
    return cmdCheck(parseCommon(rest, { skip_ping: false }));
  }
  if (command === "github-ssh-check") {
    return cmdGithubSshCheck(parseCommon(rest, {}));
  }
  if (command === "route-check") {
    const out = { domain: "github.com", expected_device: "tailscale0", json: false };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--domain") out.domain = rest[++i];
      else if (a === "--expected-device") out.expected_device = rest[++i];
      else if (a === "--json") out.json = true;
    }
    return cmdRouteCheck(out);
  }
  if (command === "github-ssh-check-local") {
    const out = { timeout: 25, retries: 3, json: false };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--timeout") out.timeout = parseInt(rest[++i], 10);
      else if (a === "--retries") out.retries = parseInt(rest[++i], 10);
      else if (a === "--json") out.json = true;
    }
    return cmdGithubSshCheckLocal(out);
  }
  if (command === "exec") {
    // argparse.REMAINDER: everything after the first non-option positional is captured.
    const out = {
      host: null,
      user: null,
      tag: null,
      timeout: null,
      retries: null,
      json: false,
      command: [],
    };
    let i = 0;
    for (; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--host") out.host = rest[++i];
      else if (a === "--user") out.user = rest[++i];
      else if (a === "--tag") out.tag = rest[++i];
      else if (a === "--timeout") out.timeout = parseInt(rest[++i], 10);
      else if (a === "--retries") out.retries = parseInt(rest[++i], 10);
      else if (a === "--json") out.json = true;
      else break;
    }
    out.command = rest.slice(i);
    return cmdExec(out);
  }
  if (command === "push-local") {
    const out = {
      repo_dir: null,
      remote: null,
      refspec: null,
      route_domain: "github.com",
      expected_device: "tailscale0",
      timeout: 60,
      skip_route_check: false,
      long_transfer: false,
      temporary_tcp_mtu_probing: false,
      pin_resolved_host: false,
      server_alive_interval: null,
      server_alive_count_max: null,
      progress: false,
      json: false,
    };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--repo-dir") out.repo_dir = rest[++i];
      else if (a === "--remote") out.remote = rest[++i];
      else if (a === "--refspec") out.refspec = rest[++i];
      else if (a === "--route-domain") out.route_domain = rest[++i];
      else if (a === "--expected-device") out.expected_device = rest[++i];
      else if (a === "--timeout") out.timeout = parseInt(rest[++i], 10);
      else if (a === "--skip-route-check") out.skip_route_check = true;
      else if (a === "--long-transfer") out.long_transfer = true;
      else if (a === "--temporary-tcp-mtu-probing") out.temporary_tcp_mtu_probing = true;
      else if (a === "--pin-resolved-host") out.pin_resolved_host = true;
      else if (a === "--server-alive-interval") out.server_alive_interval = parseInt(rest[++i], 10);
      else if (a === "--server-alive-count-max") out.server_alive_count_max = parseInt(rest[++i], 10);
      else if (a === "--progress") out.progress = true;
      else if (a === "--json") out.json = true;
    }
    {
      const missing = [];
      if (out.repo_dir === null) missing.push("--repo-dir");
      if (out.remote === null) missing.push("--remote");
      if (out.refspec === null) missing.push("--refspec");
      if (missing.length) {
        subUsageError("push-local", `the following arguments are required: ${missing.join(", ")}`);
      }
    }
    return cmdPushLocal(out);
  }
  if (command === "push-existing") {
    const out2 = {
      host: null,
      user: null,
      tag: null,
      timeout: null,
      retries: null,
      json: false,
      repo_dir: null,
      remote: "origin",
      refspec: null,
    };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--host") out2.host = rest[++i];
      else if (a === "--user") out2.user = rest[++i];
      else if (a === "--tag") out2.tag = rest[++i];
      else if (a === "--timeout") out2.timeout = parseInt(rest[++i], 10);
      else if (a === "--retries") out2.retries = parseInt(rest[++i], 10);
      else if (a === "--json") out2.json = true;
      else if (a === "--repo-dir") out2.repo_dir = rest[++i];
      else if (a === "--remote") out2.remote = rest[++i];
      else if (a === "--refspec") out2.refspec = rest[++i];
    }
    {
      const missing = [];
      if (out2.repo_dir === null) missing.push("--repo-dir");
      if (out2.refspec === null) missing.push("--refspec");
      if (missing.length) {
        subUsageError("push-existing", `the following arguments are required: ${missing.join(", ")}`);
      }
    }
    return cmdPushExisting(out2);
  }
  usageError(
    `argument command: invalid choice: '${command}' (choose from policy, check, github-ssh-check, route-check, github-ssh-check-local, exec, push-local, push-existing)`,
  );
  return 2;
}

process.exit(main());
