#!/usr/bin/env bash
set -euo pipefail

bridge="$RUNNER_TEMP/model-carry-bridge"
laya_src="$RUNNER_TEMP/laya-source"
laya_bundle_src="$RUNNER_TEMP/laya-bundle-source"
laya_out="$RUNNER_TEMP/laya-carried"
laya_req="$RUNNER_TEMP/laya.request.json"
revision="052592a15d198d9ad47da779604259b10b47b7aa"
base="https://huggingface.co/convaiinnovations/laya-multilingual/resolve/$revision"

mkdir -p "$bridge/qwen" "$bridge/laya" "$laya_src/encoder" "$laya_src/tokenizer" "$laya_bundle_src"

cp "$RUNNER_TEMP/qwen3.5-0.8b-q4_0/files/Qwen3.5-0.8B-Q4_0.gguf" "$bridge/qwen/"
cp "$RUNNER_TEMP/qwen3.5-0.8b-q4_0/request.json" "$bridge/qwen/"
cp "$RUNNER_TEMP/qwen3.5-0.8b-q4_0/receipt.json" "$bridge/qwen/"

curl --fail --location --retry 8 --retry-all-errors --retry-delay 1   "$base/model.safetensors?download=true" -o "$laya_src/model.safetensors"
curl --fail --location --retry 8 --retry-all-errors --retry-delay 1   "$base/rl_agent_config.json?download=true" -o "$laya_src/rl_agent_config.json"
curl --fail --location --retry 8 --retry-all-errors --retry-delay 1   "$base/encoder/config.json?download=true" -o "$laya_src/encoder/config.json"
curl --fail --location --retry 8 --retry-all-errors --retry-delay 1   "$base/tokenizer/tokenizer.json?download=true" -o "$laya_src/tokenizer/tokenizer.json"
curl --fail --location --retry 8 --retry-all-errors --retry-delay 1   "$base/tokenizer/tokenizer_config.json?download=true" -o "$laya_src/tokenizer/tokenizer_config.json"

printf '%s  %s\n'   "9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204"   "$laya_src/model.safetensors" | sha256sum --check -

bundle="$laya_bundle_src/laya-multilingual-$revision.tar.gz"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner   -C "$laya_src" -czf "$bundle"   encoder model.safetensors rl_agent_config.json tokenizer

python3 - "$bundle" "$laya_req" "$revision" <<'PY'
import hashlib, json, pathlib, sys
bundle, request, revision = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
h = hashlib.sha256()
with bundle.open("rb") as f:
    for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
        h.update(chunk)
row = {
    "name": bundle.name,
    "url": bundle.resolve().as_uri(),
    "bytes": bundle.stat().st_size,
    "sha256": h.hexdigest(),
}
value = {
    "schema": "carrier-job/2",
    "request_id": "laya-multilingual-" + revision[:12],
    "sources": [row],
    "payload": {"source": row["name"], "codec": "raw"},
}
request.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
PY

node packages/chatgpt-capability/ingress/carrier-job.mjs materialize   --request "$laya_req" --out "$laya_out"
rm -rf "$laya_src" "$laya_bundle_src"
node packages/chatgpt-capability/ingress/carrier-job.mjs verify   --input "$laya_out" --receipt "$RUNNER_TEMP/laya.verify.json"

cp "$laya_out/files/"*.tar.gz "$bridge/laya/"
cp "$laya_out/request.json" "$bridge/laya/"
cp "$laya_out/receipt.json" "$bridge/laya/"
cp "$RUNNER_TEMP/laya.verify.json" "$bridge/laya/verify.json"
