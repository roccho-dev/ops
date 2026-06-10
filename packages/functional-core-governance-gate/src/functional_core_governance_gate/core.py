"""Pure evaluator for the functional-core governance gate.

This module intentionally accepts already-loaded manifest data and file text.
It does not read files, environment variables, wall-clock time, randomness,
network, databases, browser storage, or subprocesses. Adapters do I/O.
"""

from __future__ import annotations

from typing import Any

SEMANTICS_PROFILE = "functional-core-governance-v1"

# Token-level heuristics for explicitly classified functional-core files.
# The gate is intentionally conservative: it finds high-signal hidden effects
# and dependency inversion without mandating a programming style.
HIDDEN_EFFECT_TOKENS: tuple[tuple[str, str], ...] = (
    ("open(", "filesystem"),
    ("Path(", "filesystem"),
    ("pathlib.", "filesystem"),
    ("os.environ", "environment"),
    ("getenv(", "environment"),
    ("subprocess", "subprocess"),
    ("requests.", "network"),
    ("urllib.", "network"),
    ("fetch(", "network-or-browser"),
    ("XMLHttpRequest", "network-or-browser"),
    ("localStorage", "browser-storage"),
    ("sessionStorage", "browser-storage"),
    ("indexedDB", "browser-storage"),
    ("datetime.now", "clock"),
    ("Date.now", "clock"),
    ("time.time", "clock"),
    ("random.", "randomness"),
    ("Math.random", "randomness"),
    ("sqlite3.connect", "database"),
    ("duckdb.connect", "database"),
    ("global ", "global-mutable-state"),
)

ADAPTER_DEPENDENCY_TOKENS: tuple[str, ...] = (
    "import adapter",
    "from adapter",
    ".adapter import",
    "import runtime",
    "from runtime",
    ".runtime import",
    "require('./adapter",
    "require(\"./adapter",
    "from './adapter",
    "from \"./adapter",
)

MUTATION_TOKENS: tuple[str, ...] = (
    ".append(",
    ".extend(",
    ".insert(",
    ".pop(",
    ".remove(",
    ".clear(",
    ".sort(",
    ".reverse(",
    ".update(",
    "setattr(",
    "delattr(",
)


def _core_entries(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    core = manifest.get("core", [])
    if not isinstance(core, list):
        return []
    return [entry for entry in core if isinstance(entry, dict)]


def _entry_path(entry: dict[str, Any]) -> str:
    path = entry.get("path")
    return path if isinstance(path, str) else ""


def _allow_list(manifest: dict[str, Any]) -> set[tuple[str, str]]:
    allowed: set[tuple[str, str]] = set()
    for row in manifest.get("allow", []) if isinstance(manifest.get("allow", []), list) else []:
        if not isinstance(row, dict):
            continue
        path = row.get("path")
        rule = row.get("rule")
        if isinstance(path, str) and isinstance(rule, str):
            allowed.add((path, rule))
    return allowed


def _line_for(text: str, token: str) -> int:
    idx = text.find(token)
    if idx < 0:
        return 0
    return text.count("\n", 0, idx) + 1


def _diagnostic(kind: str, path: str, rule: str, message: str, token: str | None = None, line: int | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "kind": kind,
        "path": path,
        "rule": rule,
        "message": message,
    }
    if token is not None:
        out["token"] = token
    if line is not None:
        out["line"] = line
    return out


def evaluate_manifest(manifest: dict[str, Any], file_texts: dict[str, str]) -> dict[str, Any]:
    """Evaluate a manifest and already-loaded text content.

    Returns a JSON-serializable result. No I/O is performed here.
    """

    diagnostics: list[dict[str, Any]] = []
    manifest_kind = manifest.get("kind")
    if manifest_kind != "functional-core-governance.manifest.v1":
        diagnostics.append(_diagnostic(
            "invalid-manifest-kind",
            "<manifest>",
            "manifest-kind",
            "manifest.kind must be functional-core-governance.manifest.v1",
            token=str(manifest_kind),
        ))

    entries = _core_entries(manifest)
    if not entries:
        diagnostics.append(_diagnostic(
            "missing-core-files",
            "<manifest>",
            "explicit-core-classification",
            "manifest.core must list at least one functional-core file",
        ))

    allowed = _allow_list(manifest)
    checked_paths: list[str] = []
    for entry in entries:
        path = _entry_path(entry)
        if not path:
            diagnostics.append(_diagnostic(
                "missing-core-path",
                "<manifest>",
                "explicit-core-classification",
                "each core entry must contain a path string",
            ))
            continue
        checked_paths.append(path)
        text = file_texts.get(path)
        if text is None:
            diagnostics.append(_diagnostic(
                "missing-core-file-text",
                path,
                "explicit-inputs",
                "adapter did not provide text for this declared core file",
            ))
            continue
        normalized_path = path.replace("\\", "/")
        if "/adapter/" in f"/{normalized_path}" or "/runtime/" in f"/{normalized_path}":
            diagnostics.append(_diagnostic(
                "core-path-under-adapter-runtime",
                path,
                "dependency-direction",
                "functional-core files must not be placed under adapter or runtime directories",
            ))
        for token, effect_kind in HIDDEN_EFFECT_TOKENS:
            if token in text and (path, "hidden-effect-in-core") not in allowed:
                diagnostics.append(_diagnostic(
                    "hidden-effect-in-core",
                    path,
                    effect_kind,
                    "functional-core code must receive capabilities explicitly or return effects as data",
                    token=token,
                    line=_line_for(text, token),
                ))
        for token in ADAPTER_DEPENDENCY_TOKENS:
            if token in text and (path, "adapter-dependency-in-core") not in allowed:
                diagnostics.append(_diagnostic(
                    "adapter-dependency-in-core",
                    path,
                    "dependency-direction",
                    "functional-core code must not depend on adapter/runtime modules",
                    token=token,
                    line=_line_for(text, token),
                ))
        for token in MUTATION_TOKENS:
            if token in text and (path, "caller-state-mutation") not in allowed:
                diagnostics.append(_diagnostic(
                    "caller-state-mutation",
                    path,
                    "no-caller-owned-state-mutation",
                    "functional-core reducers must avoid mutating caller-owned collections; return new values instead",
                    token=token,
                    line=_line_for(text, token),
                ))

    ok = not diagnostics
    return {
        "ok": ok,
        "classification": "functional-core-governance-pass" if ok else "functional-core-governance-fail",
        "semanticsProfile": SEMANTICS_PROFILE,
        "generatedIsAuthority": False,
        "coreFilesChecked": checked_paths,
        "diagnosticCount": len(diagnostics),
        "diagnostics": diagnostics,
        "styleMandatesExplicitlyNotRequired": [
            "monads",
            "currying",
            "FP libraries",
            "recursion-only style",
            "loop bans",
            "class bans",
            "language-specific syntax mandates",
        ],
    }
