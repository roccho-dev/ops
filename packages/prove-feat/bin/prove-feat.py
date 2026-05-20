#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys


GATES = ("structure", "format", "deadnix", "contract-lint")


def command(args, cwd):
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True)


def git_root(cwd):
    result = command(["git", "rev-parse", "--show-toplevel"], cwd)
    if result.returncode == 0:
        return pathlib.Path(result.stdout.strip())
    return pathlib.Path(cwd).resolve()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def rel(path, root):
    return path.relative_to(root).as_posix()


def gate_nix_files(root):
    files = [
        root / "flake.nix",
        root / "packages" / "prove-feat" / "default.nix",
    ]
    return [path for path in files if path.is_file()]


def check_item(items, check_id, ok, detail):
    items.append({"id": check_id, "ok": bool(ok), "detail": detail})


def manifest_path(root):
    json_path = root / "spec" / "implements.json"
    tsv_path = root / "feat" / "implements.tsv"
    if json_path.is_file():
        return json_path
    if tsv_path.is_file():
        return tsv_path
    return json_path


def manifest_json(root):
    path = manifest_path(root)
    if path.suffix != ".json" or not path.is_file():
        raise ValueError("expected spec/implements.json")
    return read_json(path)


def locked_specs(lock):
    try:
        locked = lock["nodes"]["specs"]["locked"]
    except KeyError:
        return {}
    return locked


def manifest_kind(manifest):
    return manifest.get("kind") or manifest.get("schema")


def normalize_ref(ref, system):
    return ref.replace("<system>", system)


def output_name(ref, prefix, system):
    normalized = normalize_ref(ref, system)
    expected = f"{prefix}.{system}."
    if not normalized.startswith(expected):
        return None
    return normalized[len(expected):]


def attr_defined(flake_text, name):
    escaped = re.escape(name)
    patterns = [
        rf'(^|\s)"{escaped}"\s*=',
        rf"(^|\s){escaped}\s*=",
    ]
    return any(re.search(pattern, flake_text) for pattern in patterns)


def forbidden_flake_output_lines(flake_text, output_name):
    escaped = re.escape(output_name)
    pattern = re.compile(rf"(?m)^\s*{escaped}\s*=")
    return [match.start() for match in pattern.finditer(flake_text)]


def run_structure(root, system, args):
    items = []
    flake = root / "flake.nix"
    lock_path = root / "flake.lock"
    impl_path = manifest_path(root)

    check_item(items, "flake-nix-exists", flake.is_file(), "flake.nix exists")
    check_item(items, "flake-lock-exists", lock_path.is_file(), "flake.lock exists")
    check_item(items, "implements-manifest-exists", impl_path.is_file(), f"{rel(impl_path, root)} exists")

    flake_text = flake.read_text(encoding="utf-8") if flake.is_file() else ""
    specs_declared = "specs.url" in flake_text or re.search(r"(^|\s)specs\s*=\s*\{", flake_text) is not None
    check_item(items, "inputs-specs-declared", specs_declared, "flake.nix declares inputs.specs")
    check_item(items, "outputs-receive-specs", re.search(r"outputs\s*=\s*\{[^}]*specs", flake_text) is not None, "outputs argument includes specs")
    check_item(items, "prove-feat-package-wired", attr_defined(flake_text, "prove-feat"), "flake.nix defines prove-feat outputs")
    apps = forbidden_flake_output_lines(flake_text, "apps")
    devshells = forbidden_flake_output_lines(flake_text, "devShells")
    check_item(items, "no-top-level-apps-output", not apps, "flake.nix does not expose top-level apps")
    check_item(items, "no-top-level-devshells-output", not devshells, "flake.nix does not expose top-level devShells")

    lock = read_json(lock_path) if lock_path.is_file() else {}
    specs_locked = locked_specs(lock)
    check_item(items, "specs-lock-rev", bool(specs_locked.get("rev")), "flake.lock pins nodes.specs.locked.rev")
    check_item(items, "specs-lock-nar-hash", bool(specs_locked.get("narHash")), "flake.lock pins nodes.specs.locked.narHash")

    try:
        manifest = manifest_json(root)
        check_item(items, "manifest-kind", manifest_kind(manifest) == "spec.implements.v1", "manifest kind/schema is spec.implements.v1")
        check_item(items, "manifest-system", system in manifest.get("systems", []), f"manifest systems include {system}")
        check_item(items, "manifest-has-implements", bool(manifest.get("implements")), "manifest implements list is non-empty")
        refs = [
            normalize_ref(ref, system)
            for item in manifest.get("implements", [])
            for ref in item.get("outputs", []) + item.get("checks", [])
        ]
        check_item(items, "manifest-declares-prove-feat-package", f"packages.{system}.prove-feat" in refs, "manifest declares packages.<system>.prove-feat")
        check_item(items, "manifest-declares-prove-feat-check", f"checks.{system}.prove-feat" in refs, "manifest declares checks.<system>.prove-feat")
    except Exception as exc:
        check_item(items, "manifest-parse", False, str(exc))

    return {"id": "structure", "ok": all(item["ok"] for item in items), "checks": items}


def run_format(root, system, args):
    items = []
    nix_files = gate_nix_files(root)
    check_item(items, "nix-files-found", bool(nix_files), "prove-feat gate Nix files found")
    if nix_files:
        result = command(["nixfmt", "--check", *[str(path) for path in nix_files]], root)
        detail = (result.stdout + result.stderr).strip() or "nixfmt check passed"
        check_item(items, "nixfmt-rfc-style", result.returncode == 0, detail)

    json_files = [root / "flake.lock", manifest_path(root)]
    for path in json_files:
        if path.is_file():
            try:
                read_json(path)
                check_item(items, f"json-parse:{rel(path, root)}", True, "valid JSON")
            except Exception as exc:
                check_item(items, f"json-parse:{rel(path, root)}", False, str(exc))

    return {"id": "format", "ok": all(item["ok"] for item in items), "checks": items}


def run_deadnix(root, system, args):
    items = []
    nix_files = gate_nix_files(root)
    check_item(items, "nix-files-found", bool(nix_files), "prove-feat gate Nix files found")
    if nix_files:
        result = command(["deadnix", "--fail", *[str(path) for path in nix_files]], root)
        detail = (result.stdout + result.stderr).strip() or "deadnix passed"
        check_item(items, "deadnix", result.returncode == 0, detail)
    return {"id": "deadnix", "ok": all(item["ok"] for item in items), "checks": items}


def load_spec_data(args):
    catalog_path = pathlib.Path(args.spec_catalog or os.environ.get("PROVE_FEAT_SPEC_CATALOG", ""))
    placement_path = pathlib.Path(args.spec_placement_table or os.environ.get("PROVE_FEAT_SPEC_PLACEMENT_TABLE", ""))
    catalog = read_json(catalog_path) if str(catalog_path) and catalog_path.is_file() else []
    placement = read_json(placement_path) if str(placement_path) and placement_path.is_file() else []
    return catalog, placement


def run_contract_lint(root, system, args):
    items = []
    flake_text = (root / "flake.nix").read_text(encoding="utf-8")
    lock = read_json(root / "flake.lock")
    manifest = manifest_json(root)
    catalog, placement = load_spec_data(args)
    spec_packages = {entry.get("package") for entry in catalog if entry.get("package")}
    placement_by_package = {entry.get("package"): entry for entry in placement if entry.get("package")}

    check_item(items, "spec-catalog-loaded", bool(spec_packages), "specs package catalog is readable")
    check_item(items, "spec-placement-loaded", bool(placement_by_package), "specs placement table is readable")

    locked = locked_specs(lock)
    manifest_rev = str(manifest.get("specsRev", ""))
    locked_rev = str(locked.get("rev", ""))
    rev_ok = bool(manifest_rev and locked_rev and locked_rev.startswith(manifest_rev))
    check_item(items, "specs-rev-recorded", rev_ok, f"manifest specsRev={manifest_rev}, locked rev={locked_rev}")
    check_item(items, "specs-narhash-recorded", bool(locked.get("narHash")), "flake.lock records specs narHash")

    implements = manifest.get("implements", [])
    packages = [item.get("package") for item in implements]
    check_item(items, "no-duplicate-package-claims", len(packages) == len(set(packages)), "manifest package claims are unique")

    for item in implements:
        package = item.get("package")
        contract_id = item.get("contractId", "")
        outputs = item.get("outputs", [])
        checks = item.get("checks", [])
        label = package or "<missing>"
        check_item(items, f"{label}:package-present", bool(package), "package field is present")
        check_item(items, f"{label}:known-spec-package", package in spec_packages, "package is present in specs catalog")
        expected_contract = rf"^spec\.packages\.{re.escape(package or '')}\.v[0-9]+$"
        check_item(items, f"{label}:contract-id-shape", bool(re.match(expected_contract, contract_id)), f"contractId={contract_id}")
        check_item(items, f"{label}:outputs-present", bool(outputs), "outputs list is non-empty")
        check_item(items, f"{label}:checks-present", bool(checks), "checks list is non-empty")

        placement_row = placement_by_package.get(package, {})
        repo_id = placement_row.get("repoId")
        if package != "prove-feat":
            check_item(items, f"{label}:repo-placement-ops", repo_id == "ops", f"spec placement repoId={repo_id}")

        for output in outputs:
            name = output_name(output, "packages", system)
            ok = bool(name and attr_defined(flake_text, name))
            check_item(items, f"{label}:output:{output}", ok, "declared package output is wired in flake.nix")
        for check in checks:
            name = output_name(check, "checks", system)
            ok = bool(name and attr_defined(flake_text, name))
            check_item(items, f"{label}:check:{check}", ok, "declared check output is wired in flake.nix")

    prove_feat = next((item for item in implements if item.get("package") == "prove-feat"), None)
    check_item(items, "prove-feat-claim-present", bool(prove_feat), "manifest claims specs prove-feat contract")
    if prove_feat:
        refs = [normalize_ref(ref, system) for ref in prove_feat.get("outputs", []) + prove_feat.get("checks", [])]
        check_item(items, "prove-feat-package-contract", f"packages.{system}.prove-feat" in refs, "prove-feat claim exposes packages.<system>.prove-feat")
        check_item(items, "prove-feat-check-contract", f"checks.{system}.prove-feat" in refs, "prove-feat claim exposes checks.<system>.prove-feat")

    return {"id": "contract-lint", "ok": all(item["ok"] for item in items), "checks": items}


RUNNERS = {
    "structure": run_structure,
    "format": run_format,
    "deadnix": run_deadnix,
    "contract-lint": run_contract_lint,
}


def main():
    parser = argparse.ArgumentParser(description="prove ops as a specs-defined feat implementation repo")
    parser.add_argument("--root", default=None, help="repo root to inspect")
    parser.add_argument("--system", default=os.environ.get("PROVE_FEAT_SYSTEM", "x86_64-linux"))
    parser.add_argument("--gate", choices=GATES, action="append", help="gate to run; default runs all")
    parser.add_argument("--json", action="store_true", help="write machine JSON")
    parser.add_argument("--spec-catalog", default=None)
    parser.add_argument("--spec-placement-table", default=None)
    args = parser.parse_args()

    root = pathlib.Path(args.root).resolve() if args.root else git_root(pathlib.Path.cwd())
    gates = args.gate or list(GATES)
    results = []
    for gate in gates:
        results.append(RUNNERS[gate](root, args.system, args))
    ok = all(result["ok"] for result in results)
    report = {
        "kind": "ops.prove-feat.report.v1",
        "root": str(root),
        "system": args.system,
        "ok": ok,
        "gates": results,
    }

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        for result in results:
            status = "pass" if result["ok"] else "fail"
            print(f"{result['id']}: {status}")
            for item in result["checks"]:
                item_status = "pass" if item["ok"] else "fail"
                print(f"  {item_status} {item['id']}: {item['detail']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
