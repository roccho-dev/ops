VERSION = "0.6.0"

MANIFEST = {
    "entrypoints": ["manifest", "index", "audit", "resolve", "run", "complete"],
    "externalDependencies": [],
    "generatedIsAuthority": False,
    "id": "urn:roccho-dev:ops:dist:dist-runner",
    "kind": "ops.distRunner.manifest.v1",
    "runtime": "python>=3.11",
    "runtimeAdapters": ["browser-esm", "node-esm", "python-zipapp"],
    "stdlibOnly": True,
    "version": VERSION,
}
