#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import time
from typing import Any


def write_json(path: str, value: dict[str, Any]) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, out)


def read_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def run(label: str, seconds: float, out: str) -> None:
    start_wall_ns = time.time_ns()
    start_mono_ns = time.monotonic_ns()
    time.sleep(seconds)
    end_mono_ns = time.monotonic_ns()
    end_wall_ns = time.time_ns()
    write_json(
        out,
        {
            "schema": "ops.taskProbe/1",
            "label": label,
            "pid": os.getpid(),
            "startWallNs": start_wall_ns,
            "endWallNs": end_wall_ns,
            "startMonoNs": start_mono_ns,
            "endMonoNs": end_mono_ns,
            "durationNs": end_mono_ns - start_mono_ns,
            "value": label[-1].upper(),
        },
    )


def join(mode: str, a_path: str, b_path: str, out: str) -> None:
    a = read_json(a_path)
    b = read_json(b_path)
    start = time.monotonic_ns()
    semantic = "".join(sorted([str(a["value"]), str(b["value"])]))
    digest = hashlib.sha256(semantic.encode("utf-8")).hexdigest()
    write_json(
        out,
        {
            "schema": "ops.taskJoin/1",
            "mode": mode,
            "startMonoNs": start,
            "inputs": [a_path, b_path],
            "semantic": semantic,
            "sha256": digest,
        },
    )


def verify(par_a: str, par_b: str, par_join: str, ser_a: str, ser_b: str, ser_join: str, out: str) -> None:
    pa, pb, pj = read_json(par_a), read_json(par_b), read_json(par_join)
    sa, sb, sj = read_json(ser_a), read_json(ser_b), read_json(ser_join)

    overlap_ns = min(pa["endMonoNs"], pb["endMonoNs"]) - max(pa["startMonoNs"], pb["startMonoNs"])
    parallel_wall_ns = max(pa["endMonoNs"], pb["endMonoNs"]) - min(pa["startMonoNs"], pb["startMonoNs"])
    serial_overlap_ns = min(sa["endMonoNs"], sb["endMonoNs"]) - max(sa["startMonoNs"], sb["startMonoNs"])
    serial_wall_ns = max(sa["endMonoNs"], sb["endMonoNs"]) - min(sa["startMonoNs"], sb["startMonoNs"])

    checks = {
        "parallelOverlapAtLeast1s": overlap_ns >= 1_000_000_000,
        "parallelWallUnder3_5s": parallel_wall_ns < 3_500_000_000,
        "serialNoPositiveOverlap": serial_overlap_ns <= 0,
        "serialWallAtLeast3_5s": serial_wall_ns >= 3_500_000_000,
        "joinAfterParallelDependencies": pj["startMonoNs"] >= max(pa["endMonoNs"], pb["endMonoNs"]),
        "joinAfterSerialDependencies": sj["startMonoNs"] >= max(sa["endMonoNs"], sb["endMonoNs"]),
        "serialParallelSemanticEqual": pj["sha256"] == sj["sha256"],
        "distinctParallelProcesses": pa["pid"] != pb["pid"],
    }
    if not all(checks.values()):
        raise SystemExit("parallel proof failed: " + json.dumps(checks, sort_keys=True))

    write_json(
        out,
        {
            "schema": "ops.goTaskParallelProof/1",
            "status": "PASS",
            "checks": checks,
            "metrics": {
                "parallelOverlapNs": overlap_ns,
                "parallelWallNs": parallel_wall_ns,
                "serialOverlapNs": serial_overlap_ns,
                "serialWallNs": serial_wall_ns,
                "wallSpeedup": serial_wall_ns / parallel_wall_ns,
            },
            "semanticSha256": pj["sha256"],
        },
    )


def fail(out: str) -> None:
    write_json(out, {"schema": "ops.taskFailure/1", "status": "EXPECTED_FAILURE", "exitCode": 7})
    raise SystemExit(7)


def forbidden(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("MUST_NOT_EXIST\n", encoding="utf-8")


def main() -> int:
    args = sys.argv[1:]
    if not args:
        raise SystemExit("usage: probe.py run|join|verify|fail|forbidden ...")
    op = args.pop(0)
    if op == "run" and len(args) == 3:
        run(args[0], float(args[1]), args[2])
    elif op == "join" and len(args) == 4:
        join(args[0], args[1], args[2], args[3])
    elif op == "verify" and len(args) == 7:
        verify(*args)
    elif op == "fail" and len(args) == 1:
        fail(args[0])
    elif op == "forbidden" and len(args) == 1:
        forbidden(args[0])
    else:
        raise SystemExit(f"invalid {op} arguments: {args!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
