#!/usr/bin/env bash
set -euo pipefail

proof="$RUNNER_TEMP/gosh-go-task-actrun-proof"
fixture="verification/gosh-go-task-actrun"
runs="$RUNNER_TEMP/actrun-runs"
build="$RUNNER_TEMP/gosh-go-task-actrun-build"
source_manifest="$fixture/source.json"
mkdir -p "$proof" "$runs" "$build"

readarray -t source_values < <(python3 - "$source_manifest" <<'PY'
import json,re,sys
x=json.load(open(sys.argv[1],encoding="utf-8"))
assert x["schema"]=="ops.goshGoTaskActrunSources/1"
for key in ("actrun","goTask"):
    y=x[key]
    assert re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",y["repository"])
    assert re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+",y["tag"])
    assert re.fullmatch(r"[A-Za-z0-9_.-]+",y["asset"])
assert re.fullmatch(r"[0-9a-f]{40}",x["actrun"]["commit"])
print(x["actrun"]["repository"])
print(x["actrun"]["tag"])
print(x["actrun"]["commit"])
print(x["actrun"]["asset"])
print(x["goTask"]["repository"])
print(x["goTask"]["tag"])
print(x["goTask"]["asset"])
print(x["goTask"]["checksumsAsset"])
PY
)
actrun_repo="${source_values[0]}"
actrun_tag="${source_values[1]}"
actrun_expected_commit="${source_values[2]}"
actrun_asset="${source_values[3]}"
task_repo="${source_values[4]}"
task_tag="${source_values[5]}"
task_asset="${source_values[6]}"
task_checksums_asset="${source_values[7]}"

resolve_tag_commit() {
  local repository="$1" tag="$2"
  git ls-remote --tags "https://github.com/$repository.git" \
    "refs/tags/$tag" "refs/tags/$tag^{}" | \
    awk -v tag="$tag" '$2=="refs/tags/"tag {base=$1} $2=="refs/tags/"tag"^{}" {peeled=$1} END {print peeled ? peeled : base}'
}

release_asset_fields() {
  local release_json="$1" asset_name="$2"
  python3 - "$release_json" "$asset_name" <<'PY'
import json,sys
release=json.load(open(sys.argv[1],encoding="utf-8"))
assert release["draft"] is False
assert release["prerelease"] is False
rows=[x for x in release.get("assets",[]) if x.get("name")==sys.argv[2]]
assert len(rows)==1, (sys.argv[2], [x.get("name") for x in release.get("assets",[])])
x=rows[0]
print(release["id"])
print(x["id"])
print(x["browser_download_url"])
print(x.get("digest") or "")
print(x["size"])
PY
}

fetch_release_asset() {
  local repository="$1" tag="$2" asset_name="$3" prefix="$4"
  local release_json="$proof/$prefix.release.json"
  gh api "repos/$repository/releases/tags/$tag" > "$release_json"
  readarray -t fields < <(release_asset_fields "$release_json" "$asset_name")
  local out="$proof/$asset_name"
  curl --fail --location --retry 8 --retry-all-errors --retry-delay 1 \
    --silent --show-error "${fields[2]}" -o "$out"
  local actual_sha actual_bytes
  actual_sha="$(sha256sum "$out" | awk '{print $1}')"
  actual_bytes="$(stat -c %s "$out")"
  test "$actual_bytes" = "${fields[4]}"
  if test -n "${fields[3]}"; then test "${fields[3]}" = "sha256:$actual_sha"; fi
  printf '%s\n' "${fields[0]}" "${fields[1]}" "${fields[2]}" "${fields[3]}" "$actual_bytes" "$actual_sha" "$out"
}

safe_tar() {
  python3 - "$1" <<'PY'
import pathlib,sys,tarfile
p=pathlib.Path(sys.argv[1])
with tarfile.open(p,"r:gz") as tf:
    names=tf.getnames()
    assert names
    for name in names:
        q=pathlib.PurePosixPath(name)
        assert not q.is_absolute()
        assert ".." not in q.parts
PY
}

carry_binary() {
  local name="$1" source="$2" version="$3"
  local binary_sha binary_bytes carrier restored carrier_sha carrier_bytes
  binary_sha="$(sha256sum "$source" | awk '{print $1}')"
  binary_bytes="$(stat -c %s "$source")"
  carrier="$proof/$name.$version.linux-amd64.b64.txt"
  restored="$proof/$name.$version.restored"
  base64 -w0 "$source" > "$carrier"
  base64 --decode "$carrier" > "$restored"
  chmod +x "$restored"
  cmp "$source" "$restored"
  test "$(sha256sum "$restored" | awk '{print $1}')" = "$binary_sha"
  carrier_sha="$(sha256sum "$carrier" | awk '{print $1}')"
  carrier_bytes="$(stat -c %s "$carrier")"
  printf '%s\n' "$binary_bytes" "$binary_sha" "$carrier" "$carrier_bytes" "$carrier_sha" "$restored"
}

# 1. Exact actrun upstream prebuilt -> Carrier -> restored executable.
actrun_tag_commit="$(resolve_tag_commit "$actrun_repo" "$actrun_tag")"
test "$actrun_tag_commit" = "$actrun_expected_commit"
readarray -t actrun_download < <(fetch_release_asset "$actrun_repo" "$actrun_tag" "$actrun_asset" actrun)
actrun_archive="${actrun_download[6]}"
safe_tar "$actrun_archive"
mkdir -p "$build/actrun"
tar -xzf "$actrun_archive" -C "$build/actrun" actrun
test -x "$build/actrun/actrun"
"$build/actrun/actrun" --help > "$proof/actrun-help.txt"
readarray -t actrun_carried < <(carry_binary actrun "$build/actrun/actrun" "$actrun_tag")
actrun_restored="${actrun_carried[5]}"

# 2. Exact go-task upstream prebuilt -> published checksum/API digest -> Carrier -> restored executable.
task_tag_commit="$(resolve_tag_commit "$task_repo" "$task_tag")"
test -n "$task_tag_commit"
readarray -t task_download < <(fetch_release_asset "$task_repo" "$task_tag" "$task_asset" go-task)
readarray -t checksums_download < <(fetch_release_asset "$task_repo" "$task_tag" "$task_checksums_asset" go-task-checksums)
task_archive="${task_download[6]}"
task_checksums="${checksums_download[6]}"
expected_task_archive_sha="$(awk -v name="$task_asset" '$2==name || $2=="*"name {print $1}' "$task_checksums")"
test "$expected_task_archive_sha" = "${task_download[5]}"
safe_tar "$task_archive"
mkdir -p "$build/task"
tar -xzf "$task_archive" -C "$build/task" task
test -x "$build/task/task"
"$build/task/task" --version > "$proof/go-task-version.txt"
grep -F "${task_tag#v}" "$proof/go-task-version.txt"
readarray -t task_carried < <(carry_binary go-task "$build/task/task" "$task_tag")
task_restored="${task_carried[5]}"

# 3. Exact checked-out gosh source -> deterministic native build -> Carrier -> restored executable.
gosh_source_commit="$(git rev-parse HEAD)"
gosh_source_tree="$(git rev-parse HEAD^{tree})"
mkdir -p "$build/gosh-a" "$build/gosh-b"
(
  cd packages/gosh
  CGO_ENABLED=0 go build -buildvcs=false -trimpath -o "$build/gosh-a/gosh" ./cmd/gosh
  CGO_ENABLED=0 go build -buildvcs=false -trimpath -o "$build/gosh-b/gosh" ./cmd/gosh
)
cmp "$build/gosh-a/gosh" "$build/gosh-b/gosh"
"$build/gosh-a/gosh" version > "$proof/gosh-help.txt"
readarray -t gosh_carried < <(carry_binary gosh "$build/gosh-a/gosh" "$gosh_source_commit")
gosh_restored="${gosh_carried[5]}"

# 4. Bind exact restored binaries into the fixture. JSONL owns only the executable identity/entry.
fixture_abs="$(realpath "$fixture")"
rm -rf "$fixture/bin" "$fixture/.gosh" "$fixture/out"
mkdir -p "$fixture/bin" "$fixture/.gosh"
cp "$gosh_restored" "$fixture/bin/gosh"
cp "$task_restored" "$fixture/bin/task"
chmod +x "$fixture/bin/gosh" "$fixture/bin/task"
task_abs="$fixture_abs/bin/task"
cat > "$fixture/.gosh/events.jsonl" <<JSONL
{"kind":"gosh.tool.require.v1","id":"go-task","resolver":"absolute","programAbs":"$task_abs"}
{"kind":"gosh.target.upsert.v1","id":"ci","targetKind":"exec","tool":"go-task","args":["--taskfile","Taskfile.yml","ci"]}
{"kind":"gosh.target.upsert.v1","id":"failure-propagation","targetKind":"exec","tool":"go-task","args":["--taskfile","Taskfile.yml","must-block"]}
JSONL

# 5. Direct gosh -> go-task -> fork/join DAG.
"$fixture/bin/gosh" --root "$fixture_abs" plan ci > "$proof/gosh-plan.direct.json"
"$fixture/bin/gosh" --root "$fixture_abs" run ci > "$proof/gosh-run.direct.json"
cp "$fixture/.gosh/events.jsonl" "$proof/gosh-events.jsonl"
cp "$fixture/.gosh/result.jsonl" "$proof/gosh-result.direct.jsonl"
cp "$fixture/out/proof.json" "$proof/go-task-parallel.direct.json"

# Expected failure: failed dependency must block its dependent command.
set +e
"$fixture/bin/gosh" --root "$fixture_abs" run failure-propagation \
  > "$proof/gosh-run.failure.json" 2> "$proof/gosh-run.failure.stderr"
failure_exit=$?
set -e
test "$failure_exit" -ne 0
test -f "$fixture/out/failure/root.json"
test ! -e "$fixture/out/failure/unexpected.txt"
printf '%s\n' "$failure_exit" > "$proof/failure-exit.txt"

# Preserve direct output, then prove the same chain through actrun's thin workflow adapter.
rm -rf "$fixture/out"
rm -f "$fixture/.gosh/result.jsonl"
"$actrun_restored" workflow run "$fixture/workflow.yml" \
  --workspace-mode local --no-nix --run-root "$runs"
"$actrun_restored" run view run-1 --run-root "$runs" --json > "$proof/actrun-run.json"
"$actrun_restored" run logs run-1 --run-root "$runs" > "$proof/actrun-run.log"
cp "$fixture/.gosh/result.jsonl" "$proof/gosh-result.via-actrun.jsonl"
cp "$fixture/out/proof.json" "$proof/go-task-parallel.via-actrun.json"
find "$runs" -type f -print | sort > "$proof/actrun-run-files.txt"

# 6. Join all identities and behavior into one machine receipt.
python3 - "$proof/proof.receipt.json" \
  "$source_manifest" "$proof/go-task-parallel.direct.json" \
  "$proof/go-task-parallel.via-actrun.json" "$proof/actrun-run.json" \
  "$proof/gosh-run.direct.json" "$failure_exit" \
  "$actrun_tag_commit" "${actrun_download[0]}" "${actrun_download[1]}" \
  "${actrun_download[4]}" "${actrun_download[5]}" \
  "${actrun_carried[0]}" "${actrun_carried[1]}" "${actrun_carried[3]}" "${actrun_carried[4]}" \
  "$task_tag_commit" "${task_download[0]}" "${task_download[1]}" \
  "${task_download[4]}" "${task_download[5]}" \
  "${checksums_download[1]}" "${checksums_download[5]}" \
  "${task_carried[0]}" "${task_carried[1]}" "${task_carried[3]}" "${task_carried[4]}" \
  "$gosh_source_commit" "$gosh_source_tree" \
  "${gosh_carried[0]}" "${gosh_carried[1]}" "${gosh_carried[3]}" "${gosh_carried[4]}" <<'PY'
import json,pathlib,sys
args=sys.argv[1:]
(out,source_path,direct_path,via_path,actrun_run_path,gosh_run_path,failure_exit,
 actrun_commit,actrun_release_id,actrun_asset_id,actrun_archive_bytes,actrun_archive_sha,
 actrun_binary_bytes,actrun_binary_sha,actrun_carrier_bytes,actrun_carrier_sha,
 task_commit,task_release_id,task_asset_id,task_archive_bytes,task_archive_sha,
 checksums_asset_id,checksums_sha,task_binary_bytes,task_binary_sha,task_carrier_bytes,task_carrier_sha,
 gosh_commit,gosh_tree,gosh_binary_bytes,gosh_binary_sha,gosh_carrier_bytes,gosh_carrier_sha)=args
source=json.load(open(source_path,encoding="utf-8"))
direct=json.load(open(direct_path,encoding="utf-8"))
via=json.load(open(via_path,encoding="utf-8"))
actrun=json.load(open(actrun_run_path,encoding="utf-8"))
gosh=json.load(open(gosh_run_path,encoding="utf-8"))
assert direct["status"]==via["status"]=="PASS"
assert direct["semanticSha256"]==via["semanticSha256"]
assert actrun["state"]=="completed" and actrun["ok"] is True
assert gosh["ok"] is True and gosh["data"]["status"]=="succeeded"
value={
  "schema":"ops.goshGoTaskActrunProof/1",
  "status":"PASS",
  "chain":["actrun","gosh","go-task","Taskfile.yml"],
  "sources":source,
  "identities":{
    "actrun":{
      "tagCommit":actrun_commit,"releaseId":int(actrun_release_id),"assetId":int(actrun_asset_id),
      "archive":{"bytes":int(actrun_archive_bytes),"sha256":"sha256:"+actrun_archive_sha},
      "binary":{"bytes":int(actrun_binary_bytes),"sha256":"sha256:"+actrun_binary_sha},
      "carrier":{"bytes":int(actrun_carrier_bytes),"sha256":"sha256:"+actrun_carrier_sha,
                 "payloadSha256":"sha256:"+actrun_binary_sha},
    },
    "goTask":{
      "tagCommit":task_commit,"releaseId":int(task_release_id),"assetId":int(task_asset_id),
      "checksumsAssetId":int(checksums_asset_id),"checksumsSha256":"sha256:"+checksums_sha,
      "archive":{"bytes":int(task_archive_bytes),"sha256":"sha256:"+task_archive_sha},
      "binary":{"bytes":int(task_binary_bytes),"sha256":"sha256:"+task_binary_sha},
      "carrier":{"bytes":int(task_carrier_bytes),"sha256":"sha256:"+task_carrier_sha,
                 "payloadSha256":"sha256:"+task_binary_sha},
    },
    "gosh":{
      "sourceCommit":gosh_commit,"sourceTree":gosh_tree,"reproducibleBuild":True,
      "binary":{"bytes":int(gosh_binary_bytes),"sha256":"sha256:"+gosh_binary_sha},
      "carrier":{"bytes":int(gosh_carrier_bytes),"sha256":"sha256:"+gosh_carrier_sha,
                 "payloadSha256":"sha256:"+gosh_binary_sha},
    },
  },
  "behavior":{
    "direct":direct,
    "viaActrun":via,
    "sameSemanticOutput":direct["semanticSha256"]==via["semanticSha256"],
    "failurePropagation":{"goshExit":int(failure_exit),"dependentStarted":False},
  },
  "boundaries":{
    "taskDagAuthority":"Taskfile.yml",
    "goshJsonlAuthority":"exact executable identity and entry only",
    "githubYamlAuthority":"trigger and adapter only",
  },
}
pathlib.Path(out).write_text(json.dumps(value,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
PY

# Keep exact restored executables for current-sandbox replay; remove mutable fixture copies.
cp "$fixture/bin/gosh" "$proof/gosh"
cp "$fixture/bin/task" "$proof/task"
cp "$actrun_restored" "$proof/actrun"
chmod +x "$proof/gosh" "$proof/task" "$proof/actrun"
cp "$fixture/Taskfile.yml" "$proof/Taskfile.yml"
cp "$fixture/probe.py" "$proof/probe.py"
cp "$fixture/workflow.yml" "$proof/workflow.yml"
rm -rf "$fixture/bin" "$fixture/.gosh" "$fixture/out"

python3 - "$proof/proof.receipt.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1],encoding="utf-8"))
assert x["status"]=="PASS"
print(json.dumps({"status":"PASS","chain":x["chain"],"parallelOverlapNs":x["behavior"]["direct"]["metrics"]["parallelOverlapNs"]},sort_keys=True))
PY
