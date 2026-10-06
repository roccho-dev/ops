#!/usr/bin/env python3
"""Read already acquired inputs; no network, credential or effect access."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--admission", type=Path, required=True,
                        help="independently admitted scope/inventory/evidence; not producer self-approval")
    args = parser.parse_args()
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
