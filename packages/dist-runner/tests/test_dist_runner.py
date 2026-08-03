from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "packages/dist-runner/src"
sys.path.insert(0, str(SRC))

from dist_runner.artifacts import identity  # noqa: E402
from dist_runner.canonical import canonical_json  # noqa: E402
from dist_runner.declarations import load_declarations  # noqa: E402
from dist_runner.errors import DistRunnerError  # noqa: E402
from dist_runner.index import audit, generate_index, parse_index, resolve_entry, write_index  # noqa: E402
from dist_runner.service import complete_request, resolve_request, run_request  # noqa: E402

REPOSITORY = "roccho-dev/ops"
REF = "a" * 40


def fixture_repo() -> tempfile.TemporaryDirectory[str]:
    temporary = tempfile.TemporaryDirectory(prefix="dist-runner-fixture-")
    target = Path(temporary.name)
    (target / "packages").mkdir()
    for declaration in ROOT.glob("packages/*/dist.json"):
        destination = target / declaration.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(declaration, destination, follow_symlinks=False)
    shutil.copytree(ROOT / "dist", target / "dist", symlinks=True)
    return temporary


def connector(entry: dict, data: bytes | None = None) -> dict:
    payload = data if data is not None else (ROOT / entry["path"]).read_bytes()
    encoding = "base64" if entry["executor"] == "python-zipapp" else "utf-8"
    return {
        "content": base64.b64encode(payload).decode("ascii") if encoding == "base64" else payload.decode("utf-8"),
        "encoding": encoding,
        "sha": identity(payload)["gitBlobSha1"],
    }


def resolve(query: str, index_text: str | None = None, ref: str = REF) -> dict:
    return resolve_request(
        {
            "indexText": index_text if index_text is not None else (ROOT / "dist/index.jsonl").read_text(encoding="utf-8"),
            "kind": "ops.distResolve.request.v1",
            "query": query,
            "ref": ref,
            "repository": REPOSITORY,
        }
    )


def run(plan: dict, input_value: dict, connector_value: dict | None = None) -> dict:
    return run_request(
        {
            "connector": connector_value if connector_value is not None else connector(plan["entry"]),
            "input": input_value,
            "kind": "ops.distRun.request.v1",
            "plan": plan,
            "timeoutSeconds": 60,
        }
    )


class DistRunnerTest(unittest.TestCase):
    def test_generated_index_is_current_and_deterministic(self) -> None:
        first, entries, declarations = generate_index(ROOT)
        second, entries2, _ = generate_index(ROOT)
        self.assertEqual(first, second)
        self.assertEqual(entries, entries2)
        self.assertEqual(first, (ROOT / "dist/index.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(
            [entry["name"] for entry in entries],
            ["html-to-excalidraw", "jsonl-inspect", "make-excalidraw-url", "mjs-bundler"],
        )
        self.assertEqual(len(declarations), 5)
        self.assertNotIn("dist-runner", [entry["name"] for entry in entries])
        self.assertTrue(audit(ROOT)["ok"])

    def test_index_write_is_byte_deterministic(self) -> None:
        before = (ROOT / "dist/index.jsonl").read_bytes()
        first = write_index(ROOT)
        middle = (ROOT / "dist/index.jsonl").read_bytes()
        second = write_index(ROOT)
        after = (ROOT / "dist/index.jsonl").read_bytes()
        self.assertEqual(before, middle)
        self.assertEqual(middle, after)
        self.assertEqual(first["sha256"], second["sha256"])

    def test_resolve_exact_alias_and_glob(self) -> None:
        self.assertEqual(resolve("jsonl-inspect")["entry"]["name"], "jsonl-inspect")
        self.assertEqual(resolve("jsonl")["entry"]["name"], "jsonl-inspect")
        self.assertEqual(resolve("mjs*")["entry"]["name"], "mjs-bundler")
        self.assertEqual(resolve("excalidraw-url")["entry"]["name"], "make-excalidraw-url")

    def test_ambiguous_and_missing_queries_fail_closed(self) -> None:
        with self.assertRaises(DistRunnerError) as captured:
            resolve("*")
        self.assertEqual(captured.exception.code, "ambiguous-query")
        with self.assertRaises(DistRunnerError) as captured:
            resolve("absent")
        self.assertEqual(captured.exception.code, "feature-not-found")

    def test_mutable_ref_is_rejected(self) -> None:
        with self.assertRaises(DistRunnerError) as captured:
            resolve("jsonl", ref="proposals")
        self.assertEqual(captured.exception.code, "mutable-ref-rejected")

    def test_python_real_artifact_executes(self) -> None:
        receipt = run(
            resolve("jsonl*"),
            {"action": "inspect-jsonl", "text": '{"id":"a"}\n{"id":"a"}\n{"id":"b"}\n'},
        )
        self.assertEqual(receipt["entryName"], "jsonl-inspect")
        self.assertEqual(receipt["result"]["rowCount"], 3)
        self.assertEqual(receipt["result"]["duplicateIds"], ["a"])

    def test_node_real_rollup_artifact_executes(self) -> None:
        receipt = run(
            resolve("mjs*"),
            {
                "operation": "bundle",
                "entry": "src/index.mjs",
                "modules": {
                    "src/index.mjs": 'import {twice} from "./math.mjs"; export const result=twice(20)+1;',
                    "src/math.mjs": "export const twice=(value)=>value*2;",
                },
            },
        )
        self.assertEqual(receipt["manifest"]["engine"], "rollup")
        generated = receipt["result"]
        with tempfile.TemporaryDirectory() as temp_dir:
            module = Path(temp_dir) / "result.mjs"
            module.write_text(generated, encoding="utf-8")
            output = subprocess.check_output(["node", "--input-type=module", "-e", f'import("{module.as_uri()}").then(m=>process.stdout.write(String(m.result)))'])
        self.assertEqual(output.decode(), "41")

    def test_node_url_artifact_executes(self) -> None:
        receipt = run(resolve("excalidraw-url"), {"publicSceneUrl": "https://example.invalid/a.excalidraw"})
        self.assertEqual(receipt["result"], "https://excalidraw.com/#url=https%3A%2F%2Fexample.invalid%2Fa.excalidraw")

    def test_browser_plan_and_complete(self) -> None:
        plan = run(resolve("excalidraw-html"), {"text": "browser-ok"})
        self.assertEqual(plan["kind"], "ops.distBrowser.plan.v1")
        receipt = complete_request(
            {
                "browser": {
                    "ok": True,
                    "manifest": {
                        "id": "urn:roccho-dev:ops:dist:excalidraw:html-to-excalidraw",
                        "generatedIsAuthority": False,
                    },
                    "result": {"count": 1, "text": "browser-ok"},
                },
                "kind": "ops.distComplete.request.v1",
                "plan": plan,
            }
        )
        self.assertEqual(receipt["entryName"], "html-to-excalidraw")
        self.assertEqual(receipt["result"]["count"], 1)

    def test_connector_tampering_is_rejected(self) -> None:
        plan = resolve("jsonl")
        envelope = connector(plan["entry"])
        envelope["content"] = ("A" if envelope["content"][0] != "A" else "B") + envelope["content"][1:]
        with self.assertRaises(DistRunnerError) as captured:
            run(plan, {"action": "inspect-jsonl", "text": '{"id":"a"}\n'}, envelope)
        self.assertIn(captured.exception.code, {"computed-blob-mismatch", "artifact-identity-mismatch"})

    def test_resolve_and_browser_plan_tampering_are_rejected(self) -> None:
        plan = resolve("jsonl")
        envelope = connector(plan["entry"])
        plan["entry"]["path"] = "dist/other/other.pyz"
        with self.assertRaises(DistRunnerError) as captured:
            run(plan, {"action": "inspect-jsonl", "text": '{"id":"a"}\n'}, envelope)
        self.assertEqual(captured.exception.code, "resolve-plan-tampered")
        browser = run(resolve("excalidraw-html"), {"text": "x"})
        browser["expression"] += " "
        with self.assertRaises(DistRunnerError) as captured:
            complete_request({"browser": {"ok": True, "manifest": {}, "result": None}, "kind": "ops.distComplete.request.v1", "plan": browser})
        self.assertEqual(captured.exception.code, "browser-plan-tampered")

    def test_stale_index_after_artifact_change_is_rejected(self) -> None:
        with fixture_repo() as directory:
            root = Path(directory)
            path = root / "dist/jsonl-inspect/jsonl-inspect.pyz"
            path.write_bytes(path.read_bytes() + b"stale")
            with self.assertRaises(DistRunnerError) as captured:
                audit(root)
            self.assertIn(captured.exception.code, {"stale-index", "manifest-command-failed"})

    def test_stale_index_after_declaration_change_is_rejected(self) -> None:
        with fixture_repo() as directory:
            root = Path(directory)
            path = root / "packages/mjs-bundler/dist.json"
            value = json.loads(path.read_text())
            value["artifacts"][0]["aliases"] = ["bundle"]
            path.write_text(canonical_json(value) + "\n")
            with self.assertRaises(DistRunnerError) as captured:
                audit(root)
            self.assertEqual(captured.exception.code, "stale-index")

    def test_hand_edited_and_noncanonical_index_are_rejected(self) -> None:
        with fixture_repo() as directory:
            root = Path(directory)
            path = root / "dist/index.jsonl"
            path.write_text(path.read_text().replace('"mjs"', '"mjs2"', 1))
            with self.assertRaises(DistRunnerError) as captured:
                audit(root)
            self.assertIn(captured.exception.code, {"stale-index", "invalid-index-row"})
        text = (ROOT / "dist/index.jsonl").read_text()
        for bad in [text.rstrip("\n"), text.replace("\n", "\r\n")]:
            with self.assertRaises(DistRunnerError) as captured:
                parse_index(bad)
            self.assertEqual(captured.exception.code, "non-canonical-index")

    def test_duplicate_alias_symlink_and_undeclared_dist_are_rejected(self) -> None:
        with fixture_repo() as directory:
            root = Path(directory)
            path = root / "packages/mjs-bundler/dist.json"
            value = json.loads(path.read_text())
            value["artifacts"][0]["aliases"] = ["jsonl"]
            path.write_text(canonical_json(value) + "\n")
            with self.assertRaises(DistRunnerError) as captured:
                load_declarations(root)
            self.assertEqual(captured.exception.code, "duplicate-search-token")
        with fixture_repo() as directory:
            root = Path(directory)
            path = root / "dist/jsonl-inspect/jsonl-inspect.pyz"
            target = root / "real.pyz"
            path.rename(target)
            path.symlink_to(target)
            with self.assertRaises(DistRunnerError) as captured:
                audit(root)
            self.assertEqual(captured.exception.code, "symlink-artifact-rejected")
        with fixture_repo() as directory:
            root = Path(directory)
            extra = root / "dist/extra/extra.mjs"
            extra.parent.mkdir(parents=True)
            extra.write_text("export const x=1;\n")
            with self.assertRaises(DistRunnerError) as captured:
                audit(root)
            self.assertEqual(captured.exception.code, "dist-inventory-mismatch")

    def test_large_node_request_uses_stdin(self) -> None:
        padding = "x" * 410_000
        receipt = run(
            resolve("mjs"),
            {
                "operation": "bundle",
                "entry": "index.mjs",
                "modules": {"index.mjs": f"/*{padding}*/ export const result=41;"},
            },
        )
        self.assertIn("result", receipt["result"])

    def test_runner_build_is_byte_deterministic(self) -> None:
        artifact = ROOT / "dist/dist-runner/dist-runner.pyz"
        before = artifact.read_bytes()
        subprocess.run([str(ROOT / "packages/dist-runner/build.sh")], cwd=ROOT, check=True)
        first = artifact.read_bytes()
        subprocess.run([str(ROOT / "packages/dist-runner/build.sh")], cwd=ROOT, check=True)
        second = artifact.read_bytes()
        self.assertEqual(before, first)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
