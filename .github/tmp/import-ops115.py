from __future__ import annotations

from pathlib import Path
import json
import subprocess

SOURCE_SHA = "8c1787d94c4a6e451bbe2e2ccd6cf32797feb575"
SOURCE_BASE = "59457a5667488da34d4ba977fa32c3a101a4a38e"
KEYWORDS = (
    "ops-115",
    "decision closure",
    "decision-closure",
    "decision packet",
    "decision-packet",
    "fact / condition / claim",
    "fact condition claim",
    "frozen ducklake",
    "semantic mismatch",
    "decision room",
)
EXCLUDED_PREFIXES = (
    "contracts/git_write/",
    "packages/ops-git-write-closure/",
    "runbooks/github-connector-write.md",
    "evidence/ops-114",
    ".github/workflows/",
    ".github/tmp/",
)


def run(*args: str, text: bool = True) -> str | bytes:
    p = subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=text)
    return p.stdout


def show(path: str) -> bytes:
    return run("git", "show", f"{SOURCE_SHA}:{path}", text=False)


def exists_at_source(path: str) -> bool:
    p = subprocess.run(["git", "cat-file", "-e", f"{SOURCE_SHA}:{path}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return p.returncode == 0


def changed_paths() -> list[str]:
    out = run("git", "diff", "--name-only", SOURCE_BASE, SOURCE_SHA)
    return [x for x in str(out).splitlines() if x]


def source_tree(prefix: str) -> list[str]:
    out = run("git", "ls-tree", "-r", "--name-only", SOURCE_SHA, "--", prefix)
    return [x for x in str(out).splitlines() if x]


def relevant(path: str) -> bool:
    lower = path.lower()
    if any(lower.startswith(x.lower()) for x in EXCLUDED_PREFIXES):
        return False
    if any(k in lower for k in KEYWORDS):
        return True
    if not exists_at_source(path):
        return False
    try:
        data = show(path)
        if len(data) > 2_000_000:
            return False
        text = data.decode("utf-8", errors="ignore").lower()
    except Exception:
        return False
    return any(k in text for k in KEYWORDS)


def copy_file(path: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(show(path))


def jsonl_rows(ref: str, path: str) -> list[dict]:
    raw = run("git", "show", f"{ref}:{path}")
    return [json.loads(line) for line in str(raw).splitlines() if line.strip()]


def write_jsonl(path: str, rows: list[dict]) -> None:
    Path(path).write_text("".join(json.dumps(x, sort_keys=True, separators=(",", ":")) + "\n" for x in rows))


def main() -> None:
    paths = changed_paths()
    relevant_changed = [p for p in paths if relevant(p)]

    package_roots: set[str] = set()
    contract_roots: set[str] = set()
    for path in relevant_changed:
        parts = path.split("/")
        if len(parts) >= 2 and parts[0] == "packages":
            package_roots.add("/".join(parts[:2]))
        if len(parts) >= 2 and parts[0] == "contracts":
            contract_roots.add("/".join(parts[:2]))

    selected: set[str] = set()
    for root in sorted(package_roots | contract_roots):
        selected.update(source_tree(root))
    for path in relevant_changed:
        if path.startswith(("evidence/", "runbooks/", "fixtures/", "docs/")) and exists_at_source(path):
            selected.add(path)

    selected = {
        p for p in selected
        if exists_at_source(p) and not any(p.lower().startswith(x.lower()) for x in EXCLUDED_PREFIXES)
    }
    if not package_roots:
        raise SystemExit(f"no #115 package discovered; relevant={relevant_changed}")

    for path in sorted(selected):
        copy_file(path)

    current_packages = [json.loads(x) for x in Path("build/packages.jsonl").read_text().splitlines() if x.strip()]
    current_checks = [json.loads(x) for x in Path("build/checks.jsonl").read_text().splitlines() if x.strip()]
    current_package_names = {x.get("name") for x in current_packages}
    current_check_names = {x.get("name") for x in current_checks}

    source_packages = jsonl_rows(SOURCE_SHA, "build/packages.jsonl")
    source_checks = jsonl_rows(SOURCE_SHA, "build/checks.jsonl")
    imported_package_rows = []
    imported_check_rows = []
    for row in source_packages:
        entry = str(row.get("entry", ""))
        if any(entry == root or entry.startswith(root + "/") for root in package_roots) and row.get("name") not in current_package_names:
            current_packages.append(row)
            current_package_names.add(row.get("name"))
            imported_package_rows.append(row)
    selected_package_names = {x.get("name") for x in imported_package_rows}
    for row in source_checks:
        script = str(row.get("script", ""))
        deps = set(row.get("deps", []))
        if (any(script.startswith(root + "/") for root in package_roots) or deps & selected_package_names) and row.get("name") not in current_check_names:
            current_checks.append(row)
            current_check_names.add(row.get("name"))
            imported_check_rows.append(row)
    write_jsonl("build/packages.jsonl", current_packages)
    write_jsonl("build/checks.jsonl", current_checks)

    inventory = {
        "schema": "ops.issue115SourceImport.v1",
        "status": "PASS",
        "sourceBase": SOURCE_BASE,
        "sourceCommit": SOURCE_SHA,
        "changedPathCount": len(paths),
        "relevantChangedPaths": relevant_changed,
        "packageRoots": sorted(package_roots),
        "contractRoots": sorted(contract_roots),
        "selectedFiles": sorted(selected),
        "importedPackageRows": imported_package_rows,
        "importedCheckRows": imported_check_rows,
        "excludedPrefixes": list(EXCLUDED_PREFIXES),
    }
    out = Path("evidence/ops-115-decision-closure")
    out.mkdir(parents=True, exist_ok=True)
    out.joinpath("source-import.json").write_text(json.dumps(inventory, sort_keys=True, indent=2) + "\n")


if __name__ == "__main__":
    main()
