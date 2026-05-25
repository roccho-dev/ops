#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


DECISION_FLAGS = {
    "semanticApproval": False,
    "completionApproval": False,
    "routeDecision": False,
}

THREAD_FUNCTIONS = {"impl-work", "impl-review", "merge-work", "merge-review"}


LOW_LEVEL_COMMANDS = [
    "chromium-cdp-chatgpt-doctor",
    "chromium-cdp-project-access-probe",
    "chromium-cdp-upload-project-source-file",
    "chromium-cdp-project-source-list",
    "chromium-cdp-project-source-delete",
    "chromium-cdp-create-project-thread",
    "chromium-cdp-send-chatgpt",
    "chromium-cdp-read-thread",
    "chromium-cdp-fetch-artifact-strict",
    "cdp-bridge",
]


TRANSPORT_COMMANDS = [
    "project-transport-doctor",
    "project-transport-env",
    "project-source-put",
    "project-source-list",
    "project-source-delete",
    "project-thread-create",
    "project-thread-send",
    "project-thread-readback",
    "project-artifact-fetch",
    "project-transport-claim",
    "project-transport-run",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_dir(path: str | Path | None) -> Path | None:
    if not path:
        return None
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def read_text(path: str | Path) -> str:
    return Path(path).read_text()


def write_json(path: str | Path, value: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def basename(path: str | Path) -> str:
    return Path(path).name


def common_result(command: str, args: argparse.Namespace) -> dict[str, Any]:
    return {
        "kind": "ops.projectTransportResult.v1",
        "command": command,
        "ok": False,
        "status": "started",
        "createdAt": now_iso(),
        "dryRun": bool(getattr(args, "dry_run", False)),
        **DECISION_FLAGS,
    }


def project_url_shape_error(project_url: str, purpose: str) -> dict[str, Any] | None:
    parsed = urlparse(project_url)
    query = parse_qs(parsed.query)
    if purpose == "thread-create" and query.get("tab") == ["sources"]:
        return {
            "ok": False,
            "status": "project-url-wrong-shape",
            "reason": "thread creation requires the base Project URL, not the Project Sources tab URL",
            "projectUrl": project_url,
            "expectedUrlShape": "https://chatgpt.com/g/<project-id>/<project-name>/project",
            "rejectedUrlShape": "project?tab=sources",
            "allowedFor": ["project-source-put"],
            "forbiddenFor": ["project-thread-create", "project-transport-run thread-create phase"],
        }
    return None


def parse_json_maybe(text: str) -> Any:
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
    return None


def run_command(cmd: list[str], timeout: int | None = None) -> dict[str, Any]:
    proc = subprocess.run(
        cmd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    return {
        "argv": cmd,
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "json": parse_json_maybe(proc.stdout),
    }


def maybe_write_out(args: argparse.Namespace, result: dict[str, Any]) -> int:
    result.setdefault("finishedAt", now_iso())
    if getattr(args, "out_path", None):
        write_json(args.out_path, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("ok") else int(result.get("exitCode", 1))


def add_common_io(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--out-path", "--outPath", dest="out_path")
    parser.add_argument("--out-dir", "--outDir", dest="out_dir")
    parser.add_argument("--dry-run", "--dryRun", dest="dry_run", action="store_true")


def add_cdp_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--addr", default=os.environ.get("HQ_CHROME_ADDR", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("HQ_CHROME_PORT", "9222")))
    parser.add_argument("--timeout-ms", "--timeoutMs", dest="timeout_ms", type=int, default=180000)


def command_found(name: str) -> dict[str, Any]:
    path = shutil.which(name)
    return {"name": name, "found": bool(path), "path": path}


def handle_env(args: argparse.Namespace) -> int:
    result = common_result("project-transport-env", args)
    ports = args.ports or [9222, 9223, 9224]
    probes = []
    for port in ports:
        row = {"addr": args.addr, "port": port, "tcpConnect": False}
        try:
            with socket.create_connection((args.addr, int(port)), timeout=args.connect_timeout_sec):
                row["tcpConnect"] = True
        except OSError as e:
            row["error"] = str(e)
        probes.append(row)
    reachable = [p for p in probes if p.get("tcpConnect")]
    project_probes = []
    if args.project_url and reachable and not args.dry_run:
        for row in reachable:
            cmd = [
                "chromium-cdp-project-access-probe",
                "--projectUrl", args.project_url,
                "--addr", args.addr,
                "--port", str(row["port"]),
                "--timeoutMs", str(args.timeout_ms),
                "--json",
            ]
            low = run_command(cmd, timeout=max(60, args.timeout_ms // 1000 + 30))
            probe = low.get("json") if isinstance(low.get("json"), dict) else None
            project_probes.append({
                "addr": args.addr,
                "port": row["port"],
                "command": low,
                "projectAccess": probe,
                "ok": low["returncode"] == 0 and bool(probe and probe.get("ok")),
            })
    elif args.project_url and reachable and args.dry_run:
        project_probes = [{
            "addr": args.addr,
            "port": row["port"],
            "dryRun": True,
            "plannedCommand": [
                "chromium-cdp-project-access-probe",
                "--projectUrl", args.project_url,
                "--addr", args.addr,
                "--port", str(row["port"]),
            ],
        } for row in reachable]
    recommended = next((p for p in project_probes if p.get("ok")), None)
    if args.project_url:
        ok = bool(recommended) if not args.dry_run else bool(reachable)
        status = "project-route-recommended" if recommended else (
            "project-route-probe-dry-run" if args.dry_run and reachable else (
                "no-cdp-port-reachable" if not reachable else "project-route-not-verified"
            )
        )
    else:
        ok = bool(reachable)
        status = "cdp-port-reachable" if reachable else "no-cdp-port-reachable"
    result.update({
        "ok": ok,
        "status": status,
        "addr": args.addr,
        "projectUrl": args.project_url,
        "probes": probes,
        "projectAccessProbes": project_probes,
        "selectedPort": next((p["port"] for p in reachable), None),
        "recommendedRoute": {
            "addr": recommended["addr"],
            "port": recommended["port"],
            "status": recommended.get("projectAccess", {}).get("status"),
        } if recommended else None,
    })
    return maybe_write_out(args, result)


def handle_doctor(args: argparse.Namespace) -> int:
    result = common_result("project-transport-doctor", args)
    low_level_commands = [command_found(c) for c in LOW_LEVEL_COMMANDS]
    transport_commands = [command_found(c) for c in TRANSPORT_COMMANDS]
    missing = [c["name"] for c in low_level_commands if not c["found"]]
    missing_transport = [c["name"] for c in transport_commands if not c["found"]]
    result.update({
        "commands": low_level_commands,
        "transportCommands": transport_commands,
        "missingCommands": missing,
        "missingTransportCommands": missing_transport,
        "transportCommandsInPath": not missing_transport,
        "offlineOnly": args.offline,
    })
    if args.offline:
        if args.project_url:
            result.update({
                "ok": False,
                "status": "offline-project-route-unverified",
                "projectUrl": args.project_url,
                "reason": "offline runtime check cannot verify target Project access",
            })
        else:
            result.update({"ok": not missing, "status": "offline-runtime-ok" if not missing else "missing-command"})
        return maybe_write_out(args, result)

    if args.project_url and args.dry_run:
        result.update({
            "ok": True,
            "status": "project-probe-dry-run-ready",
            "projectUrl": args.project_url,
            "plannedCommand": [
                "chromium-cdp-project-access-probe",
                "--projectUrl", args.project_url,
                "--addr", args.addr,
                "--port", str(args.port),
            ],
        })
        return maybe_write_out(args, result)

    cmd = ["chromium-cdp-chatgpt-doctor", "--addr", args.addr, "--json"]
    low = run_command(cmd, timeout=max(30, args.timeout_ms // 1000))
    result["doctorCommand"] = low
    sessions = []
    if isinstance(low.get("json"), dict):
        sessions = low["json"].get("sessions") or []
    requested = next((s for s in sessions if int(s.get("port") or -1) == int(args.port)), None)
    if requested:
        result["requestedSession"] = requested
    requested_login_url = bool(requested and "/auth/login" in str(requested.get("url") or ""))
    requested_ok = bool(requested and requested.get("status") == "logged-in" and not requested_login_url)
    result.update({
        "ok": not missing and low["returncode"] == 0 and requested_ok,
        "status": "cdp-runtime-ok" if low["returncode"] == 0 and not missing and requested_ok else "cdp-runtime-blocked",
    })
    if requested_login_url:
        result["status"] = "cdp-runtime-login-required"
    if args.project_url:
        probe_cmd = [
            "chromium-cdp-project-access-probe",
            "--projectUrl", args.project_url,
            "--addr", args.addr,
            "--port", str(args.port),
            "--timeoutMs", str(args.timeout_ms),
            "--json",
        ]
        probe = run_command(probe_cmd, timeout=max(60, args.timeout_ms // 1000 + 30))
        project_access = probe.get("json") if isinstance(probe.get("json"), dict) else None
        result["projectUrl"] = args.project_url
        result["projectAccessCommand"] = probe
        result["projectAccess"] = project_access
        project_ok = probe["returncode"] == 0 and bool(project_access and project_access.get("ok"))
        result["ok"] = not missing and project_ok
        result["status"] = "project-route-ok" if project_ok else (
            project_access.get("status") if isinstance(project_access, dict) and project_access.get("status") else "project-route-not-verified"
        )
        result["recommendedRoute"] = {
            "addr": args.addr,
            "port": args.port,
            "status": result["status"],
            "projectUrl": args.project_url,
        } if project_ok else None
    return maybe_write_out(args, result)


def source_put_result(args: argparse.Namespace, result: dict[str, Any]) -> dict[str, Any]:
    file_path = Path(args.file)
    result["projectUrl"] = args.project_url
    result["file"] = {
        "path": str(file_path),
        "name": file_path.name,
        "exists": file_path.is_file(),
        "sha256": sha256_file(file_path) if file_path.is_file() else None,
    }
    result["projectSourceOnly"] = True
    result["threadAttachmentFallbackAllowed"] = False
    if not file_path.is_file():
        result.update({"ok": False, "status": "missing-file"})
        return result
    out_dir = ensure_dir(args.out_dir) or Path.cwd()
    upload_log = out_dir / f"project-source-put-{file_path.name}.json"
    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommand": [
                "chromium-cdp-upload-project-source-file",
                "--projectUrl", args.project_url,
                "--file", str(file_path),
                "--outPath", str(upload_log),
            ],
        })
        return result
    cmd = [
        "chromium-cdp-upload-project-source-file",
        "--projectUrl", args.project_url,
        "--file", str(file_path),
        "--outPath", str(upload_log),
        "--addr", args.addr,
        "--port", str(args.port),
        "--timeoutMs", str(args.timeout_ms),
    ]
    low = run_command(cmd, timeout=max(60, args.timeout_ms // 1000 + 30))
    result["uploadCommand"] = low
    result["uploadLog"] = str(upload_log)
    parsed = None
    if upload_log.is_file():
        parsed = json.loads(upload_log.read_text())
    elif low.get("json") is not None:
        parsed = low["json"]
    visible = bool(parsed and parsed.get("visible") and parsed["visible"].get("ok"))
    observed_text = json.dumps(parsed or {}, sort_keys=True) + "\n" + low.get("stdout", "") + "\n" + low.get("stderr", "")
    if visible:
        status = "source-upload-visible"
    elif "/auth/login" in observed_text or "login required" in observed_text.lower():
        status = "project-access-profile-missing"
    elif parsed and parsed.get("target") and parsed["target"].get("url") and "/project" not in str(parsed["target"].get("url")):
        status = "source-page-not-loaded"
    else:
        status = "source-upload-not-visible"
    result.update({
        "ok": low["returncode"] == 0 and bool(parsed and parsed.get("ok")) and visible,
        "status": status,
        "transportSent": low["returncode"] == 0,
        "transportVisible": visible,
        "readbackVerified": visible,
        "uploadResult": parsed,
    })
    return result


def handle_source_put(args: argparse.Namespace) -> int:
    result = source_put_result(args, common_result("project-source-put", args))
    return maybe_write_out(args, result)


def source_list_result(args: argparse.Namespace, result: dict[str, Any]) -> dict[str, Any]:
    result["projectUrl"] = args.project_url
    result["projectSourceOnly"] = True
    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommand": [
                "chromium-cdp-project-source-list",
                "--projectUrl", args.project_url,
            ],
        })
        return result
    out_dir = ensure_dir(args.out_dir) or Path.cwd()
    list_log = out_dir / "project-source-list.json"
    cmd = [
        "chromium-cdp-project-source-list",
        "--projectUrl", args.project_url,
        "--outPath", str(list_log),
        "--addr", args.addr,
        "--port", str(args.port),
        "--timeoutMs", str(args.timeout_ms),
    ]
    low = run_command(cmd, timeout=max(60, args.timeout_ms // 1000 + 30))
    parsed = json.loads(list_log.read_text()) if list_log.is_file() else low.get("json")
    result.update({
        "ok": low["returncode"] == 0 and bool(parsed and parsed.get("ok")),
        "status": "source-list-read" if parsed and parsed.get("ok") else "source-list-not-read",
        "transportRead": low["returncode"] == 0,
        "readbackVerified": bool(parsed and parsed.get("ok")),
        "listLog": str(list_log),
        "listCommand": low,
        "sourceList": parsed,
        "sourceCount": parsed.get("count") if isinstance(parsed, dict) else None,
    })
    return result


def handle_source_list(args: argparse.Namespace) -> int:
    result = source_list_result(args, common_result("project-source-list", args))
    return maybe_write_out(args, result)


def source_delete_result(args: argparse.Namespace, result: dict[str, Any]) -> dict[str, Any]:
    result["projectUrl"] = args.project_url
    result["title"] = args.title
    result["reason"] = args.reason
    result["projectSourceOnly"] = True
    result["deleteSafety"] = {
        "exactTitleRequired": True,
        "allowRemoveFlagRequired": True,
        "reasonRequired": True,
        "fuzzyMatchAllowed": False,
    }
    if not args.reason:
        result.update({"ok": False, "status": "missing-reason"})
        return result
    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommand": [
                "chromium-cdp-project-source-delete",
                "--projectUrl", args.project_url,
                "--title", args.title,
                "--reason", args.reason,
                "--dryRun",
            ],
        })
        if args.allow_remove:
            result["plannedCommand"].append("--allow-remove")
        return result
    if not args.allow_remove:
        result.update({"ok": False, "status": "remove-not-authorized", "requiredFlag": "--allow-remove"})
        return result
    out_dir = ensure_dir(args.out_dir) or Path.cwd()
    delete_log = out_dir / f"project-source-delete-{args.title}.json"
    cmd = [
        "chromium-cdp-project-source-delete",
        "--projectUrl", args.project_url,
        "--title", args.title,
        "--reason", args.reason,
        "--allow-remove",
        "--outPath", str(delete_log),
        "--addr", args.addr,
        "--port", str(args.port),
        "--timeoutMs", str(args.timeout_ms),
    ]
    low = run_command(cmd, timeout=max(60, args.timeout_ms // 1000 + 30))
    parsed = json.loads(delete_log.read_text()) if delete_log.is_file() else low.get("json")
    result.update({
        "ok": low["returncode"] == 0 and bool(parsed and parsed.get("ok")),
        "status": parsed.get("status") if isinstance(parsed, dict) and parsed.get("status") else "source-delete-not-verified",
        "transportSent": low["returncode"] == 0,
        "readbackVerified": bool(parsed and parsed.get("ok") and parsed.get("after")),
        "deleteLog": str(delete_log),
        "deleteCommand": low,
        "deleteResult": parsed,
        "beforeTitleCount": parsed.get("beforeTitleCount") if isinstance(parsed, dict) else None,
        "afterTitleCount": parsed.get("afterTitleCount") if isinstance(parsed, dict) else None,
    })
    return result


def handle_source_delete(args: argparse.Namespace) -> int:
    result = source_delete_result(args, common_result("project-source-delete", args))
    return maybe_write_out(args, result)


def read_prompt(args: argparse.Namespace) -> str:
    if getattr(args, "text_file", None):
        return read_text(args.text_file)
    return str(getattr(args, "text", "") or "")


def handle_thread_create(args: argparse.Namespace) -> int:
    result = common_result("project-thread-create", args)
    if shape_error := project_url_shape_error(args.project_url, "thread-create"):
        result.update(shape_error)
        return maybe_write_out(args, result)
    text = read_prompt(args)
    result["projectUrl"] = args.project_url
    result["promptLength"] = len(text)
    result["inlinePolicy"] = "short-control-pointer-only"
    if not text:
        result.update({"ok": False, "status": "empty-prompt"})
        return maybe_write_out(args, result)
    out_dir = ensure_dir(args.out_dir) or Path.cwd()
    create_log = out_dir / "project-thread-create.json"
    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommand": ["chromium-cdp-create-project-thread", "--projectUrl", args.project_url, "--text-file" if args.text_file else "--text", args.text_file or "<inline-text>", "--outPath", str(create_log), "--json"],
        })
        return maybe_write_out(args, result)
    cmd = [
        "chromium-cdp-create-project-thread",
        "--projectUrl", args.project_url,
        "--outPath", str(create_log),
        "--json",
        "--addr", args.addr,
        "--port", str(args.port),
        "--timeoutMs", str(args.timeout_ms),
    ]
    if args.text_file:
        cmd.extend(["--text-file", args.text_file])
    else:
        cmd.extend(["--text", text])
    low = run_command(cmd, timeout=max(60, args.timeout_ms // 1000 + 30))
    parsed = json.loads(create_log.read_text()) if create_log.is_file() else low.get("json")
    result.update({
        "ok": low["returncode"] == 0 and bool(parsed and parsed.get("ok") and parsed.get("threadUrl")),
        "status": "thread-created" if parsed and parsed.get("threadUrl") else "thread-create-not-verified",
        "transportSent": low["returncode"] == 0,
        "readbackVerified": bool(parsed and parsed.get("threadUrl")),
        "createLog": str(create_log),
        "createCommand": low,
        "threadUrl": parsed.get("threadUrl") if isinstance(parsed, dict) else None,
        "conversationId": parsed.get("conversationId") if isinstance(parsed, dict) else None,
        "createResult": parsed,
    })
    return maybe_write_out(args, result)


def handle_thread_send(args: argparse.Namespace) -> int:
    result = common_result("project-thread-send", args)
    text = read_prompt(args)
    result["threadUrl"] = args.url
    result["projectUrl"] = args.project_url
    result["promptLength"] = len(text)
    result["inlinePolicy"] = "short-control-pointer-only"
    result["maxInlineLength"] = args.max_inline_length
    if not text:
        result.update({"ok": False, "status": "empty-prompt"})
        return maybe_write_out(args, result)
    if len(text) > args.max_inline_length:
        result.update({"ok": False, "status": "inline-too-long", "reason": "upload payload to Project Source and send a pointer only"})
        return maybe_write_out(args, result)
    out_dir = ensure_dir(args.out_dir) or Path.cwd()
    send_dir = out_dir / "send"
    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommand": ["chromium-cdp-send-chatgpt", "--url", args.url, "--text-file" if args.text_file else "--text", args.text_file or "<inline-text>", "--outDir", str(send_dir)],
        })
        return maybe_write_out(args, result)
    cmd = [
        "chromium-cdp-send-chatgpt",
        "--url", args.url,
        "--outDir", str(send_dir),
        "--addr", args.addr,
        "--port", str(args.port),
    ]
    if args.project_url:
        cmd.extend(["--projectUrl", args.project_url])
    if args.text_file:
        cmd.extend(["--text-file", args.text_file])
    else:
        cmd.extend(["--text", text])
    low = run_command(cmd, timeout=max(60, args.timeout_ms // 1000 + 30))
    result.update({
        "ok": low["returncode"] == 0,
        "status": "thread-message-sent" if low["returncode"] == 0 else "thread-message-not-sent",
        "transportSent": low["returncode"] == 0,
        "sendOutDir": str(send_dir),
        "sendCommand": low,
    })
    return maybe_write_out(args, result)


def handle_thread_readback(args: argparse.Namespace) -> int:
    result = common_result("project-thread-readback", args)
    result["threadUrl"] = args.url
    result["markers"] = args.markers
    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommand": ["chromium-cdp-read-thread", "--url", args.url, "--markers", ",".join(args.markers), "--tail", str(args.tail)],
        })
        return maybe_write_out(args, result)
    cmd = [
        "chromium-cdp-read-thread",
        "--url", args.url,
        "--addr", args.addr,
        "--port", str(args.port),
        "--waitMs", str(args.wait_ms),
        "--tail", str(args.tail),
    ]
    if args.id:
        cmd.extend(["--id", args.id])
    else:
        cmd.append("--openIfNeeded")
    if args.markers:
        cmd.extend(["--markers", ",".join(args.markers)])
    low = run_command(cmd, timeout=max(60, args.wait_ms // 1000 + 60))
    parsed = low.get("json")
    hits = parsed.get("hits", []) if isinstance(parsed, dict) else []
    found = {h.get("marker") for h in hits if isinstance(h, dict)}
    missing = [m for m in args.markers if m not in found]
    result.update({
        "ok": low["returncode"] == 0 and not missing,
        "status": "readback-verified" if low["returncode"] == 0 and not missing else "readback-missing-marker",
        "transportRead": low["returncode"] == 0,
        "readbackVerified": low["returncode"] == 0 and not missing,
        "missingMarkers": missing,
        "readCommand": low,
    })
    return maybe_write_out(args, result)


def handle_artifact_fetch(args: argparse.Namespace) -> int:
    result = common_result("project-artifact-fetch", args)
    out_dir = ensure_dir(args.out_dir) or Path.cwd()
    result["artifactName"] = args.name
    result["outDir"] = str(out_dir)
    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommand": ["chromium-cdp-fetch-artifact-strict", "--name", args.name, "--outDir", str(out_dir), "--url", args.url or "<irPath>"],
        })
        return maybe_write_out(args, result)
    cmd = ["chromium-cdp-fetch-artifact-strict", "--name", args.name, "--outDir", str(out_dir), "--json", "--addr", args.addr, "--port", str(args.port)]
    if args.url:
        cmd.extend(["--url", args.url])
    if args.ir_path:
        cmd.extend(["--irPath", args.ir_path])
    low = run_command(cmd, timeout=max(60, args.timeout_ms // 1000 + 60))
    parsed = low.get("json")
    manifest = None
    if isinstance(parsed, dict) and parsed.get("outPath"):
        manifest = {
            "kind": "ops.projectTransportArtifactsManifest.v1",
            "artifacts": [{
                "name": parsed.get("name"),
                "actualName": parsed.get("actualName"),
                "path": parsed.get("outPath"),
                "size": parsed.get("size"),
                "sha256": parsed.get("sha256"),
            }],
            **DECISION_FLAGS,
        }
        write_json(out_dir / "ARTIFACTS_MANIFEST.json", manifest)
    result.update({
        "ok": low["returncode"] == 0 and bool(parsed and parsed.get("sha256")),
        "status": "artifact-fetched" if parsed and parsed.get("sha256") else "artifact-fetch-not-verified",
        "transportRead": low["returncode"] == 0,
        "readbackVerified": bool(parsed and parsed.get("sha256")),
        "fetchCommand": low,
        "artifactResult": parsed,
        "artifactsManifest": str(out_dir / "ARTIFACTS_MANIFEST.json") if manifest else None,
    })
    return maybe_write_out(args, result)


def handle_claim(args: argparse.Namespace) -> int:
    result = common_result("project-transport-claim", args)
    input_doc = json.loads(read_text(args.input))
    claim = {
        "kind": "ops.projectTransportClaim.v1",
        "eventId": args.event_id,
        "createdAt": now_iso(),
        "transportResult": input_doc,
        **DECISION_FLAGS,
    }
    if args.dry_run:
        result.update({"ok": True, "status": "dry-run-ready", "claim": claim})
        return maybe_write_out(args, result)
    claim_path = Path(args.claim_path)
    claim_path.parent.mkdir(parents=True, exist_ok=True)
    with claim_path.open("a") as f:
        f.write(json.dumps(claim, sort_keys=True) + "\n")
    result.update({"ok": True, "status": "claim-appended", "claimPath": str(claim_path), "claim": claim})
    return maybe_write_out(args, result)


def load_json_file(path: str | Path) -> Any:
    return json.loads(Path(path).read_text())


def handle_handoff_preflight(args: argparse.Namespace) -> int:
    result = common_result("project-handoff-preflight", args)
    result["projectUrl"] = args.project_url
    result["projectSourcePolicy"] = args.project_source_policy
    result["requiredReadbackIntervalSeconds"] = args.readback_interval_seconds
    missing: list[str] = []
    invalid: list[dict[str, Any]] = []

    if shape_error := project_url_shape_error(args.project_url, "thread-create"):
        invalid.append({
            "field": "projectUrl",
            "status": shape_error["status"],
            "reason": shape_error["reason"],
        })

    roster_value: Any = None
    if not args.thread_roster:
        missing.append("threadRoster")
    else:
        try:
            roster_value = load_json_file(args.thread_roster)
        except (OSError, json.JSONDecodeError) as exc:
            invalid.append({"field": "threadRoster", "status": "invalid-json", "reason": str(exc)})

    threads = []
    if isinstance(roster_value, dict):
        threads = roster_value.get("threads", [])
    elif isinstance(roster_value, list):
        threads = roster_value
    elif roster_value is not None:
        invalid.append({"field": "threadRoster", "status": "invalid-shape", "reason": "expected array or object with threads[]"})

    seen_functions = set()
    for row in threads if isinstance(threads, list) else []:
        if not isinstance(row, dict):
            invalid.append({"field": "threadRoster", "status": "invalid-entry", "reason": "thread entry must be object"})
            continue
        fn = str(row.get("threadFunction", ""))
        if fn not in THREAD_FUNCTIONS:
            invalid.append({"field": "threadFunction", "status": "invalid-thread-function", "value": fn})
        else:
            seen_functions.add(fn)
        if not row.get("actorId"):
            invalid.append({"field": "actorId", "status": "missing-field", "threadFunction": fn})
        if not row.get("parentActor"):
            invalid.append({"field": "parentActor", "status": "missing-field", "threadFunction": fn})

    missing_functions = sorted(THREAD_FUNCTIONS - seen_functions)
    if missing_functions:
        invalid.append({"field": "threadFunction", "status": "missing-thread-functions", "missing": missing_functions})

    source_files = []
    for file_text in args.source_file:
        path = Path(file_text)
        exists = path.is_file()
        source_files.append({
            "path": str(path),
            "name": path.name,
            "exists": exists,
            "sha256": sha256_file(path) if exists else None,
        })
        if not exists:
            invalid.append({"field": "sourceFile", "status": "missing-file", "path": str(path)})
    if not source_files:
        missing.append("sourceFile")

    bootstrap_files = []
    for file_text in args.bootstrap_artifact:
        path = Path(file_text)
        exists = path.is_file()
        bootstrap_files.append({
            "path": str(path),
            "name": path.name,
            "exists": exists,
            "sha256": sha256_file(path) if exists else None,
        })
        if not exists:
            invalid.append({"field": "bootstrapArtifact", "status": "missing-file", "path": str(path)})
    if not bootstrap_files:
        missing.append("bootstrapArtifact")

    expected_artifacts = [item for item in args.expected_artifact if item]
    if not expected_artifacts:
        missing.append("expectedArtifact")

    if args.project_source_policy != "project-source-only":
        invalid.append({
            "field": "projectSourcePolicy",
            "status": "unsupported-policy",
            "reason": "thread attachments are not a Project Source fallback",
        })

    result.update({
        "threadRoster": {
            "path": args.thread_roster,
            "threadFunctions": sorted(seen_functions),
            "requiredThreadFunctions": sorted(THREAD_FUNCTIONS),
        },
        "sourceFiles": source_files,
        "bootstrapArtifacts": bootstrap_files,
        "expectedArtifacts": expected_artifacts,
        "missing": missing,
        "invalid": invalid,
        "threadAttachmentFallbackAllowed": False,
        "inlinePolicy": "short-control-pointer-only",
    })

    if missing or invalid:
        result.update({
            "ok": False,
            "status": "project-handoff-preflight-failed",
            "blockerClass": "project-binding-missing" if missing else "project-handoff-preflight-failed",
        })
        return maybe_write_out(args, result)

    if args.dry_run:
        result.update({
            "ok": True,
            "status": "dry-run-ready",
            "plannedCommands": [
                ["project-transport-doctor", "--project-url", args.project_url],
                *[["project-source-put", "--project-url", args.project_url, "--file", row["path"]] for row in source_files],
                ["project-thread-create", "--project-url", args.project_url, "--text-file", "<short pointer/control prompt>"],
                ["project-thread-readback", "--url", "<created-thread-url>", "--markers", ",".join(expected_artifacts)],
                ["project-artifact-fetch", "--name", expected_artifacts[0], "--url", "<created-thread-url>"],
            ],
        })
        return maybe_write_out(args, result)

    doctor = run_command([
        "project-transport-doctor",
        "--project-url", args.project_url,
        "--addr", args.addr,
        "--port", str(args.port),
        "--timeout-ms", str(args.timeout_ms),
    ], timeout=max(60, args.timeout_ms // 1000 + 30))
    doctor_ok = doctor["returncode"] == 0 and bool(isinstance(doctor.get("json"), dict) and doctor["json"].get("ok"))
    result["doctor"] = doctor
    result.update({
        "ok": doctor_ok,
        "status": "project-handoff-preflight-ready" if doctor_ok else "project-route-not-verified",
    })
    return maybe_write_out(args, result)


def write_run_report(out_dir: Path, result: dict[str, Any]) -> Path:
    path = out_dir / "TRANSPORT_RUN_REPORT.md"
    lines = [
        "# Project Transport Run Report",
        "",
        f"- ok: `{str(result.get('ok')).lower()}`",
        f"- status: `{result.get('status')}`",
        f"- semanticApproval: `{str(result.get('semanticApproval')).lower()}`",
        f"- completionApproval: `{str(result.get('completionApproval')).lower()}`",
        f"- routeDecision: `{str(result.get('routeDecision')).lower()}`",
        "",
        "## Steps",
    ]
    for step in result.get("steps", []):
        lines.append(f"- `{step.get('command')}`: `{step.get('status')}` ok=`{str(step.get('ok')).lower()}`")
    path.write_text("\n".join(lines) + "\n")
    return path


def write_run_evidence_bundle(out_dir: Path, result: dict[str, Any]) -> dict[str, str]:
    status_path = out_dir / "TRANSPORT_STATUS.jsonl"
    status_record = {
        "kind": "ops.projectTransportRunStatus.v1",
        "createdAt": now_iso(),
        "ok": result.get("ok"),
        "status": result.get("status"),
        "semanticApproval": result.get("semanticApproval"),
        "completionApproval": result.get("completionApproval"),
        "routeDecision": result.get("routeDecision"),
        "stepCount": len(result.get("steps", [])),
    }
    status_path.write_text(json.dumps(status_record, sort_keys=True) + "\n")

    knowledge_path = out_dir / "TRANSPORT_KNOWLEDGE.jsonl"
    knowledge_record = {
        "kind": "ops.projectTransportRunKnowledge.v1",
        "createdAt": now_iso(),
        "summary": "project-transport-run evidence is contained in one run directory",
        "redactionPolicy": "Do not record secrets, cookies, browser profile contents, or prompt bodies beyond stable file names and hashes.",
        "manualCollationRequired": False,
    }
    knowledge_path.write_text(json.dumps(knowledge_record, sort_keys=True) + "\n")

    artifact_manifest_path = out_dir / "ARTIFACTS_MANIFEST.json"
    if not artifact_manifest_path.exists():
        write_json(artifact_manifest_path, {
            "kind": "ops.projectTransportArtifactsManifest.v1",
            "artifacts": [],
            "note": "No downloadable artifacts fetched by project-transport-run.",
            **DECISION_FLAGS,
        })

    snapshot_path = out_dir / "transport-result.snapshot.json"
    write_json(snapshot_path, result)

    index_path = out_dir / "TRANSPORT_RUN_INDEX.md"
    index_path.write_text("\n".join([
        "# Project Transport Run Index",
        "",
        f"- status: `{result.get('status')}`",
        f"- ok: `{str(result.get('ok')).lower()}`",
        "- manualCollationRequired: `false`",
        "",
        "## Files",
        "- `TRANSPORT_RUN_REPORT.md`",
        "- `transport-result.json` (mutable wrapper output; excluded from stable checksums)",
        "- `transport-result.snapshot.json`",
        "- `TRANSPORT_STATUS.jsonl`",
        "- `TRANSPORT_KNOWLEDGE.jsonl`",
        "- `ARTIFACTS_MANIFEST.json`",
        "- `TRANSPORT_RUN_MANIFEST.json`",
        "- `SHA256SUMS.tsv`",
        "",
        "## Boundary",
        "",
        "This directory is transport evidence only. It is not semantic approval, completion approval, or route decision.",
    ]) + "\n")

    manifest_path = out_dir / "TRANSPORT_RUN_MANIFEST.json"
    stable_excludes = {"TRANSPORT_RUN_MANIFEST.json", "SHA256SUMS.tsv", "transport-result.json"}
    files = []
    for file_path in sorted(p for p in out_dir.rglob("*") if p.is_file() and p.name not in stable_excludes):
        files.append({
            "path": str(file_path.relative_to(out_dir)),
            "bytes": file_path.stat().st_size,
            "sha256": sha256_file(file_path),
        })
    write_json(manifest_path, {
        "kind": "ops.projectTransportRunManifest.v1",
        "createdAt": now_iso(),
        "runStatus": result.get("status"),
        "manualCollationRequired": False,
        "redactionPolicy": knowledge_record["redactionPolicy"],
        "stableExcludes": sorted(stable_excludes),
        "files": files,
        **DECISION_FLAGS,
    })

    sha_path = out_dir / "SHA256SUMS.tsv"
    rows = []
    checksum_excludes = {"SHA256SUMS.tsv", "transport-result.json"}
    for file_path in sorted(p for p in out_dir.rglob("*") if p.is_file() and p.name not in checksum_excludes):
        rows.append(f"{sha256_file(file_path)}\t{file_path.relative_to(out_dir)}")
    sha_path.write_text("\n".join(rows) + ("\n" if rows else ""))

    return {
        "statusJsonl": str(status_path),
        "knowledgeJsonl": str(knowledge_path),
        "artifactsManifest": str(artifact_manifest_path),
        "transportResultSnapshot": str(snapshot_path),
        "sha256Sums": str(sha_path),
        "manifest": str(manifest_path),
        "index": str(index_path),
    }


def handle_run(args: argparse.Namespace) -> int:
    result = common_result("project-transport-run", args)
    out_dir = ensure_dir(args.out_dir) or Path.cwd()
    result["projectUrl"] = args.project_url
    result["outDir"] = str(out_dir)
    steps: list[dict[str, Any]] = []
    if args.prompt_file or args.text:
        if shape_error := project_url_shape_error(args.project_url, "thread-create"):
            result.update(shape_error)
            result["status"] = "project-url-wrong-shape"
            result["steps"] = steps
            write_run_report(out_dir, result)
            write_json(out_dir / "transport-result.json", result)
            result["evidenceBundle"] = write_run_evidence_bundle(out_dir, result)
            write_json(out_dir / "transport-result.json", result)
            return maybe_write_out(args, result)

    for source in args.source_file:
        ns = argparse.Namespace(**vars(args))
        ns.file = source
        ns.out_path = None
        step = source_put_result(ns, common_result("project-source-put", ns))
        steps.append(step)
        if not step.get("ok"):
            result.update({"ok": False, "status": "source-put-failed", "steps": steps})
            write_run_report(out_dir, result)
            write_json(out_dir / "transport-result.json", result)
            result["evidenceBundle"] = write_run_evidence_bundle(out_dir, result)
            write_json(out_dir / "transport-result.json", result)
            return maybe_write_out(args, result)

    if args.prompt_file or args.text:
        ns = argparse.Namespace(**vars(args))
        ns.text_file = args.prompt_file
        ns.out_path = None
        create_result = common_result("project-thread-create", ns)
        if args.dry_run:
            create_result.update({"ok": True, "status": "dry-run-ready", "plannedCommand": ["chromium-cdp-create-project-thread", "--projectUrl", args.project_url]})
        else:
            create_args = [
                "project-thread-create",
                "--project-url", args.project_url,
                "--out-dir", str(out_dir),
                "--addr", args.addr,
                "--port", str(args.port),
                "--timeout-ms", str(args.timeout_ms),
            ]
            if args.prompt_file:
                create_args.extend(["--text-file", args.prompt_file])
            else:
                create_args.extend(["--text", args.text])
            low = run_command([sys.executable, __file__] + create_args, timeout=max(60, args.timeout_ms // 1000 + 60))
            create_result.update(low.get("json") or {"ok": False, "status": "thread-create-wrapper-failed", "commandOutput": low})
        steps.append(create_result)
        if not create_result.get("ok"):
            result.update({"ok": False, "status": "thread-create-failed", "steps": steps})
            write_run_report(out_dir, result)
            write_json(out_dir / "transport-result.json", result)
            result["evidenceBundle"] = write_run_evidence_bundle(out_dir, result)
            write_json(out_dir / "transport-result.json", result)
            return maybe_write_out(args, result)
        if create_result.get("threadUrl"):
            result["threadUrl"] = create_result["threadUrl"]

        if args.readback_marker:
            readback_result = common_result("project-thread-readback", ns)
            readback_result["markers"] = args.readback_marker
            if args.dry_run:
                readback_result.update({
                    "ok": True,
                    "status": "dry-run-ready",
                    "plannedCommand": [
                        "project-thread-readback",
                        "--url", create_result.get("threadUrl", "<created-thread-url>"),
                        "--markers", ",".join(args.readback_marker),
                        "--wait-ms", str(args.readback_wait_ms),
                    ],
                })
            elif create_result.get("threadUrl"):
                readback_args = [
                    "project-thread-readback",
                    "--url", create_result["threadUrl"],
                    "--markers", ",".join(args.readback_marker),
                    "--wait-ms", str(args.readback_wait_ms),
                    "--addr", args.addr,
                    "--port", str(args.port),
                    "--out-dir", str(out_dir),
                ]
                low = run_command([sys.executable, __file__] + readback_args, timeout=max(60, args.readback_wait_ms // 1000 + 60))
                readback_result.update(low.get("json") or {"ok": False, "status": "thread-readback-wrapper-failed", "commandOutput": low})
            else:
                readback_result.update({"ok": False, "status": "thread-url-missing"})
            steps.append(readback_result)
            if not readback_result.get("ok"):
                result.update({"ok": False, "status": "thread-readback-failed", "steps": steps})
                write_run_report(out_dir, result)
                write_json(out_dir / "transport-result.json", result)
                result["evidenceBundle"] = write_run_evidence_bundle(out_dir, result)
                write_json(out_dir / "transport-result.json", result)
                return maybe_write_out(args, result)

    result.update({"ok": True, "status": "transport-run-ready" if args.dry_run else "transport-run-complete", "steps": steps})
    report = write_run_report(out_dir, result)
    result["runReport"] = str(report)
    write_json(out_dir / "transport-result.json", result)
    result["evidenceBundle"] = write_run_evidence_bundle(out_dir, result)
    write_json(out_dir / "transport-result.json", result)
    return maybe_write_out(args, result)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="project-transport")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("env")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--ports", type=lambda s: [int(x) for x in s.split(",") if x], default=None)
    p.add_argument("--connect-timeout-sec", type=float, default=0.25)
    p.add_argument("--project-url", "--projectUrl", dest="project_url")
    p.set_defaults(func=handle_env)

    p = sub.add_parser("doctor")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--project-url", "--projectUrl", dest="project_url")
    p.add_argument("--offline", action="store_true")
    p.set_defaults(func=handle_doctor)

    p = sub.add_parser("source-put")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--project-url", "--projectUrl", dest="project_url", required=True)
    p.add_argument("--file", required=True)
    p.set_defaults(func=handle_source_put)

    p = sub.add_parser("source-list")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--project-url", "--projectUrl", dest="project_url", required=True)
    p.set_defaults(func=handle_source_list)

    p = sub.add_parser("source-delete")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--project-url", "--projectUrl", dest="project_url", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--reason", required=True)
    p.add_argument("--allow-remove", "--allowRemove", dest="allow_remove", action="store_true")
    p.set_defaults(func=handle_source_delete)

    p = sub.add_parser("thread-create")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--project-url", "--projectUrl", dest="project_url", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--text")
    g.add_argument("--text-file", "--textFile", dest="text_file")
    p.set_defaults(func=handle_thread_create)

    p = sub.add_parser("thread-send")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--url", required=True)
    p.add_argument("--project-url", "--projectUrl", dest="project_url")
    p.add_argument("--max-inline-length", type=int, default=2000)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--text")
    g.add_argument("--text-file", "--textFile", dest="text_file")
    p.set_defaults(func=handle_thread_send)

    p = sub.add_parser("thread-readback")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--url", required=True)
    p.add_argument("--id")
    p.add_argument("--markers", type=lambda s: [x for x in s.split(",") if x], default=[])
    p.add_argument("--wait-ms", "--waitMs", dest="wait_ms", type=int, default=30000)
    p.add_argument("--tail", type=int, default=5)
    p.set_defaults(func=handle_thread_readback)

    p = sub.add_parser("artifact-fetch")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--name", required=True)
    p.add_argument("--url")
    p.add_argument("--ir-path", "--irPath", dest="ir_path")
    p.set_defaults(func=handle_artifact_fetch)

    p = sub.add_parser("claim")
    add_common_io(p)
    p.add_argument("--input", required=True)
    p.add_argument("--claim-path", "--claimPath", dest="claim_path", required=True)
    p.add_argument("--event-id", "--eventId", dest="event_id", default="project-transport-claim")
    p.set_defaults(func=handle_claim)

    p = sub.add_parser("handoff-preflight")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--project-url", "--projectUrl", dest="project_url", required=True)
    p.add_argument("--thread-roster", "--threadRoster", dest="thread_roster", required=True)
    p.add_argument("--source-file", "--sourceFile", dest="source_file", action="append", default=[])
    p.add_argument("--bootstrap-artifact", "--bootstrapArtifact", dest="bootstrap_artifact", action="append", default=[])
    p.add_argument("--expected-artifact", "--expectedArtifact", dest="expected_artifact", action="append", default=[])
    p.add_argument("--project-source-policy", "--projectSourcePolicy", dest="project_source_policy", default="project-source-only")
    p.add_argument("--readback-interval-seconds", "--readbackIntervalSeconds", dest="readback_interval_seconds", type=int, default=300)
    p.set_defaults(func=handle_handoff_preflight)

    p = sub.add_parser("run")
    add_common_io(p)
    add_cdp_common(p)
    p.add_argument("--project-url", "--projectUrl", dest="project_url", required=True)
    p.add_argument("--source-file", "--sourceFile", dest="source_file", action="append", default=[])
    p.add_argument("--prompt-file", "--promptFile", dest="prompt_file")
    p.add_argument("--text")
    p.add_argument("--readback-marker", "--readbackMarker", dest="readback_marker", action="append", default=[])
    p.add_argument("--readback-wait-ms", "--readbackWaitMs", dest="readback_wait_ms", type=int, default=300000)
    p.set_defaults(func=handle_run)

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except subprocess.TimeoutExpired as e:
        result = common_result(args.command, args)
        result.update({"ok": False, "status": "transport-timeout", "error": str(e)})
        return maybe_write_out(args, result)
    except Exception as e:
        result = common_result(args.command, args)
        result.update({"ok": False, "status": "transport-error", "error": str(e)})
        return maybe_write_out(args, result)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
