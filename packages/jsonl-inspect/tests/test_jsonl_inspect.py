from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
REPO = PACKAGE.parents[1]
DIST = REPO / "dist" / "jsonl-inspect" / "jsonl-inspect.pyz"
sys.path.insert(0, str(PACKAGE / "src"))

from jsonl_inspect.core import JsonlInspectError, inspect_jsonl, run_request  # noqa: E402


class JsonlInspectTests(unittest.TestCase):
    def test_inspect_is_deterministic_and_detects_duplicate_ids(self) -> None:
        text = '{"id":"b","x":1}\n{"x":2,"id":"b"}\n{"id":"a"}\n'
        first = inspect_jsonl(text)
        second = inspect_jsonl(text)
        self.assertEqual(first, second)
        self.assertEqual(first["rowCount"], 3)
        self.assertEqual(first["keys"], ["id", "x"])
        self.assertEqual(first["duplicateIds"], ["b"])

    def test_invalid_and_unknown_input_fail_closed(self) -> None:
        with self.assertRaises(JsonlInspectError):
            inspect_jsonl("{broken}\n")
        with self.assertRaises(JsonlInspectError):
            run_request({"action": "inspect-jsonl", "text": "{}\n", "extra": True})
        with self.assertRaises(JsonlInspectError):
            inspect_jsonl('{"value":NaN}\n')

    def test_mixed_duplicate_id_types_have_stable_order(self) -> None:
        result = inspect_jsonl('{"id":1}\n{"id":1}\n{"id":"1"}\n{"id":"1"}\n')
        self.assertEqual(result["duplicateIds"], ["1", 1])

    def test_committed_pyz_executes(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(DIST), "selftest"],
            check=True,
            text=True,
            capture_output=True,
        )
        result = json.loads(completed.stdout)
        self.assertTrue(result["ok"])
        self.assertTrue(result["deterministic"])
        self.assertTrue(result["malformedInputBlocked"])


if __name__ == "__main__":
    unittest.main()
