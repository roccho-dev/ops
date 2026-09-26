#!/usr/bin/env bash
set -euo pipefail

revision="1a793eb568e6718f15941d08f85432581df534e3"
base="https://huggingface.co/convaiinnovations/laya-typed-decisions/resolve/$revision"
root="$RUNNER_TEMP/laya-typed-decisions"
src="$root/src"
chunks="$root/chunks"
mkdir -p "$src/encoder" "$src/tokenizer" "$chunks"

get() {
  local rel="$1"
  mkdir -p "$(dirname "$src/$rel")"
  curl --fail --location --retry 8 --retry-all-errors --retry-delay 1     "$base/$rel?download=true" -o "$src/$rel"
}

get model.safetensors
get rl_agent_config.json
get encoder/config.json
get tokenizer/tokenizer.json
get tokenizer/tokenizer_config.json

printf '%s  %s\n'   "4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e"   "$src/model.safetensors" | sha256sum --check -

bundle="$root/laya-typed-decisions-$revision.tar.gz"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner   -C "$src" -czf "$bundle"   encoder model.safetensors rl_agent_config.json tokenizer

split -b 240M -d -a 2 "$bundle" "$chunks/part."

python3 - "$bundle" "$chunks" <<'PY'
import hashlib,json,pathlib,sys
bundle,chunks=map(pathlib.Path,sys.argv[1:])
def info(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda:f.read(8*1024*1024),b""): h.update(b)
    return {"name":p.name,"bytes":p.stat().st_size,"sha256":h.hexdigest()}
m={
 "schema":"ops.layaTypedBridge/1",
 "revision":"1a793eb568e6718f15941d08f85432581df534e3",
 "modelSha256":"4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e",
 "bundle":info(bundle),
 "parts":[info(p) for p in sorted(chunks.glob("part.*"))],
}
(chunks/"manifest.json").write_text(json.dumps(m,indent=2,sort_keys=True)+"\n",encoding="utf-8")
print(json.dumps(m,sort_keys=True))
PY
