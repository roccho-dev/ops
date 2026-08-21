#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERATED = ROOT / "verification/atlas-stage-publication/generated"
TREE = "sha256:ce21da7009b4a440fef0b7857456fd0bd58efec83d71f23197565ac92cca96da"
KERNEL = "sha256:707a24aeb77bbc283ead837c0123bf628a16e10132cffdb40b56c0bc55a2a610"
UI_COMMIT = "81f36ed47e61764495edcf5fb53a276a6722e06c"
UI_TREE = "7836d64c2bb35bfe9d5ed176449cfefa78094eb1"
TREE_ID = TREE.removeprefix("sha256:")
KERNEL_ID = KERNEL.removeprefix("sha256:")
ARCHIVE = {
    "name": f"artifact-runtime.{TREE_ID}.tar.gz",
    "bytes": 39822,
    "sha256": "sha256:06adda6814115fbda8f67585232cc416911f44539a57e102c84b4e36154456e9",
}
CARRIER = {
    "name": f"artifact-runtime.{TREE_ID}.tar.gz.b64.txt",
    "bytes": 53096,
    "sha256": "sha256:a77ba5c6267bd89641daf119779b6be109b3486213a21a11d3734cc47e1cf02e",
    "codec": "standard-base64-no-whitespace",
}
CAPABILITIES = ["inspect.json@1", "render.a2ui@1", "render.a2ui.app@1"]


def read(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write(path: str, value: dict) -> None:
    (ROOT / path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def update_manifests() -> None:
    source = {"repository": "roccho-dev/ui", "commit": UI_COMMIT, "tree": UI_TREE}
    app_path = "verification/artifact-runtime-app/manifest.json"
    app = read(app_path)
    assert app["schema"] == "ops.artifactRuntimeApp/1" and app["issue"] == 193
    authority = app["sourceAuthorities"][0]
    authority["commit"] = UI_COMMIT
    authority["tree"] = UI_TREE
    if "canvas-renderer" not in authority["roles"]:
        authority["roles"].append("canvas-renderer")
    app["publication"] = {
        "treeDigest": TREE,
        "kernelDigest": KERNEL,
        "listedFiles": 54,
        "capabilities": CAPABILITIES,
        "tag": f"artifact-runtime-{TREE_ID}",
        "archive": ARCHIVE,
        "carrier": CARRIER,
    }
    entrypoints = {
        "browser": "index.html",
        "catalog": "catalog.json",
        "artifactManifest": "artifact-manifest.json",
        "codec": f"kernel/{KERNEL_ID}/packages/url-module/src/index.mjs",
        "invocation": f"kernel/{KERNEL_ID}/packages/artifact-invocation/src/index.mjs",
        "actionCompiler": f"kernel/{KERNEL_ID}/apps/artifact-shell/src/invocation-action.mjs",
        "atlasStage": f"kernel/{KERNEL_ID}/packages/a2ui-browser/src/catalog/atlas-stage.mjs",
        "shell": f"kernel/{KERNEL_ID}/apps/artifact-shell/src/shell-core.mjs",
    }
    app["entrypoints"] = entrypoints
    app["operations"] = {
        "encode": {"module": entrypoints["codec"], "export": "createUrlModuleUrl"},
        "decode": {"module": entrypoints["codec"], "export": "readUrlModule"},
        "validateInvocation": {"module": entrypoints["invocation"], "export": "validateArtifactInvocation"},
        "execute": {"module": entrypoints["invocation"], "export": "createArtifactInvocationRuntime"},
        "applyAction": {"module": entrypoints["actionCompiler"], "export": "applyArtifactStateAction"},
    }
    ui_improvement = next(row for row in app["improvementSources"] if row["repository"] == "roccho-dev/ui")
    ui_improvement["commit"] = UI_COMMIT
    ui_improvement["tree"] = UI_TREE
    write(app_path, app)

    publication_path = "verification/artifact-runtime-publication/manifest.json"
    publication = read(publication_path)
    assert publication["schema"] == "ops.artifactRuntimePublication/1" and publication["issue"] == 193
    publication["source"] = {**source, "acceptedPullRequest": 162}
    publication["publication"] = {
        "treeDigest": TREE,
        "kernelDigest": KERNEL,
        "capabilities": 3,
        "listedFiles": 54,
        "tag": f"artifact-runtime-{TREE_ID}",
        "archive": ARCHIVE,
        "carrier": CARRIER,
    }
    write(publication_path, publication)

    static_path = "verification/artifact-runtime-static-host/manifest.json"
    static = read(static_path)
    assert static["schema"] == "ops.artifactRuntimeStaticHost/1" and static["issue"] == 160 and static["appIssue"] == 193
    static["publication"] = {
        "treeDigest": TREE,
        "tag": f"artifact-runtime-{TREE_ID}",
        "archive": ARCHIVE,
        "listedFiles": 54,
    }
    static["provider"]["pathPrefix"] = f"releases/{TREE_ID}"
    static["readback"]["expectedListedFiles"] = 54
    write(static_path, static)


def replace_identities(text: str) -> str:
    replacements = {
        "3a6eaeeb77aef568987add668f5c9b6aa426f74e": UI_COMMIT,
        "dfe8814083abc1faadfc67a6fdc93d180c723244": UI_TREE,
        "b1f12244cc627fc27a97fc22f3da9e813dab10954c972c7033f99ab8d909184b": TREE_ID,
        "50f7417e5e96881e810c5691081820bd0ee9e9743784dc1b7f197554b49ce320": KERNEL_ID,
        "571592795ca9e4405330c8dfdc11fbd5db6b27d7ef0d672587e58fdbf6cdca6b": ARCHIVE["sha256"].removeprefix("sha256:"),
        "7105c25d4e278d008c7abb2b2ac5530957b037c088868b2940f6fb65013d003f": CARRIER["sha256"].removeprefix("sha256:"),
    }
    for before, after in replacements.items():
        text = text.replace(before, after)
    text = text.replace("projected['listedFiles']==53", "projected['listedFiles']==54")
    text = text.replace("p['publication']['listedFiles']==53", "p['publication']['listedFiles']==54")
    text = text.replace("==p['publication']['listedFiles']==53", "==p['publication']['listedFiles']==54")
    text = text.replace("'listedFiles':53", "'listedFiles':54")
    text = text.replace("'bytes':37333", "'bytes':39822")
    text = text.replace("'bytes':49780", "'bytes':53096")
    text = text.replace('"bytes": 37333', '"bytes": 39822')
    text = text.replace('"bytes": 49780', '"bytes": 53096')
    return text


def update_release(text: str) -> str:
    marker = "          assert ids==['inspect.json@1','render.a2ui@1','render.a2ui.app@1']\n"
    assert text.count(marker) == 1
    text = text.replace(marker, marker + "          atlas=[x for x in artifact['files'] if x['path'].endswith('/packages/a2ui-browser/src/catalog/atlas-stage.mjs')]\n          assert len(atlas)==1\n")
    old = '''      - name: Public readback and carry replay
        if: github.event_name != 'pull_request'
        shell: bash
        run: |
          set -euo pipefail
          base="https://github.com/$GITHUB_REPOSITORY/releases/download/$TAG"
          for name in "$ARCHIVE_NAME" "$CARRIER_NAME" "$APP_MANIFEST_NAME" "$PUBLICATION_MANIFEST_NAME" "$PUBLICATION_RECEIPT_NAME" "$CARRY_RECEIPT_NAME"; do
            curl --fail-with-body --location --retry 5 --retry-all-errors --silent --show-error "$base/$name" -o "$RUNNER_TEMP/readback-$name"
            cmp "$RUNNER_TEMP/$name" "$RUNNER_TEMP/readback-$name"
          done
          base64 --decode "$RUNNER_TEMP/readback-$CARRIER_NAME" > "$RUNNER_TEMP/readback-archive.tar.gz"
          cmp "$RUNNER_TEMP/readback-archive.tar.gz" "$RUNNER_TEMP/readback-$ARCHIVE_NAME"
          mkdir -p "$RUNNER_TEMP/readback-carried-app"
          tar -xzf "$RUNNER_TEMP/readback-archive.tar.gz" -C "$RUNNER_TEMP/readback-carried-app"
          node verification/artifact-runtime-app/carry-smoke.mjs \\
            "$RUNNER_TEMP/readback-carried-app" \\
            "$RUNNER_TEMP/readback-$APP_MANIFEST_NAME" \\
            "$RUNNER_TEMP/readback-carry-replay.json"
          cmp "$RUNNER_TEMP/readback-$CARRY_RECEIPT_NAME" "$RUNNER_TEMP/readback-carry-replay.json"
'''
    new = '''      - name: Authenticated Release readback and carry replay
        if: github.event_name != 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          set -euo pipefail
          readback="$RUNNER_TEMP/release-readback"
          mkdir -p "$readback"
          for name in "$ARCHIVE_NAME" "$CARRIER_NAME" "$APP_MANIFEST_NAME" "$PUBLICATION_MANIFEST_NAME" "$PUBLICATION_RECEIPT_NAME" "$CARRY_RECEIPT_NAME"; do
            gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --pattern "$name" --dir "$readback"
            cmp "$RUNNER_TEMP/$name" "$readback/$name"
          done
          base64 --decode "$readback/$CARRIER_NAME" > "$RUNNER_TEMP/readback-archive.tar.gz"
          cmp "$RUNNER_TEMP/readback-archive.tar.gz" "$readback/$ARCHIVE_NAME"
          mkdir -p "$RUNNER_TEMP/readback-carried-app"
          tar -xzf "$RUNNER_TEMP/readback-archive.tar.gz" -C "$RUNNER_TEMP/readback-carried-app"
          node verification/artifact-runtime-app/carry-smoke.mjs \\
            "$RUNNER_TEMP/readback-carried-app" \\
            "$readback/$APP_MANIFEST_NAME" \\
            "$RUNNER_TEMP/readback-carry-replay.json"
          cmp "$readback/$CARRY_RECEIPT_NAME" "$RUNNER_TEMP/readback-carry-replay.json"
'''
    assert text.count(old) == 1
    return text.replace(old, new)


def generate_workflows() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    sources = {
        "artifact-runtime-release.yml": ROOT / ".github/workflows/artifact-runtime-release.yml",
        "artifact-runtime-static-host.yml": ROOT / ".github/workflows/artifact-runtime-static-host.yml",
        "artifact-runtime-source-carry.yml": ROOT / ".github/workflows/artifact-runtime-source-carry.yml",
    }
    for name, source in sources.items():
        text = replace_identities(source.read_text(encoding="utf-8"))
        if name == "artifact-runtime-release.yml":
            text = update_release(text)
        (GENERATED / name).write_text(text, encoding="utf-8")


def validate() -> None:
    app = read("verification/artifact-runtime-app/manifest.json")
    publication = read("verification/artifact-runtime-publication/manifest.json")
    static = read("verification/artifact-runtime-static-host/manifest.json")
    assert app["sourceAuthorities"][0]["commit"] == UI_COMMIT
    assert app["sourceAuthorities"][0]["tree"] == UI_TREE
    assert app["publication"]["treeDigest"] == TREE
    assert app["publication"]["kernelDigest"] == KERNEL
    assert app["publication"]["listedFiles"] == 54
    assert app["entrypoints"]["atlasStage"].endswith("/packages/a2ui-browser/src/catalog/atlas-stage.mjs")
    assert publication["publication"] == {
        "treeDigest": TREE,
        "kernelDigest": KERNEL,
        "capabilities": 3,
        "listedFiles": 54,
        "tag": f"artifact-runtime-{TREE_ID}",
        "archive": ARCHIVE,
        "carrier": CARRIER,
    }
    assert static["publication"]["treeDigest"] == TREE
    assert static["publication"]["listedFiles"] == 54
    assert static["readback"]["expectedListedFiles"] == 54
    assert sorted(path.name for path in GENERATED.iterdir()) == [
        "artifact-runtime-release.yml",
        "artifact-runtime-source-carry.yml",
        "artifact-runtime-static-host.yml",
    ]


def main() -> None:
    os.chdir(ROOT)
    update_manifests()
    generate_workflows()
    validate()
    print(json.dumps({"schema": "ops.atlasStagePublicationPreparation/1", "status": "PASS", "treeDigest": TREE, "kernelDigest": KERNEL, "listedFiles": 54}))


if __name__ == "__main__":
    main()
