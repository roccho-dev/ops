#!/usr/bin/env python3
"""Compare acquired inputs or test this installed package; no provider access."""
import argparse
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core import InputError, canonical, compare, load_json

MAX_BYTES = 2 * 1024 * 1024


def read(path):
    with path.open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise InputError("input_size")
    return load_json(raw.decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selftest", action="store_true", help="test the same installed core and CLI")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--admission", type=Path,
                        help="independently admitted scope/inventory/evidence; not producer self-approval")
    args = parser.parse_args()
    if args.selftest:
        if args.input or args.admission:
            parser.error("selftest does not consume external inputs")
        import unittest
        suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() and result.testsRun > 0 and not result.skipped else 1
    if args.input is None or args.admission is None:
        parser.error("--input and --admission are required")
    try:
        result = compare(read(args.input), read(args.admission))
    except OSError:
        result = {"kind": "contractDiffResult.v1", "authority": False, "status": "UNKNOWN",
                  "findings": [{"kind": "UNKNOWN", "field": "input_unavailable"}]}
    except (InputError, UnicodeError):
        result = {"kind": "contractDiffResult.v1", "authority": False, "status": "INVALID",
                  "findings": [{"kind": "INVALID", "field": "input_encoding_or_schema"}]}
    sys.stdout.buffer.write(canonical(result) + b"\n")
    return {"CLOSED": 0, "OPEN": 2, "INVALID": 3, "UNKNOWN": 4}[result["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
