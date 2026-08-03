from __future__ import annotations

from typing import Any

from .canonical import canonical_json, sha256_text, validate_exact_commit, validate_repository
from .connector import decode_and_verify, expected_encoding
from .errors import DistRunnerError
from .executors import build_browser_plan, complete_browser_plan, execute_node_esm, execute_python_zipapp
from .index import parse_index, resolve_entry

RESOLVE_KEYS = {"indexText", "kind", "query", "ref", "repository"}
RUN_KEYS = {"connector", "input", "kind", "plan", "timeoutSeconds"}
COMPLETE_KEYS = {"browser", "kind", "plan"}
PLAN_KEYS = {
    "entry",
    "fetch",
    "generatedIsAuthority",
    "indexSha256",
    "kind",
    "planSha256",
    "query",
    "ref",
    "repository",
}


def _closed(value: dict[str, Any], expected: set[str], label: str) -> None:
    unknown = sorted(set(value) - expected)
    missing = sorted(expected - set(value))
    if unknown or missing:
        raise DistRunnerError("invalid-request-schema", f"{label} keys do not match schema", missing=missing, unknown=unknown)


def _digest_without(value: dict[str, Any], key: str) -> str:
    return sha256_text(canonical_json({name: item for name, item in value.items() if name != key}))


def _fetch(entry: dict[str, Any], repository: str, ref: str) -> dict[str, Any]:
    return {
        "arguments": {
            "encoding": expected_encoding(entry["executor"]),
            "path": entry["path"],
            "ref": ref,
            "repository_full_name": repository,
        },
        "tool": "GitHub.fetch_file",
    }


def _validate_plan(plan: Any) -> tuple[dict[str, Any], str, str]:
    if not isinstance(plan, dict) or set(plan) != PLAN_KEYS or plan.get("kind") != "ops.distResolve.plan.v1":
        raise DistRunnerError("invalid-plan", "run requires a closed resolve plan")
    if plan.get("generatedIsAuthority") is not False:
        raise DistRunnerError("invalid-plan", "resolve plan has invalid authority flag")
    if _digest_without(plan, "planSha256") != plan.get("planSha256"):
        raise DistRunnerError("resolve-plan-tampered", "resolve plan digest mismatch")
    repository = validate_repository(plan.get("repository"), "plan repository")
    ref = validate_exact_commit(plan.get("ref"), "plan ref")
    entry = plan.get("entry")
    if not isinstance(entry, dict):
        raise DistRunnerError("invalid-plan", "plan entry must be an object")
    parsed = parse_index(canonical_json(entry) + "\n")
    if len(parsed) != 1:
        raise DistRunnerError("invalid-plan", "plan must contain one index entry")
    if plan.get("fetch") != _fetch(entry, repository, ref):
        raise DistRunnerError("fetch-plan-tampered", "fetch arguments differ from the selected entry")
    index_sha = plan.get("indexSha256")
    if not isinstance(index_sha, str) or len(index_sha) != 64 or any(char not in "0123456789abcdef" for char in index_sha):
        raise DistRunnerError("invalid-plan", "plan indexSha256 is invalid")
    if not isinstance(plan.get("query"), str) or not plan["query"]:
        raise DistRunnerError("invalid-plan", "plan query is invalid")
    return entry, repository, ref


def resolve_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise DistRunnerError("invalid-resolve-request", "resolve request must be an object")
    _closed(request, RESOLVE_KEYS, "resolve request")
    if request["kind"] != "ops.distResolve.request.v1":
        raise DistRunnerError("invalid-request-kind", "unsupported resolve request kind")
    repository = validate_repository(request["repository"])
    ref = validate_exact_commit(request["ref"])
    index_text = request["indexText"]
    if not isinstance(index_text, str):
        raise DistRunnerError("invalid-index-text", "indexText must be text")
    entry = resolve_entry(parse_index(index_text), request["query"])
    plan = {
        "entry": entry,
        "fetch": _fetch(entry, repository, ref),
        "generatedIsAuthority": False,
        "indexSha256": sha256_text(index_text),
        "kind": "ops.distResolve.plan.v1",
        "query": request["query"],
        "ref": ref,
        "repository": repository,
    }
    plan["planSha256"] = _digest_without(plan, "planSha256")
    return plan


def _verify_manifest(entry: dict[str, Any], manifest: Any) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise DistRunnerError("invalid-artifact-manifest", "artifact manifest must be an object")
    if manifest.get("id") != entry["manifestId"]:
        raise DistRunnerError("artifact-manifest-id-mismatch", "artifact manifest ID differs from index")
    if manifest.get("generatedIsAuthority") is True:
        raise DistRunnerError("authority-overclaim", "artifact manifest claims authority")
    return manifest


def _receipt(
    *,
    entry: dict[str, Any],
    repository: str,
    ref: str,
    artifact: dict[str, Any],
    index_sha256: str,
    request_sha256: str,
    manifest: dict[str, Any],
    result: Any,
    host_commands: list[str],
) -> dict[str, Any]:
    return {
        "artifact": {**artifact, "path": entry["path"], "repository": repository, "ref": ref},
        "entryName": entry["name"],
        "generatedIsAuthority": False,
        "hostCommands": host_commands,
        "indexSha256": index_sha256,
        "kind": "ops.distRun.receipt.v1",
        "manifest": manifest,
        "ok": True,
        "requestSha256": request_sha256,
        "result": result,
        "resultSha256": sha256_text(canonical_json(result)),
        "runtime": entry["executor"],
    }


def run_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise DistRunnerError("invalid-run-request", "run request must be an object")
    _closed(request, RUN_KEYS, "run request")
    if request["kind"] != "ops.distRun.request.v1":
        raise DistRunnerError("invalid-request-kind", "unsupported run request kind")
    entry, repository, ref = _validate_plan(request["plan"])
    input_value = request["input"]
    if not isinstance(input_value, dict):
        raise DistRunnerError("invalid-feature-request", "input must be an object")
    timeout = request["timeoutSeconds"]
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 120:
        raise DistRunnerError("invalid-timeout", "timeoutSeconds must be from 1 to 120")
    data, artifact = decode_and_verify(entry, request["connector"])
    request_sha = sha256_text(canonical_json(input_value))
    executor = entry["executor"]
    if executor == "python-zipapp":
        manifest, result, host_commands = execute_python_zipapp(data, input_value, timeout)
        return _receipt(
            entry=entry,
            repository=repository,
            ref=ref,
            artifact=artifact,
            index_sha256=request["plan"]["indexSha256"],
            request_sha256=request_sha,
            manifest=_verify_manifest(entry, manifest),
            result=result,
            host_commands=host_commands,
        )
    if executor == "node-esm":
        manifest, result, host_commands = execute_node_esm(data, input_value, timeout)
        return _receipt(
            entry=entry,
            repository=repository,
            ref=ref,
            artifact=artifact,
            index_sha256=request["plan"]["indexSha256"],
            request_sha256=request_sha,
            manifest=_verify_manifest(entry, manifest),
            result=result,
            host_commands=host_commands,
        )
    if executor == "browser-esm":
        return build_browser_plan(
            data,
            entry,
            input_value,
            artifact,
            repository,
            ref,
            request["plan"]["indexSha256"],
        )
    raise DistRunnerError("unsupported-executor", f"unsupported executor: {executor}")


def complete_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise DistRunnerError("invalid-complete-request", "complete request must be an object")
    _closed(request, COMPLETE_KEYS, "complete request")
    if request["kind"] != "ops.distComplete.request.v1":
        raise DistRunnerError("invalid-request-kind", "unsupported complete request kind")
    plan = request["plan"]
    manifest, result = complete_browser_plan(plan, request["browser"])
    entry = {
        "executor": "browser-esm",
        "manifestId": plan["manifestId"],
        "name": plan["entryName"],
        "path": plan["artifact"]["path"],
    }
    artifact = {key: plan["artifact"][key] for key in ["bytes", "gitBlobSha1", "sha256"]}
    return _receipt(
        entry=entry,
        repository=plan["artifact"]["repository"],
        ref=plan["artifact"]["ref"],
        artifact=artifact,
        index_sha256=plan["indexSha256"],
        request_sha256=plan["requestSha256"],
        manifest=manifest,
        result=result,
        host_commands=["browser-evaluate"],
    )
