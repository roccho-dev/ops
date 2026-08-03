from __future__ import annotations

from . import VERSION

MANIFEST = {
    "kind": "ops.pythonDist.manifest.v1",
    "id": "urn:roccho-dev:ops:dist:jsonl-inspect",
    "version": VERSION,
    "runtime": "python>=3.11",
    "stdlibOnly": True,
    "externalDependencies": [],
    "hostCommands": [],
    "entrypoints": ["manifest", "run", "selftest"],
    "generatedIsAuthority": False,
}
