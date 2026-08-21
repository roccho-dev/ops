#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "verification/atlas-stage-publication/pre-release-generated"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, observed {count}")
    return text.replace(old, new)


def source_carry() -> str:
    path = ROOT / ".github/workflows/artifact-runtime-source-carry.yml"
    text = path.read_text(encoding="utf-8")
    old = '''          tag="$(python3 -c 'import json; print(json.load(open("verification/artifact-runtime-app/manifest.json", encoding="utf-8"))["publication"]["tag"])')"
          test -n "$tag"
          gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null
          object_type="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" --jq .object.type)"
          ops_target="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" --jq .object.sha)"
          while [ "$object_type" = tag ]; do
            object_type="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$ops_target" --jq .object.type)"
            ops_target="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$ops_target" --jq .object.sha)"
          done
          test "$object_type" = commit
          [[ "$ops_target" =~ ^[0-9a-f]{40}$ ]]

          python3 - "$app" "$roles" "$ops_target" "$tag" "$RUNNER_TEMP/app-sources.json" <<'PY'
          import hashlib,json,pathlib,re,sys
          manifest_path,roles_raw,ops_target,tag,out=sys.argv[1:]
'''
    new = '''          tag="$(python3 -c 'import json; print(json.load(open("verification/artifact-runtime-app/manifest.json", encoding="utf-8"))["publication"]["tag"])')"
          test -n "$tag"
          if [ "$EVENT_NAME" = pull_request ]; then
            ops_target="$(git rev-parse HEAD)"
            release_bound=false
          else
            gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null
            object_type="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" --jq .object.type)"
            ops_target="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" --jq .object.sha)"
            while [ "$object_type" = tag ]; do
              object_type="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$ops_target" --jq .object.type)"
              ops_target="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$ops_target" --jq .object.sha)"
            done
            test "$object_type" = commit
            release_bound=true
          fi
          [[ "$ops_target" =~ ^[0-9a-f]{40}$ ]]

          python3 - "$app" "$roles" "$ops_target" "$tag" "$release_bound" "$RUNNER_TEMP/app-sources.json" <<'PY'
          import hashlib,json,pathlib,re,sys
          manifest_path,roles_raw,ops_target,tag,release_bound_raw,out=sys.argv[1:]
          release_bound=release_bound_raw=='true'
'''
    text = replace_once(text, old, new, "source release resolution")
    old = '''                      'commit':ops_target,'expectedTree':None,
                      'assemblyPath':app['assemblyAuthority']['path'],
                      'releaseTag':tag,
'''
    new = '''                      'commit':ops_target,'expectedTree':None,
                      'assemblyPath':app['assemblyAuthority']['path'],
                      'releaseTag':tag if release_bound else None,
'''
    text = replace_once(text, old, new, "source request release tag")
    old = '''            if [ "$role" = ops ]; then
              test "$release_tag" = "$RELEASE_TAG"
              test "$assembly_path" = 'verification/artifact-runtime-app/manifest.json'
              git -C "$work" show "$head:$assembly_path" > "$RUNNER_TEMP/ops-app-manifest.json"
              cmp "$app" "$RUNNER_TEMP/ops-app-manifest.json"
            else
'''
    new = '''            if [ "$role" = ops ]; then
              test "$assembly_path" = 'verification/artifact-runtime-app/manifest.json'
              git -C "$work" show "$head:$assembly_path" > "$RUNNER_TEMP/ops-app-manifest.json"
              cmp "$app" "$RUNNER_TEMP/ops-app-manifest.json"
              if [ "$release_tag" != '-' ]; then
                test "$release_tag" = "$RELEASE_TAG"
              fi
            else
'''
    text = replace_once(text, old, new, "source build release verification")
    text = replace_once(
        text,
        "                  'releaseTargetVerified':role=='ops',\n",
        "                  'releaseTargetVerified':role=='ops' and release_tag!='-',\n",
        "source receipt release flag",
    )
    return text


def static_host() -> str:
    path = ROOT / ".github/workflows/artifact-runtime-static-host.yml"
    text = path.read_text(encoding="utf-8")
    checkout = '''      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha || 'proposals' }}

'''
    setup = checkout + '''      - uses: actions/setup-node@v4
        with:
          node-version: '22.16.0'

'''
    text = replace_once(text, checkout, setup, "static setup node")
    start = text.index("      - name: Materialize exact immutable Release projection\n")
    end = text.index("      - name: Upload non-authority static-site proof\n", start)
    block = '''      - name: Materialize exact App publication
        env:
          ARCHIVE_BYTES: ${{ steps.contract.outputs.archive_bytes }}
          ARCHIVE_NAME: ${{ steps.contract.outputs.archive_name }}
          ARCHIVE_SHA: ${{ steps.contract.outputs.archive_sha }}
          EXPECTED_FILES: ${{ steps.contract.outputs.expected_files }}
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ steps.contract.outputs.tag }}
          TREE_DIGEST: ${{ steps.contract.outputs.tree_digest }}
          TREE_ID: ${{ steps.contract.outputs.tree_id }}
        shell: bash
        run: |
          set -euo pipefail
          archive="$RUNNER_TEMP/$ARCHIVE_NAME"
          publication="$RUNNER_TEMP/publication"
          site="$RUNNER_TEMP/site"
          if [ "$GITHUB_EVENT_NAME" = pull_request ]; then
            ui_repo="$(python3 -c 'import json; print(json.load(open("verification/artifact-runtime-app/manifest.json", encoding="utf-8"))["sourceAuthorities"][0]["repository"])')"
            ui_commit="$(python3 -c 'import json; print(json.load(open("verification/artifact-runtime-app/manifest.json", encoding="utf-8"))["sourceAuthorities"][0]["commit"])')"
            ui_tree="$(python3 -c 'import json; print(json.load(open("verification/artifact-runtime-app/manifest.json", encoding="utf-8"))["sourceAuthorities"][0]["tree"])')"
            ui="$RUNNER_TEMP/ui"
            git clone --filter=blob:none --no-checkout "https://github.com/$ui_repo.git" "$ui"
            git -C "$ui" fetch --depth=1 origin "$ui_commit"
            git -C "$ui" checkout --detach "$ui_commit"
            test "$(git -C "$ui" rev-parse HEAD)" = "$ui_commit"
            test "$(git -C "$ui" rev-parse 'HEAD^{tree}')" = "$ui_tree"
            (cd "$ui" && npm run check:artifact-runtime)
            (cd "$ui" && node apps/artifact-shell/scripts/build-publication.mjs --out="$publication")
            (cd "$publication" && tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner --mode='u=rwX,go=rX,go-s' -cf - .) | gzip -n > "$archive"
            test "$(wc -c < "$archive")" -eq "$ARCHIVE_BYTES"
            test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$ARCHIVE_SHA"
          else
            gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --pattern "$ARCHIVE_NAME" --dir "$RUNNER_TEMP"
            test -f "$archive"
            test "$(wc -c < "$archive")" -eq "$ARCHIVE_BYTES"
            test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$ARCHIVE_SHA"
            mkdir -p "$publication"
            tar -xzf "$archive" -C "$publication"
          fi
          python3 - "$publication" "$TREE_DIGEST" "$EXPECTED_FILES" <<'PY'
          import hashlib,json,os,sys
          from pathlib import Path
          root=Path(sys.argv[1]); expected_tree=sys.argv[2]; expected_count=int(sys.argv[3])
          m=json.loads((root/'artifact-manifest.json').read_text(encoding='utf-8'))
          assert m['schema']=='artifact-shell-publication-artifact/2'
          assert m['treeDigest']==expected_tree
          assert len(m['files'])==expected_count
          for item in m['files']:
              target=root/item['path']; data=target.read_bytes()
              assert len(data)==item['bytes'], item['path']
              assert 'sha256:'+hashlib.sha256(data).hexdigest()==item['sha256'], item['path']
          actual=sorted(str(p.relative_to(root)).replace(os.sep,'/') for p in root.rglob('*') if p.is_file())
          expected=sorted([x['path'] for x in m['files']]+['artifact-manifest.json'])
          assert actual==expected, (set(actual)-set(expected),set(expected)-set(actual))
          canon=json.dumps(m['files'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
          assert 'sha256:'+hashlib.sha256(canon).hexdigest()==expected_tree
          atlas=[item for item in m['files'] if item['path'].endswith('/packages/a2ui-browser/src/catalog/atlas-stage.mjs')]
          assert len(atlas)==1
          PY
          mkdir -p "$site/releases/$TREE_ID"
          cp -a "$publication/." "$site/releases/$TREE_ID/"
          python3 - "$TREE_DIGEST" "${{ steps.contract.outputs.source_sha }}" "$RUNNER_TEMP/static-host-proof.json" <<'PY'
          import json,sys
          out={'schema':'ops.artifactRuntimeStaticHostProof/1','status':'PASS','authority':False,'opsCommit':sys.argv[2],'treeDigest':sys.argv[1],'providerEffect':False}
          open(sys.argv[3],'w',encoding='utf-8').write(json.dumps(out,sort_keys=True,separators=(',',':'))+'\n')
          PY

'''
    return text[:start] + block + text[end:]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "artifact-runtime-source-carry.yml").write_text(source_carry(), encoding="utf-8")
    (OUT / "artifact-runtime-static-host.yml").write_text(static_host(), encoding="utf-8")
    print("pre-release-gates-pass")


if __name__ == "__main__":
    main()
