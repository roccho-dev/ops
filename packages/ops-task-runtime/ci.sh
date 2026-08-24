#!/usr/bin/env bash
set -euo pipefail

package_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="${OPS_TASK_RUNTIME_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
out="${OPS_TASK_RUNTIME_OUT:-${RUNNER_TEMP:-/tmp}/ops-task-runtime}"
scratch="$repo_root/.ops-task-runtime-build"
scratch_rel=".ops-task-runtime-build"
work="$scratch/work"
assets="$out/assets"
pack="$work/pack"
source_manifest="$package_dir/source.json"

cleanup() { rm -rf "$scratch"; }
trap cleanup EXIT
rm -rf "$out" "$scratch"
mkdir -p "$work" "$assets"

node "$package_dir/tests/e2e.mjs"

readarray -t source_values < <(python3 - "$source_manifest" <<'PY'
import json,sys
x=json.load(open(sys.argv[1],encoding='utf-8'))
print(x['authority']); print(x['target'])
for key in ('actrun','goTask'):
    y=x[key]
    for field in ('repository','tag','commit','asset','archiveSha256','binarySha256'):
        print(y[field])
    if key=='goTask':
        print(y['checksumsAsset']); print(y['checksumsSha256'])
PY
)
authority="${source_values[0]}"
target="${source_values[1]}"
actrun_repo="${source_values[2]}"; actrun_tag="${source_values[3]}"; actrun_commit="${source_values[4]}"; actrun_asset="${source_values[5]}"; actrun_archive_sha="${source_values[6]}"; actrun_binary_sha="${source_values[7]}"
task_repo="${source_values[8]}"; task_tag="${source_values[9]}"; task_commit="${source_values[10]}"; task_asset="${source_values[11]}"; task_archive_sha="${source_values[12]}"; task_binary_sha="${source_values[13]}"; task_checksums_asset="${source_values[14]}"; task_checksums_sha="${source_values[15]}"

test "$authority" = roccho-dev/adrs#317
test "$target" = linux-amd64

sha() { sha256sum "$1" | awk '{print $1}'; }
bytes() { stat -c %s "$1"; }

resolve_tag_commit() {
  local repository="$1" tag="$2"
  git ls-remote --tags "https://github.com/$repository.git" "refs/tags/$tag" "refs/tags/$tag^{}" |
    awk -v tag="$tag" '$2=="refs/tags/"tag {base=$1} $2=="refs/tags/"tag"^{}" {peeled=$1} END {print peeled ? peeled : base}'
}

fetch_asset() {
  local repository="$1" tag="$2" name="$3" expected="$4" dest="$5"
  local release="$work/$(echo "$repository-$name" | tr '/ ' '__').release.json"
  gh api "repos/$repository/releases/tags/$tag" > "$release"
  local url digest size
  readarray -t fields < <(python3 - "$release" "$name" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding='utf-8'))
assert not r['draft'] and not r['prerelease']
rows=[x for x in r.get('assets',[]) if x.get('name')==sys.argv[2]]
assert len(rows)==1
x=rows[0]
print(x['browser_download_url']); print(x.get('digest') or ''); print(x['size'])
PY
  )
  url="${fields[0]}"; digest="${fields[1]}"; size="${fields[2]}"
  curl --fail --location --retry 8 --retry-all-errors --retry-delay 1 --silent --show-error "$url" -o "$dest"
  test "$(bytes "$dest")" = "$size"
  test "$(sha "$dest")" = "$expected"
  if test -n "$digest"; then test "$digest" = "sha256:$expected"; fi
}

safe_tar() {
  python3 - "$1" <<'PY'
import pathlib,sys,tarfile
with tarfile.open(sys.argv[1],'r:gz') as tf:
    names=tf.getnames(); assert names
    for name in names:
        p=pathlib.PurePosixPath(name)
        assert not p.is_absolute() and '..' not in p.parts
PY
}

if test -n "$(git -C "$repo_root" status --porcelain --untracked-files=all -- packages/gosh)"; then
  echo 'packages/gosh must be clean before Carrier creation' >&2
  exit 1
fi
repo_head="$(git -C "$repo_root" rev-parse HEAD)"
gosh_commit="${OPS_TASK_RUNTIME_GOSH_COMMIT:-$(git -C "$repo_root" log -1 --format=%H -- packages/gosh)}"
gosh_tree="${OPS_TASK_RUNTIME_GOSH_TREE:-$(git -C "$repo_root" rev-parse HEAD:packages/gosh)}"
test -n "$gosh_commit"
test -n "$gosh_tree"

input_dir="${OPS_TASK_RUNTIME_INPUT_DIR:-}"
bin_dir="$work/input/bin"
license_dir="$work/input/licenses"
mkdir -p "$bin_dir" "$license_dir"

if test -n "$input_dir"; then
  cp "$input_dir/actrun" "$bin_dir/actrun"
  cp "$input_dir/task" "$bin_dir/task"
  cp "$input_dir/gosh" "$bin_dir/gosh"
  cp "$input_dir/task_checksums.txt" "$work/task_checksums.txt"
  cp "$input_dir/actrun.LICENSE.txt" "$license_dir/actrun.LICENSE.txt"
  cp "$input_dir/go-task.LICENSE.txt" "$license_dir/go-task.LICENSE.txt"
else
  test "$(resolve_tag_commit "$actrun_repo" "$actrun_tag")" = "$actrun_commit"
  test "$(resolve_tag_commit "$task_repo" "$task_tag")" = "$task_commit"

  actrun_archive="$work/$actrun_asset"
  task_archive="$work/$task_asset"
  task_checksums="$work/$task_checksums_asset"
  fetch_asset "$actrun_repo" "$actrun_tag" "$actrun_asset" "$actrun_archive_sha" "$actrun_archive"
  fetch_asset "$task_repo" "$task_tag" "$task_asset" "$task_archive_sha" "$task_archive"
  fetch_asset "$task_repo" "$task_tag" "$task_checksums_asset" "$task_checksums_sha" "$task_checksums"
  safe_tar "$actrun_archive"; safe_tar "$task_archive"
  test "$(awk -v name="$task_asset" '$2==name || $2=="*"name {print $1}' "$task_checksums")" = "$task_archive_sha"
  mkdir -p "$work/actrun-extract" "$work/task-extract"
  tar -xzf "$actrun_archive" -C "$work/actrun-extract" actrun
  tar -xzf "$task_archive" -C "$work/task-extract" task LICENSE
  cp "$work/actrun-extract/actrun" "$bin_dir/actrun"
  cp "$work/task-extract/task" "$bin_dir/task"
  cp "$task_checksums" "$work/task_checksums.txt"
  cp "$work/task-extract/LICENSE" "$license_dir/go-task.LICENSE.txt"
  curl --fail --location --retry 5 --retry-all-errors --silent --show-error \
    "https://raw.githubusercontent.com/$actrun_repo/$actrun_commit/LICENSE" \
    -o "$license_dir/actrun.LICENSE.txt"

  mkdir -p "$work/gosh-a" "$work/gosh-b"
  (
    cd "$repo_root/packages/gosh"
    CGO_ENABLED=0 go build -buildvcs=false -trimpath -o "$work/gosh-a/gosh" ./cmd/gosh
    CGO_ENABLED=0 go build -buildvcs=false -trimpath -o "$work/gosh-b/gosh" ./cmd/gosh
  )
  cmp "$work/gosh-a/gosh" "$work/gosh-b/gosh"
  cp "$work/gosh-a/gosh" "$bin_dir/gosh"
fi
chmod 0755 "$bin_dir/actrun" "$bin_dir/task" "$bin_dir/gosh"
test "$(sha "$bin_dir/actrun")" = "$actrun_binary_sha"
test "$(sha "$bin_dir/task")" = "$task_binary_sha"
test "$(sha "$work/task_checksums.txt")" = "$task_checksums_sha"
"$bin_dir/actrun" --help >/dev/null
"$bin_dir/task" --version | grep -F "${task_tag#v}"
"$bin_dir/gosh" version >/dev/null
gosh_binary_sha="$(sha "$bin_dir/gosh")"

bin_rel="$scratch_rel/work/input/bin"
license_rel="$scratch_rel/work/input/licenses"
tool_spec="$work/tool-spec.json"
python3 - "$tool_spec" "$bin_rel" "$license_rel" <<'PY'
import json,pathlib,sys
out=pathlib.Path(sys.argv[1]); bin_dir=sys.argv[2]; licenses=sys.argv[3]
value={'tools':[
 {'name':'actrun','source':f'{bin_dir}/actrun','smoke':['--help'],'files':[{'source':f'{licenses}/actrun.LICENSE.txt','path':'share/licenses/actrun.LICENSE.txt'}]},
 {'name':'task','source':f'{bin_dir}/task','smoke':['--version'],'files':[{'source':f'{licenses}/go-task.LICENSE.txt','path':'share/licenses/go-task.LICENSE.txt'}]},
 {'name':'gosh','source':f'{bin_dir}/gosh','smoke':['version']},
]}
out.write_text(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
PY
(
  cd "$repo_root"
  python3 packages/ops-portable-runtime-pack/bin/ops-portable-runtime-pack.py create \
    --target-system x86_64-linux \
    --tool-spec "$scratch_rel/work/tool-spec.json" \
    --out-dir "$scratch_rel/work/pack" >/dev/null
)
mkdir -p "$pack/fixtures" "$pack/metadata"
cp "$package_dir/Taskfile.yml" "$package_dir/probe.py" "$package_dir/workflow.yml" "$package_dir/source.json" "$pack/fixtures/"
cp "$tool_spec" "$pack/metadata/tool-spec.json"
chmod 0644 "$pack/fixtures/"* "$pack/metadata/tool-spec.json"

python3 - "$pack" "$source_manifest" "$gosh_commit" "$gosh_tree" "$gosh_binary_sha" <<'PY'
import hashlib,json,pathlib,sys
pack=pathlib.Path(sys.argv[1]); source_path=pathlib.Path(sys.argv[2]); commit,tree,gosh_sha=sys.argv[3:]
source=json.loads(source_path.read_text(encoding='utf-8'))
manifest=json.loads((pack/'MANIFEST.json').read_text(encoding='utf-8'))
manifest['createdAt']='1970-01-01T00:00:00Z'
manifest['authority']=source['authority']
actual_spec=pack/'metadata/tool-spec.json'
manifest['toolSpec']={'path':'metadata/tool-spec.json','sha256':hashlib.sha256(actual_spec.read_bytes()).hexdigest()}
logical={
 'actrun':f"github-release://{source['actrun']['repository']}/{source['actrun']['tag']}/{source['actrun']['asset']}",
 'task':f"github-release://{source['goTask']['repository']}/{source['goTask']['tag']}/{source['goTask']['asset']}",
 'gosh':f"git://{source['gosh']['repository']}@{commit}#{source['gosh']['source']}?tree={tree}",
}
for tool in manifest['tools']:
    tool['source']=logical[tool['name']]
for row in manifest['files']:
    row['sourcePath']=None
known={row['path'] for row in manifest['files']}
for directory in (pack/'fixtures', pack/'metadata'):
    for p in sorted(directory.rglob('*')):
        if not p.is_file(): continue
        rel=p.relative_to(pack).as_posix()
        if rel not in known:
            manifest['files'].append({'path':rel,'sourcePath':None,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'executable':False})
manifest['files']=sorted(manifest['files'],key=lambda x:x['path'])
manifest['runtime']={
 'schema':'ops.taskRuntime/1',
 'target':'linux-amd64',
 'goshSourceCommit':commit,
 'goshSourceTree':tree,
 'goshBinarySha256':gosh_sha,
 'dagAuthority':'Taskfile.yml',
 'entryAuthority':'.gosh/events.jsonl generated at materialization',
}
(pack/'MANIFEST.json').write_text(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
PY
(
  cd "$pack"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum | sed 's#  \./#  #' > SHA256SUMS
)
python3 "$repo_root/packages/ops-portable-runtime-pack/bin/ops-portable-runtime-pack.py" validate --pack-dir "$pack" >/dev/null
if test "$repo_head" != "$gosh_commit"; then
  ! grep -R -F "$repo_head" "$pack"
fi

deterministic_archive() {
  local destination="$1"
  (
    cd "$pack"
    tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
      --mode='u+rwX,go+rX,go-w' -cf - . | gzip -n -9 > "$destination"
  )
}
archive_a="$work/runtime-a.tar.gz"
archive_b="$work/runtime-b.tar.gz"
deterministic_archive "$archive_a"
deterministic_archive "$archive_b"
cmp "$archive_a" "$archive_b"
archive_sha="$(sha "$archive_a")"
archive_name="ops-task-runtime.linux-amd64.$archive_sha.tar.gz"
archive="$assets/$archive_name"
mv "$archive_a" "$archive"
rm "$archive_b"
carrier_name="$archive_name.b64.txt"
carrier="$assets/$carrier_name"
base64 -w0 "$archive" > "$carrier"
test "$(base64 --decode "$carrier" | sha256sum | awk '{print $1}')" = "$archive_sha"
carrier_sha="$(sha "$carrier")"
cp "$pack/MANIFEST.json" "$assets/ops-task-runtime.$archive_sha.manifest.json"
cp "$package_dir/source.json" "$assets/ops-task-runtime.$archive_sha.source.json"

python3 - "$work/carrier-request.json" "$carrier" "$assets/ops-task-runtime.$archive_sha.manifest.json" "$assets/ops-task-runtime.$archive_sha.source.json" "$archive_sha" <<'PY'
import hashlib,json,pathlib,sys
out=pathlib.Path(sys.argv[1]); files=[pathlib.Path(x).resolve() for x in sys.argv[2:5]]; payload=sys.argv[5]
value={'schema':'carrier-job/1','request_id':'ops-task-runtime','sources':[{'name':p.name,'url':p.as_uri(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],'carrier_name':files[0].name,'payload_sha256':payload}
out.write_text(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
PY
node "$repo_root/packages/chatgpt-capability/ingress/carrier-job.mjs" materialize --request "$work/carrier-request.json" --out "$work/materialized" >/dev/null
node "$repo_root/packages/chatgpt-capability/ingress/carrier-job.mjs" verify --input "$work/materialized" --receipt "$work/carrier-job.receipt.json" >/dev/null

replay="$work/replay"
mkdir -p "$replay"
tar -xzf "$work/materialized/payload.bin" -C "$replay"
fixture="$replay/fixtures"
fixture_abs="$(realpath "$fixture")"
mkdir -p "$fixture/.gosh"
cat > "$fixture/.gosh/events.jsonl" <<JSONL
{"kind":"gosh.tool.require.v1","id":"go-task","resolver":"absolute","programAbs":"$(realpath "$replay/bin/task")"}
{"kind":"gosh.target.upsert.v1","id":"ci","targetKind":"exec","tool":"go-task","args":["--taskfile","Taskfile.yml","ci"]}
{"kind":"gosh.target.upsert.v1","id":"failure-propagation","targetKind":"exec","tool":"go-task","args":["--taskfile","Taskfile.yml","must-block"]}
JSONL
"$replay/bin/gosh" --root "$fixture_abs" run ci > "$work/direct.json"
cp "$fixture/out/proof.json" "$work/direct-proof.json"
rm -rf "$fixture/out"; rm -f "$fixture/.gosh/result.jsonl"
"$replay/bin/actrun" workflow run "$fixture/workflow.yml" --workspace-mode local --no-nix --run-root "$work/actrun-runs" >/dev/null
"$replay/bin/actrun" run view run-1 --run-root "$work/actrun-runs" --json > "$work/actrun.json"
cp "$fixture/out/proof.json" "$work/actrun-proof.json"
set +e
"$replay/bin/gosh" --root "$fixture_abs" run failure-propagation > "$work/failure.json" 2> "$work/failure.stderr"
failure_exit=$?
set -e
test "$failure_exit" -ne 0
test -f "$fixture/out/failure/root.json"
test ! -e "$fixture/out/failure/unexpected.txt"

receipt="$assets/ops-task-runtime.$archive_sha.receipt.json"
python3 - "$receipt" "$source_manifest" "$pack/MANIFEST.json" "$work/direct-proof.json" "$work/actrun-proof.json" "$work/actrun.json" "$archive" "$carrier" "$gosh_commit" "$gosh_tree" "$gosh_binary_sha" "$failure_exit" <<'PY'
import hashlib,json,pathlib,sys
out,source_path,manifest_path,direct_path,via_path,actrun_path,archive_path,carrier_path,commit,tree,gosh_sha,failure_exit=sys.argv[1:]
source=json.load(open(source_path)); direct=json.load(open(direct_path)); via=json.load(open(via_path)); actrun=json.load(open(actrun_path))
assert direct['status']==via['status']=='PASS'
assert direct['semanticSha256']==via['semanticSha256']
assert actrun['ok'] is True and actrun['state']=='completed'
value={
 'schema':'ops.taskRuntimeCarrierReceipt/1',
 'status':'PASS',
 'authority':source['authority'],
 'target':source['target'],
 'sources':source,
 'gosh':{'sourceCommit':commit,'sourceTree':tree,'binarySha256':gosh_sha,'reproducibleBuild':True},
 'closure':{
   'archive':{'name':pathlib.Path(archive_path).name,'bytes':pathlib.Path(archive_path).stat().st_size,'sha256':hashlib.sha256(pathlib.Path(archive_path).read_bytes()).hexdigest()},
   'carrier':{'name':pathlib.Path(carrier_path).name,'bytes':pathlib.Path(carrier_path).stat().st_size,'sha256':hashlib.sha256(pathlib.Path(carrier_path).read_bytes()).hexdigest(),'codec':'standard-base64'},
 },
 'behavior':{'direct':direct,'actrun':via,'semanticSha256':direct['semanticSha256'],'failureExit':int(failure_exit),'dependentStarted':False},
 'manifestSha256':hashlib.sha256(pathlib.Path(manifest_path).read_bytes()).hexdigest(),
}
pathlib.Path(out).write_text(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
PY
printf '%s\n' "$archive_sha" > "$assets/payload.sha256"
printf '%s\n' "$carrier_sha" > "$assets/carrier.sha256"
python3 - "$assets" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); rows=[]
for p in sorted(root.iterdir()):
    if p.name=='assets.receipt.json': continue
    rows.append({'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(root/'assets.receipt.json').write_text(json.dumps({'schema':'ops.taskRuntimeAssets/1','status':'PASS','assets':rows},sort_keys=True,separators=(',',':'))+'\n')
PY
printf '%s\n' "$archive_sha"
