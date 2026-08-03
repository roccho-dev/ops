from __future__ import annotations

import base64
from typing import Any

from ..canonical import canonical_json, sha256_text
from ..errors import DistRunnerError

PLAN_KEYS = {
    "artifact",
    "entryName",
    "expression",
    "expressionSha256",
    "generatedIsAuthority",
    "indexSha256",
    "kind",
    "manifestId",
    "planSha256",
    "requestSha256",
    "runtime",
}


def _plan_digest(plan: dict[str, Any]) -> str:
    return sha256_text(canonical_json({key: value for key, value in plan.items() if key != "planSha256"}))


def build_plan(
    data: bytes,
    entry: dict[str, Any],
    request: dict[str, Any],
    artifact: dict[str, Any],
    repository: str,
    ref: str,
    index_sha256: str,
) -> dict[str, Any]:
    code = base64.b64encode(data).decode("ascii")
    request_b64 = base64.b64encode(canonical_json(request).encode("utf-8")).decode("ascii")
    expression = f'''(async () => {{
  const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([decode("{code}")], {{type:"text/javascript"}}));
  try {{
    const module = await import(url);
    if (typeof module.run !== "function") throw new Error("missing run export");
    const request = JSON.parse(new TextDecoder().decode(decode("{request_b64}")));
    return {{ok:true,manifest:module.manifest,result:await module.run(request)}};
  }} catch (error) {{
    return {{ok:false,error:String(error?.stack ?? error)}};
  }} finally {{ URL.revokeObjectURL(url); }}
}})()'''
    plan = {
        "artifact": {**artifact, "path": entry["path"], "repository": repository, "ref": ref},
        "entryName": entry["name"],
        "expression": expression,
        "expressionSha256": sha256_text(expression),
        "generatedIsAuthority": False,
        "indexSha256": index_sha256,
        "kind": "ops.distBrowser.plan.v1",
        "manifestId": entry["manifestId"],
        "requestSha256": sha256_text(canonical_json(request)),
        "runtime": "browser-esm",
    }
    plan["planSha256"] = _plan_digest(plan)
    return plan


def complete(plan: Any, browser: Any) -> tuple[dict[str, Any], Any]:
    if not isinstance(plan, dict) or set(plan) != PLAN_KEYS or plan.get("kind") != "ops.distBrowser.plan.v1":
        raise DistRunnerError("invalid-browser-plan", "complete requires a closed browser plan")
    if plan.get("generatedIsAuthority") is not False or plan.get("runtime") != "browser-esm":
        raise DistRunnerError("invalid-browser-plan", "browser plan has invalid flags")
    if _plan_digest(plan) != plan.get("planSha256"):
        raise DistRunnerError("browser-plan-tampered", "browser plan digest mismatch")
    if sha256_text(plan.get("expression", "")) != plan.get("expressionSha256"):
        raise DistRunnerError("browser-plan-tampered", "browser expression digest mismatch")
    if not isinstance(browser, dict) or browser.get("ok") is not True:
        error = browser.get("error") if isinstance(browser, dict) else browser
        raise DistRunnerError("runtime-failed", f"browser execution failed: {error}")
    manifest = browser.get("manifest")
    if not isinstance(manifest, dict):
        raise DistRunnerError("invalid-artifact-manifest", "browser manifest must be an object")
    if manifest.get("id") != plan.get("manifestId"):
        raise DistRunnerError("artifact-manifest-id-mismatch", "browser manifest ID differs from plan")
    if manifest.get("generatedIsAuthority") is True:
        raise DistRunnerError("authority-overclaim", "browser artifact claims generated authority")
    return manifest, browser.get("result")
