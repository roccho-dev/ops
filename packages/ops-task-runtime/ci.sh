#!/usr/bin/env bash
set -euo pipefail

repo_root="${OPS_TASK_RUNTIME_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
out="${OPS_TASK_RUNTIME_OUT:-${RUNNER_TEMP:-/tmp}/ops-task-runtime}"
work="$out/work"
assets="$out/assets"
download="$work/download"
upstream="$work/upstream"
pack="$work/pack"
sources="$work/sources"
materialized="$work/materialized"
runtime="$assets/runtime"
proof="$assets/proof"

rm -rf "$out"
mkdir -p "$download" "$upstream" "$sources" "$assets" "$proof"

sha() { sha256sum "$1" | awk '{print $1}'; }
bytes() { stat -c %s "$1"; }

version='4.12.0'
tag="cedar-policy-cli-v$version"
asset='cedar-policy-cli-x86_64-unknown-linux-gnu.tar.xz'
asset_sha='fc29b830bca41763c7cbb6ce66d1a14040fc2d077318479512c6a83052b70851'
checksum_asset="$asset.sha256"
checksum_asset_sha='9b8737441cebde53acd9d7f3cf1557905ede3f2a39c7678d97de3f66cef939cd'
base="https://github.com/cedar-policy/cedar/releases/download/$tag"

curl --fail --location --retry 8 --retry-all-errors --retry-delay 1 \
  --silent --show-error "$base/$asset" -o "$download/$asset"
test "$(sha "$download/$asset")" = "$asset_sha"

curl --fail --location --retry 8 --retry-all-errors --retry-delay 1 \
  --silent --show-error "$base/$checksum_asset" -o "$download/$checksum_asset"
test "$(sha "$download/$checksum_asset")" = "$checksum_asset_sha"
grep -F "$asset_sha" "$download/$checksum_asset" >/dev/null
grep -F "$asset" "$download/$checksum_asset" >/dev/null

python3 - "$download/$asset" "$upstream" <<'PY'
import pathlib, sys, tarfile
archive, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with tarfile.open(archive, 'r:xz') as tf:
    members = tf.getmembers()
    assert members
    for member in members:
        p = pathlib.PurePosixPath(member.name)
        assert not p.is_absolute() and '..' not in p.parts
        assert not member.issym() and not member.islnk()
        assert member.isdir() or member.isfile()
    tf.extractall(dest)
PY

mapfile -t cedar_bins < <(find "$upstream" -type f -name cedar -print)
test "${#cedar_bins[@]}" -eq 1
cedar_bin="${cedar_bins[0]}"
chmod 0755 "$cedar_bin"
file "$cedar_bin" | grep -F 'ELF 64-bit' >/dev/null
"$cedar_bin" --help > "$proof/upstream-help.txt"

mapfile -t license_files < <(find "$upstream" -type f \( -name LICENSE -o -name NOTICE \) -print | sort)
test "${#license_files[@]}" -ge 1

python3 - "$work/tool.json" "$cedar_bin" "${license_files[@]}" <<'PY'
import json, pathlib, sys
out, binary, *licenses = sys.argv[1:]
files = []
seen = set()
for source in licenses:
    name = pathlib.Path(source).name
    if name in seen:
        continue
    seen.add(name)
    files.append({'source': source, 'path': f'share/licenses/cedar/{name}'})
value = {'tools': [{'name': 'cedar', 'source': binary, 'smoke': ['--help'], 'files': files}]}
pathlib.Path(out).write_text(json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
PY

python3 "$repo_root/packages/ops-portable-runtime-pack/bin/ops-portable-runtime-pack.py" create \
  --target-system x86_64-linux --tool-spec "$work/tool.json" --out-dir "$pack" >/dev/null
python3 - "$pack/MANIFEST.json" "$version" "$tag" "$asset" "$asset_sha" <<'PY'
import json, pathlib, sys
path, version, tag, asset, asset_sha = sys.argv[1:]
p = pathlib.Path(path)
x = json.loads(p.read_text(encoding='utf-8'))
x['createdAt'] = '1970-01-01T00:00:00Z'
x['toolSpec'] = {'path': 'embedded', 'sha256': x['toolSpec']['sha256']}
for tool in x['tools']:
    tool['source'] = f'github-release://cedar-policy/cedar/{tag}/{asset}#sha256={asset_sha}'
for row in x['files']:
    row['sourcePath'] = None
x['source'] = {
    'repository': 'cedar-policy/cedar',
    'releaseTag': tag,
    'version': version,
    'target': 'x86_64-unknown-linux-gnu',
    'archive': {'name': asset, 'sha256': asset_sha},
}
p.write_text(json.dumps(x, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
PY
python3 "$repo_root/packages/ops-portable-runtime-pack/bin/ops-portable-runtime-pack.py" validate \
  --pack-dir "$pack" >/dev/null
"$pack/bin/cedar" --help > "$proof/packed-help.txt"
cmp "$proof/upstream-help.txt" "$proof/packed-help.txt"

payload="$work/cedar-policy-cli-v$version-linux-amd64.runtime.tar.gz"
(
  cd "$pack"
  tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
    --mode='u=rwX,go=rX,go-s' -cf - . | gzip -n -9 > "$payload"
)
payload_sha="$(sha "$payload")"
carrier="carrier.native.linux-amd64.$payload_sha.b64.txt"
base64 -w0 "$payload" > "$sources/$carrier"
carrier_sha="$(sha "$sources/$carrier")"
base64 --decode "$sources/$carrier" | cmp - "$payload"

python3 - "$sources/cedar.source.json" "$version" "$tag" "$asset" "$asset_sha" \
  "$checksum_asset" "$checksum_asset_sha" "$(git -C "$repo_root" rev-parse HEAD)" <<'PY'
import json, pathlib, sys
out, version, tag, asset, asset_sha, checksum, checksum_sha, ops_commit = sys.argv[1:]
value = {
    'schema': 'cedar-cli-source/1',
    'repository': 'cedar-policy/cedar',
    'releaseTag': tag,
    'version': version,
    'target': 'x86_64-unknown-linux-gnu',
    'asset': {
        'name': asset,
        'sha256': asset_sha,
        'url': f'https://github.com/cedar-policy/cedar/releases/download/{tag}/{asset}',
    },
    'checksumAsset': {
        'name': checksum,
        'sha256': checksum_sha,
        'url': f'https://github.com/cedar-policy/cedar/releases/download/{tag}/{checksum}',
    },
    'carrierImplementation': {
        'repository': 'roccho-dev/ops',
        'commit': ops_commit,
        'pack': 'packages/ops-portable-runtime-pack',
        'materializer': 'packages/chatgpt-capability/ingress/carrier-job.mjs',
    },
}
pathlib.Path(out).write_text(json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
PY

source_sha="$(sha "$sources/cedar.source.json")"
python3 - "$work/request.json" "$sources/$carrier" "$carrier_sha" \
  "$sources/cedar.source.json" "$source_sha" "$carrier" "$payload_sha" <<'PY'
import json, pathlib, sys
out, carrier_path, carrier_sha, source_path, source_sha, carrier_name, payload_sha = sys.argv[1:]
value = {
    'schema': 'carrier-job/1',
    'request_id': 'cedar-policy-cli-v4.12.0-linux-amd64',
    'sources': [
        {'name': carrier_name, 'url': pathlib.Path(carrier_path).resolve().as_uri(), 'sha256': carrier_sha},
        {'name': 'cedar.source.json', 'url': pathlib.Path(source_path).resolve().as_uri(), 'sha256': source_sha},
    ],
    'carrier_name': carrier_name,
    'payload_sha256': payload_sha,
}
pathlib.Path(out).write_text(json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
PY

node "$repo_root/packages/chatgpt-capability/ingress/carrier-job.mjs" materialize \
  --request "$work/request.json" --out "$materialized" --source-dir "$sources" >/dev/null
node "$repo_root/packages/chatgpt-capability/ingress/carrier-job.mjs" verify \
  --input "$materialized" --receipt "$proof/carrier-job.receipt.json" >/dev/null
cmp "$materialized/receipt.json" "$proof/carrier-job.receipt.json"

mkdir -p "$runtime"
python3 - "$materialized/payload.bin" "$runtime" <<'PY'
import pathlib, sys, tarfile
archive, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with tarfile.open(archive, 'r:gz') as tf:
    members = tf.getmembers()
    assert members
    for member in members:
        p = pathlib.PurePosixPath(member.name)
        assert not p.is_absolute() and '..' not in p.parts
        assert not member.issym() and not member.islnk()
        assert member.isdir() or member.isfile()
    tf.extractall(dest)
PY
python3 "$repo_root/packages/ops-portable-runtime-pack/bin/ops-portable-runtime-pack.py" validate \
  --pack-dir "$runtime" >/dev/null
"$runtime/bin/cedar" --help > "$proof/materialized-help.txt"
cmp "$proof/packed-help.txt" "$proof/materialized-help.txt"

cat > "$proof/policy.cedar" <<'CEDAR'
permit (
    principal == User::"alice",
    action == Action::"view",
    resource == File::"93"
);
CEDAR
printf '[]\n' > "$proof/entities.json"
"$runtime/bin/cedar" authorize \
  --policies "$proof/policy.cedar" --entities "$proof/entities.json" \
  --principal 'User::"alice"' --action 'Action::"view"' --resource 'File::"93"' \
  > "$proof/allow.txt"
grep -Fx 'ALLOW' "$proof/allow.txt" >/dev/null
"$runtime/bin/cedar" authorize \
  --policies "$proof/policy.cedar" --entities "$proof/entities.json" \
  --principal 'User::"bob"' --action 'Action::"view"' --resource 'File::"93"' \
  > "$proof/deny.txt"
grep -Fx 'DENY' "$proof/deny.txt" >/dev/null

binary_sha="$(sha "$runtime/bin/cedar.real")"
binary_bytes="$(bytes "$runtime/bin/cedar.real")"
cp "$sources/$carrier" "$assets/$carrier"
cp "$sources/cedar.source.json" "$assets/cedar.source.json"
cp "$work/request.json" "$assets/carrier.request.json"
cp "$materialized/receipt.json" "$assets/carrier.receipt.json"

python3 - "$proof/proof.json" "$version" "$asset_sha" "$payload_sha" "$carrier" \
  "$carrier_sha" "$binary_sha" "$binary_bytes" "$(git -C "$repo_root" rev-parse HEAD)" <<'PY'
import hashlib, json, pathlib, sys
out, version, asset_sha, payload_sha, carrier, carrier_sha, binary_sha, binary_bytes, ops_commit = sys.argv[1:]
root = pathlib.Path(out).parent
sha = lambda name: hashlib.sha256((root/name).read_bytes()).hexdigest()
value = {
    'schema': 'cedar-cli-carry-proof/1',
    'status': 'PASS',
    'version': version,
    'target': 'x86_64-linux',
    'upstreamArchiveSha256': asset_sha,
    'payloadSha256': payload_sha,
    'carrier': {'name': carrier, 'sha256': carrier_sha},
    'binary': {'path': 'runtime/bin/cedar.real', 'sha256': binary_sha, 'bytes': int(binary_bytes)},
    'execution': {
        'upstreamHelp': 'PASS',
        'packedHelp': 'PASS',
        'materializedHelp': 'PASS',
        'authorizeAllow': 'ALLOW',
        'authorizeDeny': 'DENY',
        'allowOutputSha256': sha('allow.txt'),
        'denyOutputSha256': sha('deny.txt'),
    },
    'opsCommit': ops_commit,
}
pathlib.Path(out).write_text(json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
PY

rm -rf "$work"
