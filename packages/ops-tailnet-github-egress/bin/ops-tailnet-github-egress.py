#!/usr/bin/env python3
import argparse
import json
import os
import shlex
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone


DEFAULT_HOST = "100.124.250.91"
DEFAULT_USER = "nixos"
DEFAULT_TAG = "tag:github"
STABLE_GITHUB_SSH_COMMAND = (
    "ssh -4 "
    "-o BatchMode=yes "
    "-o ConnectTimeout=10 "
    "-o ServerAliveInterval=5 "
    "-o ServerAliveCountMax=1 "
    "-o StrictHostKeyChecking=accept-new "
    "-o KexAlgorithms=curve25519-sha256 "
    "-o HostKeyAlgorithms=ssh-ed25519"
)
GITHUB_SSH_COMMAND = f"{STABLE_GITHUB_SSH_COMMAND} -T git@github.com"
TCP_MTU_PROBING_SYSCTL = "net.ipv4.tcp_mtu_probing"


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_config(args):
    host = args.host or os.environ.get("OPS_TAILNET_GITHUB_EGRESS_HOST", DEFAULT_HOST)
    user = args.user or os.environ.get("OPS_TAILNET_GITHUB_EGRESS_USER", DEFAULT_USER)
    tag = args.tag or os.environ.get("OPS_TAILNET_GITHUB_EGRESS_TAG", DEFAULT_TAG)
    ssh_timeout = str(args.timeout or int(os.environ.get("OPS_TAILNET_GITHUB_EGRESS_TIMEOUT", "25")))
    retries = int(args.retries or int(os.environ.get("OPS_TAILNET_GITHUB_EGRESS_RETRIES", "3")))
    return {
        "host": host,
        "user": user,
        "tag": tag,
        "sshTarget": f"{user}@{host}",
        "timeout": ssh_timeout,
        "retries": retries,
    }


def run(argv, timeout=None, env=None):
    try:
        proc = subprocess.run(
            argv,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
            env=env,
        )
        return {
            "argv": argv,
            "rc": proc.returncode,
            "stdout": proc.stdout,
            "timedOut": False,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "argv": argv,
            "rc": 124,
            "stdout": exc.stdout or "",
            "timedOut": True,
        }


def run_with_retries(argv, timeout=None, retries=1, env=None):
    attempts = []
    for _ in range(max(1, retries)):
        result = run(argv, timeout=timeout, env=env)
        attempts.append(result)
        if result["rc"] == 0:
            result["attempts"] = attempts
            return result
    result = attempts[-1]
    result["attempts"] = attempts
    return result


def stable_github_ssh_command(hostname=None, server_alive_interval=5, server_alive_count_max=1):
    options = [
        "ssh",
        "-4",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        f"ServerAliveInterval={server_alive_interval}",
        "-o",
        f"ServerAliveCountMax={server_alive_count_max}",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "KexAlgorithms=curve25519-sha256",
        "-o",
        "HostKeyAlgorithms=ssh-ed25519",
    ]
    if hostname:
        options.extend(["-o", f"HostName={hostname}", "-o", "HostKeyAlias=github.com"])
    return shlex.join(options)


def run_github_ssh_auth_with_retries(timeout=None, retries=1):
    argv = shlex.split(GITHUB_SSH_COMMAND)
    attempts = []
    for _ in range(max(1, retries)):
        result = run(argv, timeout=timeout)
        attempts.append(result)
        stdout = result["stdout"] or ""
        if result["rc"] == 1 and "Hi roccho-dev! You've successfully authenticated" in stdout:
            result["attempts"] = attempts
            return result
    result = attempts[-1]
    result["attempts"] = attempts
    return result


def ssh_argv(cfg, remote_command):
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
        cfg["sshTarget"],
        remote_command,
    ]


def policy_dict(cfg):
    return {
        "schema": "ops-tailnet-github-egress.policy.v1",
        "generatedAt": now_iso(),
        "connectorTag": cfg["tag"],
        "remote": {
            "host": cfg["host"],
            "user": cfg["user"],
            "sshTarget": cfg["sshTarget"],
        },
        "localForbidden": [
            "gh auth login",
            "gh api",
            "direct local GitHub API mutation",
            "direct local GitHub push unless every resolved github.com IPv4 route is verified through the tag:github App Connector",
        ],
        "allowedLocalPushMode": {
            "name": "route-gated local git push",
            "rule": "local git push is allowed only when every resolved github.com IPv4 route is on tailscale0 before push",
            "gitSshCommand": STABLE_GITHUB_SSH_COMMAND,
            "longTransferRule": "for non-tiny pack uploads over tailscale0, use push-local --long-transfer so tcp_mtu_probing is set to 2 only during the push and then restored",
            "requiredCommands": [
                "ops-tailnet-github-egress route-check --domain github.com --json",
                "ops-tailnet-github-egress github-ssh-check-local --json",
                "ops-tailnet-github-egress push-local --repo-dir <local-repo> --remote git@github.com:<owner>/<repo>.git --refspec <src:dst>",
                "ops-tailnet-github-egress push-local --long-transfer --repo-dir <local-repo> --remote git@github.com:<owner>/<repo>.git --refspec <src:dst>",
            ],
        },
        "liveChecks": [
            f"tailscale ping {cfg['host']}",
            f"ssh {cfg['sshTarget']} 'hostname; whoami'",
            f"ssh {cfg['sshTarget']} '{GITHUB_SSH_COMMAND}'",
            "ops-tailnet-github-egress route-check --domain github.com --json",
            "ops-tailnet-github-egress github-ssh-check-local --json",
        ],
        "githubSshCommand": GITHUB_SSH_COMMAND,
        "gitSshCommand": STABLE_GITHUB_SSH_COMMAND,
        "githubSshSuccessSubstring": "Hi roccho-dev! You've successfully authenticated",
        "notes": [
            "GitHub SSH success normally returns exit code 1 because GitHub does not provide shell access.",
            "Use -4 for remote GitHub SSH checks because IPv6/name-resolution behavior has been flaky in staging.",
            "Pin KexAlgorithms=curve25519-sha256 because the default sntrup761x25519-sha512 exchange has stalled through the App Connector path.",
            "Large local pushes through tailscale0 can stall after pack upload unless Linux TCP MTU probing is enabled during the push.",
            "Repository creation is intentionally out of scope unless a remote-side, explicitly authorized mechanism exists.",
        ],
    }


def emit(data, as_json):
    if as_json:
        print(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True))
    else:
        if isinstance(data, str):
            print(data)
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True))


def cmd_policy(args):
    cfg = default_config(args)
    emit(policy_dict(cfg), args.json)
    return 0


def cmd_check(args):
    cfg = default_config(args)
    timeout = int(cfg["timeout"])
    results = []

    if not args.skip_ping:
        results.append(("tailscalePing", run_with_retries(["tailscale", "ping", "--timeout=5s", "--c", "1", cfg["host"]], timeout=10, retries=cfg["retries"])))

    remote_probe = "echo remote-ok; hostname; whoami"
    results.append(("remoteExec", run_with_retries(ssh_argv(cfg, remote_probe), timeout=timeout, retries=cfg["retries"])))

    github_probe = f"{GITHUB_SSH_COMMAND} 2>&1; rc=$?; echo github_ssh_rc=$rc; test $rc -eq 1"
    results.append(("remoteGitHubSsh", run_with_retries(ssh_argv(cfg, github_probe), timeout=timeout, retries=cfg["retries"])))

    checks = []
    ok = True
    for name, result in results:
        stdout = result["stdout"] or ""
        if name == "remoteGitHubSsh":
            passed = result["rc"] == 0 and "Hi roccho-dev! You've successfully authenticated" in stdout
        elif name == "tailscalePing":
            # tailscale ping can return non-zero when DERP is used or a direct
            # path is not established. A pong still proves tailnet reachability.
            passed = "pong from " in stdout
        else:
            passed = result["rc"] == 0
        ok = ok and passed
        checks.append({
            "name": name,
            "ok": passed,
            "rc": result["rc"],
            "timedOut": result["timedOut"],
            "stdout": stdout.strip(),
            "argv": result["argv"],
            "attemptCount": len(result.get("attempts", [result])),
        })

    report = {
        "schema": "ops-tailnet-github-egress.check.v1",
        "ok": ok,
        "policy": policy_dict(cfg),
        "checks": checks,
    }
    emit(report, args.json)
    return 0 if ok else 1


def cmd_github_ssh_check(args):
    cfg = default_config(args)
    timeout = int(cfg["timeout"])
    github_probe = f"{GITHUB_SSH_COMMAND} 2>&1; rc=$?; echo github_ssh_rc=$rc; test $rc -eq 1"
    result = run_with_retries(ssh_argv(cfg, github_probe), timeout=timeout, retries=cfg["retries"])
    stdout = result["stdout"] or ""
    ok = result["rc"] == 0 and "Hi roccho-dev! You've successfully authenticated" in stdout
    report = {
        "schema": "ops-tailnet-github-egress.githubSshCheck.v1",
        "ok": ok,
        "policy": policy_dict(cfg),
        "rc": result["rc"],
        "timedOut": result["timedOut"],
        "stdout": stdout.strip(),
        "attemptCount": len(result.get("attempts", [result])),
    }
    emit(report, args.json)
    return 0 if ok else 1


def github_ipv4s(domain, attempts=3, delay_seconds=1):
    last = []
    for attempt in range(max(1, attempts)):
        try:
            rows = socket.getaddrinfo(domain, None, socket.AF_INET, socket.SOCK_STREAM)
            last = sorted({row[4][0] for row in rows})
            if last:
                return last
        except socket.gaierror:
            last = []
        if attempt + 1 < attempts:
            time.sleep(delay_seconds)
    return last


def local_route_check(domain, expected_device):
    ips = github_ipv4s(domain)
    checks = []
    for ip in ips:
        result = run(["ip", "route", "get", ip], timeout=5)
        stdout = result["stdout"] or ""
        row_ok = result["rc"] == 0 and f" dev {expected_device} " in f" {stdout} "
        checks.append({
            "ip": ip,
            "ok": row_ok,
            "route": stdout.strip(),
            "rc": result["rc"],
            "timedOut": result["timedOut"],
        })
    ok = bool(checks) and all(row["ok"] for row in checks)
    return {
        "schema": "ops-tailnet-github-egress.routeCheck.v1",
        "domain": domain,
        "expectedDevice": expected_device,
        "ok": ok,
        "checks": checks,
        "checkedAllResolvedIPv4": True,
        "rule": "every resolved IPv4 address for the domain must route through expectedDevice",
        "gitSshCommand": STABLE_GITHUB_SSH_COMMAND,
    }


def first_route_ip(route_report):
    for check in route_report.get("checks", []):
        if check.get("ok") and check.get("ip"):
            return check["ip"]
    return None


def sysctl_get(name):
    result = run(["sysctl", "-n", name], timeout=5)
    value = (result["stdout"] or "").strip()
    return {
        "ok": result["rc"] == 0 and value != "",
        "name": name,
        "value": value,
        "result": result,
    }


def sysctl_set_sudo(name, value):
    result = run(["sudo", "-n", "sysctl", "-w", f"{name}={value}"], timeout=10)
    return {
        "ok": result["rc"] == 0,
        "name": name,
        "value": str(value),
        "result": result,
    }


def cmd_route_check(args):
    report = local_route_check(args.domain, args.expected_device)
    emit(report, args.json)
    return 0 if report["ok"] else 1


def cmd_github_ssh_check_local(args):
    timeout = int(args.timeout or os.environ.get("OPS_TAILNET_GITHUB_EGRESS_TIMEOUT", "25"))
    command = GITHUB_SSH_COMMAND
    result = run_github_ssh_auth_with_retries(timeout=timeout, retries=args.retries)
    stdout = result["stdout"] or ""
    ok = result["rc"] == 1 and "Hi roccho-dev! You've successfully authenticated" in stdout
    report = {
        "schema": "ops-tailnet-github-egress.localGithubSshCheck.v1",
        "ok": ok,
        "githubSshCommand": command,
        "rc": result["rc"],
        "timedOut": result["timedOut"],
        "stdout": stdout.strip(),
        "attemptCount": len(result.get("attempts", [result])),
    }
    emit(report, args.json)
    return 0 if ok else 1


def cmd_exec(args):
    cfg = default_config(args)
    if not args.command:
        print("missing command", file=sys.stderr)
        return 2
    remote_command = " ".join(shlex.quote(part) for part in args.command)
    result = run(ssh_argv(cfg, remote_command), timeout=int(cfg["timeout"]))
    if args.json:
        emit({
            "schema": "ops-tailnet-github-egress.exec.v1",
            "ok": result["rc"] == 0,
            "policy": policy_dict(cfg),
            "result": result,
        }, True)
    else:
        sys.stdout.write(result["stdout"] or "")
    return result["rc"]


def cmd_push_local(args):
    long_transfer = args.long_transfer
    temporary_tcp_mtu_probing = args.temporary_tcp_mtu_probing or long_transfer
    pin_resolved_host = args.pin_resolved_host or long_transfer
    server_alive_interval = args.server_alive_interval if args.server_alive_interval is not None else (30 if long_transfer else 5)
    server_alive_count_max = args.server_alive_count_max if args.server_alive_count_max is not None else (4 if long_transfer else 1)

    if not args.skip_route_check:
        route_report = local_route_check(args.route_domain, args.expected_device)
        if not route_report["ok"]:
            emit({
                "schema": "ops-tailnet-github-egress.pushLocal.v1",
                "ok": False,
                "failure": "route-check-failed",
                "routeCheck": route_report,
            }, args.json)
            return 1
    else:
        route_report = None

    pinned_ip = None
    if pin_resolved_host:
        pinned_ip = first_route_ip(route_report) if route_report else None
        if not pinned_ip:
            ips = github_ipv4s(args.route_domain)
            pinned_ip = ips[0] if ips else None
        if not pinned_ip:
            emit({
                "schema": "ops-tailnet-github-egress.pushLocal.v1",
                "ok": False,
                "failure": "pin-resolved-host-failed",
                "routeCheck": route_report,
            }, args.json)
            return 1

    mtu_report = None
    restore_report = None
    if temporary_tcp_mtu_probing:
        before = sysctl_get(TCP_MTU_PROBING_SYSCTL)
        set_result = sysctl_set_sudo(TCP_MTU_PROBING_SYSCTL, "2")
        mtu_report = {
            "enabled": set_result["ok"],
            "sysctl": TCP_MTU_PROBING_SYSCTL,
            "before": before,
            "set": set_result,
            "restoreTarget": before.get("value") if before.get("ok") else None,
        }
        if not before["ok"] or not set_result["ok"]:
            emit({
                "schema": "ops-tailnet-github-egress.pushLocal.v1",
                "ok": False,
                "failure": "temporary-tcp-mtu-probing-failed",
                "routeCheck": route_report,
                "tcpMtuProbing": mtu_report,
            }, args.json)
            return 1

    env = os.environ.copy()
    git_ssh_command = stable_github_ssh_command(
        hostname=pinned_ip,
        server_alive_interval=server_alive_interval,
        server_alive_count_max=server_alive_count_max,
    )
    env["GIT_SSH_COMMAND"] = git_ssh_command
    push_argv = ["git", "-C", args.repo_dir]
    if long_transfer:
        push_argv.extend(["-c", "pack.threads=1", "-c", "pack.window=10", "-c", "pack.depth=50"])
    push_argv.append("push")
    if args.progress or long_transfer:
        push_argv.append("--progress")
    push_argv.extend([args.remote, args.refspec])

    try:
        result = run(push_argv, timeout=int(args.timeout), env=env)
    finally:
        if temporary_tcp_mtu_probing and mtu_report and mtu_report.get("restoreTarget") is not None:
            restore_report = sysctl_set_sudo(TCP_MTU_PROBING_SYSCTL, mtu_report["restoreTarget"])

    report = {
        "schema": "ops-tailnet-github-egress.pushLocal.v1",
        "ok": result["rc"] == 0,
        "mode": "route-gated-local-git-push",
        "longTransfer": long_transfer,
        "repoDir": args.repo_dir,
        "remote": args.remote,
        "refspec": args.refspec,
        "routeCheck": route_report,
        "pinResolvedHost": pin_resolved_host,
        "pinnedIp": pinned_ip,
        "gitSshCommand": git_ssh_command,
        "tcpMtuProbing": mtu_report,
        "tcpMtuProbingRestore": restore_report,
        "result": result,
    }
    emit(report, args.json)
    return result["rc"]


def cmd_push_existing(args):
    cfg = default_config(args)
    remote = args.remote
    repo_dir = args.repo_dir
    refspec = args.refspec
    # Do the actual GitHub operation only on the remote egress host.
    remote_command = (
        "set -euo pipefail; "
        f"cd {shlex.quote(repo_dir)}; "
        f"git remote -v; "
        f"git push {shlex.quote(remote)} {shlex.quote(refspec)}"
    )
    result = run(ssh_argv(cfg, remote_command), timeout=int(cfg["timeout"]))
    if args.json:
        emit({
            "schema": "ops-tailnet-github-egress.pushExisting.v1",
            "ok": result["rc"] == 0,
            "policy": policy_dict(cfg),
            "remoteRepoDir": repo_dir,
            "remote": remote,
            "refspec": refspec,
            "result": result,
        }, True)
    else:
        sys.stdout.write(result["stdout"] or "")
    return result["rc"]


def add_common(parser):
    parser.add_argument("--host", default=None, help=f"egress host IP/name; default {DEFAULT_HOST}")
    parser.add_argument("--user", default=None, help=f"egress ssh user; default {DEFAULT_USER}")
    parser.add_argument("--tag", default=None, help=f"connector tag; default {DEFAULT_TAG}")
    parser.add_argument("--timeout", type=int, default=None, help="per command timeout seconds")
    parser.add_argument("--retries", type=int, default=None, help="retry count for flaky tailnet ssh checks")
    parser.add_argument("--json", action="store_true", help="emit JSON")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="ops-tailnet-github-egress")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("policy")
    add_common(p)
    p.set_defaults(func=cmd_policy)

    p = sub.add_parser("check")
    add_common(p)
    p.add_argument("--skip-ping", action="store_true", help="skip tailscale ping")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("github-ssh-check")
    add_common(p)
    p.set_defaults(func=cmd_github_ssh_check)

    p = sub.add_parser("route-check")
    p.add_argument("--domain", default="github.com", help="domain to resolve and route-check")
    p.add_argument("--expected-device", default="tailscale0", help="required route device")
    p.add_argument("--json", action="store_true", help="emit JSON")
    p.set_defaults(func=cmd_route_check)

    p = sub.add_parser("github-ssh-check-local")
    p.add_argument("--timeout", type=int, default=25, help="per command timeout seconds")
    p.add_argument("--retries", type=int, default=3, help="retry count")
    p.add_argument("--json", action="store_true", help="emit JSON")
    p.set_defaults(func=cmd_github_ssh_check_local)

    p = sub.add_parser("exec")
    add_common(p)
    p.add_argument("command", nargs=argparse.REMAINDER, help="remote command to run after --")
    p.set_defaults(func=cmd_exec)

    p = sub.add_parser("push-local")
    p.add_argument("--repo-dir", required=True, help="local repository path")
    p.add_argument("--remote", required=True, help="GitHub remote URL, for example git@github.com:owner/repo.git")
    p.add_argument("--refspec", required=True, help="git push refspec")
    p.add_argument("--route-domain", default="github.com", help="domain to verify before push")
    p.add_argument("--expected-device", default="tailscale0", help="required route device")
    p.add_argument("--timeout", type=int, default=60, help="git push timeout seconds")
    p.add_argument("--skip-route-check", action="store_true", help="skip route gate; for diagnostics only")
    p.add_argument("--long-transfer", action="store_true", help="preset for non-tiny App Connector pushes: pin resolved host, enable temporary TCP MTU probing, use longer keepalive, and show progress")
    p.add_argument("--temporary-tcp-mtu-probing", action="store_true", help="temporarily set net.ipv4.tcp_mtu_probing=2 with sudo -n during push and restore it afterward")
    p.add_argument("--pin-resolved-host", action="store_true", help="pin SSH HostName to the route-checked IPv4 and use HostKeyAlias=github.com")
    p.add_argument("--server-alive-interval", type=int, default=None, help="SSH ServerAliveInterval for GitHub push")
    p.add_argument("--server-alive-count-max", type=int, default=None, help="SSH ServerAliveCountMax for GitHub push")
    p.add_argument("--progress", action="store_true", help="pass --progress to git push")
    p.add_argument("--json", action="store_true", help="emit JSON")
    p.set_defaults(func=cmd_push_local)

    p = sub.add_parser("push-existing")
    add_common(p)
    p.add_argument("--repo-dir", required=True, help="repository path on the egress host")
    p.add_argument("--remote", default="origin", help="remote name on the egress host")
    p.add_argument("--refspec", required=True, help="git push refspec")
    p.set_defaults(func=cmd_push_existing)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
