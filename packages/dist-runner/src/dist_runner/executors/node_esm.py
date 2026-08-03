from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from ..canonical import canonical_json, parse_json
from ..errors import DistRunnerError

MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def execute(data: bytes, request: dict[str, Any], timeout: int) -> tuple[dict[str, Any], Any, list[str]]:
    node = shutil.which("node")
    if node is None:
        raise DistRunnerError("missing-runtime-command", "node is required for node-esm")
    harness_text = r'''
import fs from "node:fs";
import { pathToFileURL } from "node:url";
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
const artifactPath = process.argv[2];
try {
  const namespace = await import(pathToFileURL(artifactPath).href + "?dist-runner=1");
  if (typeof namespace.run !== "function") throw new Error("missing run export");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const result = await namespace.run(request);
  process.stdout.write(JSON.stringify({ok:true,manifest:namespace.manifest,result}));
} catch (error) {
  process.stdout.write(JSON.stringify({ok:false,error:String(error?.stack ?? error)}));
  process.exitCode = 1;
}
'''.strip() + "\n"
    with tempfile.TemporaryDirectory(prefix="dist-runner-node-") as temp_dir:
        root = Path(temp_dir)
        artifact = root / "artifact.mjs"
        harness = root / "harness.mjs"
        artifact.write_bytes(data)
        harness.write_text(harness_text, encoding="utf-8")
        try:
            completed = subprocess.run(
                [node, str(harness), str(artifact)],
                check=False,
                input=canonical_json(request).encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise DistRunnerError("runtime-timeout", f"Node runtime exceeded {timeout} seconds") from exc
    if len(completed.stdout) > MAX_OUTPUT_BYTES or len(completed.stderr) > MAX_OUTPUT_BYTES:
        raise DistRunnerError("runtime-output-too-large", "Node runtime exceeded output limit")
    stdout = completed.stdout.decode("utf-8", errors="strict")
    stderr = completed.stderr.decode("utf-8", errors="replace")
    envelope = parse_json(stdout.strip(), "Node envelope")
    if completed.returncode != 0 or not isinstance(envelope, dict) or envelope.get("ok") is not True:
        error = envelope.get("error") if isinstance(envelope, dict) else None
        raise DistRunnerError("runtime-failed", f"Node runtime failed: {error}", stderr=stderr[-4000:])
    manifest = envelope.get("manifest")
    if not isinstance(manifest, dict):
        raise DistRunnerError("invalid-artifact-manifest", "Node manifest must be an object")
    return manifest, envelope.get("result"), [Path(node).name]
