#!/usr/bin/env bash
set -euo pipefail
receipt="$1"
candidate_sha="$2"
source_digest="$3"
remote="https://x-access-token:$GH_TOKEN@github.com/$GITHUB_REPOSITORY.git"
work="$RUNNER_TEMP/accepted-url-only-runtime"
ref=refs/heads/accepted/mobile-agent-business-model-public-url
git init --quiet "$work"
git -C "$work" config user.name github-actions[bot]
git -C "$work" config user.email 41898282+github-actions[bot]@users.noreply.github.com
git -C "$work" remote add origin "$remote"
old="$(git ls-remote "$remote" "$ref" | awk 'NR==1 {print $1}')"
if [ -n "$old" ]; then
  git -C "$work" fetch --quiet --depth=1 origin "$ref"
  git -C "$work" checkout --quiet -b accepted FETCH_HEAD
  git -C "$work" rm -rf . >/dev/null 2>&1 || true
else
  git -C "$work" checkout --quiet --orphan accepted
fi
mkdir -p "$work/accepted"
cp "$receipt" "$work/accepted/public-url-receipt.json"
python3 - "$work/accepted/provenance.json" "$candidate_sha" "$source_digest" <<'PY'
import json,os,pathlib,sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
  "schema":"ops.mobileAgentUrlOnlyRuntimeAcceptedProvenance/2",
  "authority":False,
  "candidateSha":sys.argv[2],
  "producerRunId":int(os.environ["GITHUB_RUN_ID"]),
  "producerArtifactDigest":sys.argv[3],
},sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
PY
git -C "$work" add accepted
git -C "$work" commit --quiet -m "accept: business-model/1 URL generation and rendering for $candidate_sha"
git -C "$work" push --quiet origin HEAD:"$ref"
