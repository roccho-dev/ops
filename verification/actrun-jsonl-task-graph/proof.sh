#!/usr/bin/env bash
set -euo pipefail

proof="$RUNNER_TEMP/actrun-jsonl-proof"
runs="$RUNNER_TEMP/actrun-runs"
extract="$RUNNER_TEMP/actrun-extract"
source_manifest="verification/actrun-jsonl-task-graph/source.json"
mkdir -p "$proof" "$runs" "$extract"

read -r repository tag expected_commit asset_name < <(
  python3 - "$source_manifest" <<'PY'
import json,re,sys
x=json.load(open(sys.argv[1],encoding="utf-8"))
assert x["schema"]=="ops.actrunCarrySource/1"
assert re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",x["repository"])
assert re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+",x["tag"])
assert re.fullmatch(r"[0-9a-f]{40}",x["commit"])
assert re.fullmatch(r"[A-Za-z0-9_.-]+",x["asset"])
print(x["repository"],x["tag"],x["commit"],x["asset"])
PY
)

tag_commit="$(git ls-remote --tags "https://github.com/$repository.git" \
  "refs/tags/$tag" "refs/tags/$tag^{}" | \
  awk -v tag="$tag" '$2=="refs/tags/"tag {base=$1} $2=="refs/tags/"tag"^{}" {peeled=$1} END {print peeled ? peeled : base}')"
test "$tag_commit" = "$expected_commit"

gh api "repos/$repository/releases/tags/$tag" > "$proof/release.json"
readarray -t asset < <(python3 - "$proof/release.json" "$asset_name" <<'PY'
import json,sys
release=json.load(open(sys.argv[1],encoding="utf-8"))
rows=[x for x in release.get("assets",[]) if x.get("name")==sys.argv[2]]
assert len(rows)==1
x=rows[0]
print(release["id"])
print(x["id"])
print(x["browser_download_url"])
print(x.get("digest") or "")
print(x["size"])
PY
)
release_id="${asset[0]}"
asset_id="${asset[1]}"
asset_url="${asset[2]}"
api_digest="${asset[3]}"
api_size="${asset[4]}"

archive="$proof/$asset_name"
curl --fail --location --retry 5 --retry-all-errors --silent --show-error \
  "$asset_url" -o "$archive"
archive_sha="$(sha256sum "$archive" | awk '{print $1}')"
archive_bytes="$(stat -c %s "$archive")"
test "$archive_bytes" = "$api_size"
if test -n "$api_digest"; then test "$api_digest" = "sha256:$archive_sha"; fi
test "$(tar -tzf "$archive")" = actrun

tar -C "$extract" -xzf "$archive"
test -x "$extract/actrun"
"$extract/actrun" --help > "$proof/actrun-help.txt"
binary_sha="$(sha256sum "$extract/actrun" | awk '{print $1}')"
binary_bytes="$(stat -c %s "$extract/actrun")"

carrier="$proof/actrun.$tag.linux-x64.b64.txt"
restored="$proof/actrun.restored"
base64 -w0 "$extract/actrun" > "$carrier"
base64 --decode "$carrier" > "$restored"
chmod +x "$restored"
cmp "$extract/actrun" "$restored"
test "$(sha256sum "$restored" | awk '{print $1}')" = "$binary_sha"
carrier_sha="$(sha256sum "$carrier" | awk '{print $1}')"
carrier_bytes="$(stat -c %s "$carrier")"

python3 - "$proof/carry.receipt.json" \
  "$repository" "$tag" "$tag_commit" "$release_id" "$asset_id" \
  "$asset_name" "$archive_bytes" "$archive_sha" "$api_digest" \
  "$binary_bytes" "$binary_sha" "$(basename "$carrier")" \
  "$carrier_bytes" "$carrier_sha" <<'PY'
import json,pathlib,sys
(out,repository,tag,commit,release_id,asset_id,asset_name,archive_bytes,
 archive_sha,api_digest,binary_bytes,binary_sha,carrier_name,
 carrier_bytes,carrier_sha)=sys.argv[1:]
value={
  "schema":"ops.actrunCarryReceipt/1","status":"PASS",
  "source":{"repository":repository,"tag":tag,"commit":commit,
            "releaseId":int(release_id),"assetId":int(asset_id),"asset":asset_name},
  "archive":{"bytes":int(archive_bytes),"sha256":"sha256:"+archive_sha,
             "apiDigest":api_digest or None},
  "binary":{"name":"actrun","bytes":int(binary_bytes),"sha256":"sha256:"+binary_sha},
  "carrier":{"name":carrier_name,"codec":"standard-base64","bytes":int(carrier_bytes),
             "sha256":"sha256:"+carrier_sha,"payloadSha256":"sha256:"+binary_sha},
  "restore":{"status":"PASS","sha256":"sha256:"+binary_sha},
}
pathlib.Path(out).write_text(json.dumps(value,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
PY

TASK_GRAPH_PROOF_DIR="$proof" "$restored" workflow run \
  verification/actrun-jsonl-task-graph/workflow.yml \
  --workspace-mode local \
  --no-nix \
  --run-root "$runs"

"$restored" run view run-1 --run-root "$runs" --json > "$proof/actrun-run.json"
"$restored" run logs run-1 --run-root "$runs" > "$proof/actrun-run.log"
cat "$proof/actrun-run.log"
find "$runs" -type f -print | sort > "$proof/actrun-run-files.txt"

task_receipt="$proof/task-graph.receipt.json"
value_file="$proof/task-output/value.txt"
status_file="$proof/task-output/status.txt"
python3 - "$proof/carry.receipt.json" "$task_receipt" <<'PY'
import json,sys
carry=json.load(open(sys.argv[1],encoding="utf-8"))
task=json.load(open(sys.argv[2],encoding="utf-8"))
assert carry["schema"]=="ops.actrunCarryReceipt/1" and carry["status"]=="PASS"
assert carry["restore"]["sha256"]==carry["binary"]["sha256"]==carry["carrier"]["payloadSha256"]
assert task=={
  "schema":"ops.taskGraphReceipt/1","status":"PASS","target":"verify",
  "graph":"verification/actrun-jsonl-task-graph/tasks.jsonl",
  "order":["produce","verify"],
  "results":[{"id":"produce","exitCode":0},{"id":"verify","exitCode":0}],
}
PY
test "$(cat "$value_file")" = 42
test "$(cat "$status_file")" = PASS

python3 - "$proof/proof.receipt.json" "$proof/carry.receipt.json" "$task_receipt" <<'PY'
import json,pathlib,sys
carry=json.load(open(sys.argv[2],encoding="utf-8"))
task=json.load(open(sys.argv[3],encoding="utf-8"))
value={
  "schema":"ops.actrunJsonlTaskGraphProof/1","status":"PASS",
  "carry":carry,"taskGraph":task,
  "observed":{"value":42,"status":"PASS","nodes":2,"edges":1},
}
pathlib.Path(sys.argv[1]).write_text(json.dumps(value,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
PY
