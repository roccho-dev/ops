from __future__ import annotations

from contextlib import contextmanager
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
from typing import Any, Iterator
from urllib.parse import urlsplit


REQUIRED_TOP_LEVEL = {
    "schema",
    "packageRoot",
    "sourceRef",
    "sourcePaths",
    "runtime",
    "entrypoints",
    "outputs",
    "host",
    "limits",
    "checks",
    "examples",
}
FORBIDDEN_KEYS = {
    "coordinates",
    "credentials",
    "css",
    "design",
    "fixtureData",
    "providerSecrets",
    "secrets",
}
ID_REPLACEMENTS = (
    ("vacancy-reproposal-chain-3", "predictive-maintenance-insurance-3"),
    ("seeker", "plant"),
    ("operator", "service"),
    ("landlord", "insurer"),
    ("a3-", "pm3-"),
)
TEXT_REPLACEMENTS = (
    ("失注した需要を、空室契約へ戻す", "設備停止を減らし、保険料も下げる"),
    ("賃貸向け", "製造業向け"),
    ("差分付き代替提案", "停止リスク付き保全提案"),
    ("代替提案", "保全提案"),
    ("再提案", "予兆保全"),
    ("成功報酬", "削減報酬"),
    ("募集条件", "保険条件"),
    ("許容条件", "リスク条件"),
    ("希望条件", "稼働条件"),
    ("失注理由", "停止原因"),
    ("申込意思", "保全依頼"),
    ("申込", "保全実施"),
    ("成約", "停止回避"),
    ("契約", "保険契約"),
    ("空室", "設備停止"),
    ("失注", "故障"),
    ("需要", "故障兆候"),
    ("借り手", "工場"),
    ("貸し手", "保険会社"),
    ("貸し主", "保険会社"),
    ("貸主", "保険会社"),
    ("運営", "保全会社"),
    ("物件", "設備"),
    ("募集", "保全"),
    ("入居", "稼働継続"),
    ("賃料", "停止損失"),
    ("広さ", "設備規模"),
    ("場所", "設備場所"),
)


def invariant(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(f"examples-entrypoint: {message}")


def walk_keys(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key)
            yield from walk_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_keys(child)


def resolve_inside(root: Path, relative: str) -> Path:
    invariant(isinstance(relative, str) and relative, "path must be a non-empty string")
    invariant(not Path(relative).is_absolute(), f"absolute path is forbidden: {relative}")
    target = (root / relative).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError as error:
        raise AssertionError(f"examples-entrypoint: path escapes package root: {relative}") from error
    return target


def copy_scope(package_root: Path, workspace: Path, source_paths: list[str]) -> None:
    for relative in source_paths:
        source = resolve_inside(package_root, relative)
        invariant(source.exists(), f"source path is missing: {relative}")
        target = workspace / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)


def replace_value(value: Any) -> Any:
    if isinstance(value, str):
        replaced = value
        for old, new in ID_REPLACEMENTS:
            replaced = replaced.replace(old, new)
        for old, new in TEXT_REPLACEMENTS:
            replaced = replaced.replace(old, new)
        return replaced
    if isinstance(value, list):
        return [replace_value(child) for child in value]
    if isinstance(value, dict):
        return {key: replace_value(child) for key, child in value.items()}
    return value


def create_custom_three_actor_jsonl(source: Path, target: Path) -> dict[str, Any]:
    original_lines = [line for line in source.read_text(encoding="utf-8").splitlines() if line.strip()]
    original = [json.loads(line) for line in original_lines]
    changed = [replace_value(record) for record in original]
    changed_lines = [json.dumps(record, ensure_ascii=False, separators=(",", ":")) for record in changed]
    difference_count = sum(left != right for left, right in zip(original_lines, changed_lines, strict=True))
    actors = [record for record in changed if record.get("type") == "actor"]
    meta = next(record for record in changed if record.get("type") == "meta")
    invariant(difference_count >= 25, f"custom business changed only {difference_count} lines")
    invariant([actor["id"] for actor in actors] == ["plant", "service", "insurer"], "custom actor ids are invalid")
    invariant(meta["id"] == "predictive-maintenance-insurance-3", "custom meta id is invalid")
    invariant(meta["title"] == "設備停止を減らし、保険料も下げる", "custom title is invalid")
    target.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(changed_lines) + "\n"
    target.write_text(text, encoding="utf-8")
    return {
        "differenceLines": difference_count,
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "customSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }


def expand_command(spec: dict[str, Any], replacements: dict[str, str]) -> list[str]:
    command = spec.get("command")
    invariant(isinstance(command, list) and command, "entrypoint command must be a non-empty array")
    expanded: list[str] = []
    for item in command:
        invariant(isinstance(item, str), "entrypoint command items must be strings")
        value = item
        for key, replacement in replacements.items():
            value = value.replace("{" + key + "}", replacement)
        invariant(not re.search(r"\{[^{}]+\}", value), f"unresolved command placeholder: {value}")
        expanded.append(value)
    return expanded


def run_json(command: list[str], cwd: Path) -> dict[str, Any]:
    result = subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=True)
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    invariant(bool(lines), f"command returned no JSON: {' '.join(command)}")
    value = json.loads(lines[-1])
    invariant(isinstance(value, dict), f"command result is not an object: {' '.join(command)}")
    return value


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return


@contextmanager
def serve(directory: Path) -> Iterator[str]:
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}/"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def validate_manifest(entry: Path, manifest: dict[str, Any]) -> Path:
    invariant(REQUIRED_TOP_LEVEL <= set(manifest), "manifest minimum contract is incomplete")
    invariant(manifest["schema"] == "mobile-agent.business-model-examples-entrypoint/1", "manifest schema is invalid")
    invariant(manifest["packageRoot"] == "..", "packageRoot must be the parent of examples")
    invariant(re.fullmatch(r"[0-9a-f]{40}", manifest["sourceRef"]) is not None, "sourceRef must be an exact commit")
    forbidden = FORBIDDEN_KEYS.intersection(walk_keys(manifest))
    invariant(not forbidden, f"manifest contains forbidden fields: {sorted(forbidden)}")
    package_root = (entry / manifest["packageRoot"]).resolve()
    invariant(package_root.is_dir(), "packageRoot does not resolve")
    source_paths = manifest["sourcePaths"]
    invariant(isinstance(source_paths, list) and source_paths, "sourcePaths must be non-empty")
    invariant(len(source_paths) == len(set(source_paths)), "sourcePaths contains duplicates")
    for relative in source_paths:
        invariant("*" not in relative and relative not in (".", ".."), f"sourcePath is not exact: {relative}")
        invariant(resolve_inside(package_root, relative).exists(), f"sourcePath is missing: {relative}")
    examples = manifest["examples"]
    invariant(isinstance(examples, list) and len(examples) == 3, "examples must contain exactly three fixtures")
    invariant(sorted(item["actorCount"] for item in examples) == [2, 3, 4], "example actor counts are invalid")
    for item in examples:
        invariant(resolve_inside(package_root, item["path"]).is_file(), f"example is missing: {item['path']}")
    invariant(manifest["entrypoints"]["check"]["via"] == "generateUrl", "check must reuse generateUrl")
    invariant(manifest["outputs"]["url"]["returnDirectly"] is True, "URL must be returned directly")
    invariant(manifest["limits"]["urlChars"] == 8192, "URL limit must remain 8192")
    invariant(manifest["host"]["stableBase"].endswith("/business-model/"), "stable host route is invalid")
    return package_root


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: examples_entrypoint_closure.py EXAMPLES_DIRECTORY")
    entry = Path(sys.argv[1]).resolve()
    manifest = json.loads((entry / "manifest.json").read_text(encoding="utf-8"))
    package_root = validate_manifest(entry, manifest)

    with TemporaryDirectory(prefix="business-model-examples-") as temporary:
        workspace = Path(temporary) / "package"
        workspace.mkdir(parents=True)
        copy_scope(package_root, workspace, manifest["sourcePaths"])

        three_actor = next(item for item in manifest["examples"] if item["actorCount"] == 3)
        custom_path = workspace / "work" / "predictive-maintenance-insurance.jsonl"
        change_proof = create_custom_three_actor_jsonl(resolve_inside(workspace, three_actor["path"]), custom_path)
        invariant(change_proof["sourceSha256"] != change_proof["customSha256"], "custom input did not change")

        build_result = run_json(expand_command(manifest["entrypoints"]["buildPublic"], {}), workspace)
        invariant(build_result.get("status") == "PASS", "public build failed")
        invariant(build_result.get("pattern") == "business-model/1", "public build pattern is invalid")

        receipt_path = workspace / "work" / "url-receipt.json"
        generated = run_json(
            expand_command(
                manifest["entrypoints"]["generateUrl"],
                {
                    "input": str(custom_path),
                    "baseUrl": manifest["host"]["stableBase"],
                    "receipt": str(receipt_path),
                },
            ),
            workspace,
        )
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        invariant(generated == receipt, "stdout and receipt differ")
        expected = manifest["entrypoints"]["check"]["assert"]
        invariant(receipt.get("status") == expected["status"], "schema/profile check failed")
        invariant(receipt.get("pattern") == expected["pattern"], "generated pattern is invalid")
        invariant(receipt.get("actorCount") == 3, "generated actor count is invalid")
        invariant(receipt.get("urlChars", 0) <= manifest["limits"]["urlChars"], "generated URL exceeds limit")
        invariant(receipt.get("url", "").startswith(manifest["host"]["stableBase"] + "#presentation="), "public URL is invalid")

        fragment = urlsplit(receipt["url"]).fragment
        browser_input = workspace / "work" / "browser-urls.json"
        browser_receipt = workspace / "work" / "browser-proof.json"
        with serve(workspace / "dist" / "public") as local_base:
            browser_input.write_text(
                json.dumps(
                    {
                        "schema": "mobile-agent.business-model-public-url-test/1",
                        "status": "PASS",
                        "results": [{**receipt, "url": f"{local_base}#{fragment}"}],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            browser_result = run_json(
                expand_command(
                    manifest["entrypoints"]["browserCheck"],
                    {"urls": str(browser_input), "receipt": str(browser_receipt)},
                ),
                workspace,
            )
        browser = json.loads(browser_receipt.read_text(encoding="utf-8"))
        invariant(browser_result.get("status") == "PASS", "browser runner failed")
        invariant(browser.get("pass") is True, json.dumps(browser, ensure_ascii=False))

        proof = {
            "schema": "mobile-agent.business-model-examples-entrypoint-proof/1",
            "status": "PASS",
            "pass": True,
            "entry": entry.relative_to(package_root).as_posix(),
            "sourceRef": manifest["sourceRef"],
            "sourcePaths": manifest["sourcePaths"],
            "customInput": change_proof,
            "generated": {
                "pattern": receipt["pattern"],
                "actorCount": receipt["actorCount"],
                "urlChars": receipt["urlChars"],
                "limitChars": receipt["limitChars"],
                "url": receipt["url"],
            },
            "browser": browser,
        }
        output = package_root / "dist" / "public" / "examples-entrypoint-proof.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(receipt["url"])


if __name__ == "__main__":
    main()
