from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from ..canonical import canonical_json, parse_json
from ..errors import DistRunnerError

MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def _run(command: list[str], timeout: int, label: str, *, stdin_text: str | None = None) -> Any:
    try:
        completed = subprocess.run(
            command,
            check=False,
            input=None if stdin_text is None else stdin_text.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise DistRunnerError("runtime-timeout", f"{label} exceeded {timeout} seconds") from exc
    if len(completed.stdout) > MAX_OUTPUT_BYTES or len(completed.stderr) > MAX_OUTPUT_BYTES:
        raise DistRunnerError("runtime-output-too-large", f"{label} exceeded output limit")
    stdout = completed.stdout.decode("utf-8", errors="strict")
    stderr = completed.stderr.decode("utf-8", errors="replace")
    if completed.returncode != 0:
        raise DistRunnerError("runtime-failed", f"{label} exited with {completed.returncode}", stderr=stderr[-4000:], stdout=stdout[-4000:])
    return parse_json(stdout.strip(), label)


def execute(data: bytes, request: dict[str, Any], timeout: int) -> tuple[dict[str, Any], Any, list[str]]:
    with tempfile.TemporaryDirectory(prefix="dist-runner-python-") as temp_dir:
        artifact = Path(temp_dir) / "artifact.pyz"
        artifact.write_bytes(data)
        manifest = _run([sys.executable, str(artifact), "manifest"], timeout, "Python manifest")
        result = _run(
            [sys.executable, str(artifact), "run"],
            timeout,
            "Python run",
            stdin_text=canonical_json(request),
        )
    if not isinstance(manifest, dict):
        raise DistRunnerError("invalid-artifact-manifest", "Python manifest must be an object")
    return manifest, result, []
