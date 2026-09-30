{ pkgs, opsSha }:
let
  # The deploy input is the exact published apps release, not apps source.
  # Zip and merged-PR proof are pinned by digest; the proof must match this
  # exact apps PR/review/merge before the bytes are staged. They are data only:
  # nothing from the artifact is built or executed here, and bytes are not
  # claimed to be reproducible across hosts.
  appsRelease = {
    base = "https://github.com/roccho-dev/apps/releases/download/voice-ui-dist-e5506cd0e4b08464ab96b9365aa1259ea9154dd5";
    sha256 = "18a324d6ef6a10cba695eadd691d7a0c2bf7e4d2081103972969a1b1eca33cc2";
    proofSha256 = "940c306f666595b2eec1cd18d43f837bfc6210cb2b73ebac3f9de0e6fc10d544";
    provenanceSha256 = "a67b0cfe1b5d5bf86d2fe535869197046b2b3978089cfbdd58e32d2354d0dd75";
    proof = {
      pr_number = 33;
      base = "proposals";
      reviewed_head = "c8e1e1fb2df1ceace9709c9c01ad2b38257744c2";
      r_exact_head_verdict_ref = "https://github.com/roccho-dev/apps/pull/33#pullrequestreview-5350294364";
      merge_sha = "e5506cd0e4b08464ab96b9365aa1259ea9154dd5";
      reviewed_tree = "e3de3068f8af36ddddc4e6cd95318bbb23cadbde";
      merge_tree = "e3de3068f8af36ddddc4e6cd95318bbb23cadbde";
    };
  };
  appsSha = appsRelease.proof.merge_sha;
  # The producer's provenance binds the zip bytes to the proof's merge commit.
  expectedProvenance = {
    schema = "roccho.voice-ui-dist.release-provenance/1";
    source = { repository = "roccho-dev/apps"; commit = appsSha; tree = appsRelease.proof.merge_tree; };
    artifact = { name = "voice-ui-dist.zip"; inherit (appsRelease) sha256; };
    locator = "${appsRelease.base}/voice-ui-dist.zip";
    cross_host_bytes_reproducible = false;
    producer = { repository = "roccho-dev/apps"; workflow_ref = "roccho-dev/apps/.github/workflows/voice-ui-release.yml@refs/heads/proposals"; };
  };
  fetch = name: sha256: pkgs.fetchurl { url = "${appsRelease.base}/${name}"; inherit sha256; };
  release = {
    proof = fetch "merged-pr-proof.json" appsRelease.proofSha256;
    provenance = fetch "provenance.json" appsRelease.provenanceSha256;
    zip = fetch "voice-ui-dist.zip" appsRelease.sha256;
    expectedProof = builtins.toJSON appsRelease.proof;
    expectedProvenance = builtins.toJSON expectedProvenance;
  };
  # Fails closed unless proof, provenance and zip bytes all name one release.
  checkRelease = pkgs.writeText "check-voice-ui-release.py" ''
    import hashlib, json, os
    proof = json.load(open(os.environ["proof"]))
    provenance = json.load(open(os.environ["provenance"]))
    expected = json.loads(os.environ["expectedProof"])
    wanted = json.loads(os.environ["expectedProvenance"])
    assert set(proof) == set(expected) | {"merged_at"}, sorted(proof)
    assert all(proof[k] == v for k, v in expected.items()), proof
    assert proof["reviewed_tree"] == proof["merge_tree"] and proof["merged_at"], proof
    for key in ("schema", "source", "locator", "cross_host_bytes_reproducible"):
        assert provenance.get(key) == wanted[key], (key, provenance.get(key))
    for key in ("producer", "artifact"):
        assert all(provenance[key].get(k) == v for k, v in wanted[key].items()), (key, provenance[key])
    zip_bytes = open(os.environ["zip"], "rb").read()
    assert provenance["artifact"]["sha256"] == hashlib.sha256(zip_bytes).hexdigest(), "zip digest differs from provenance"
    assert provenance["artifact"]["bytes"] == len(zip_bytes), "zip size differs from provenance"
    assert provenance["source"]["commit"] == proof["merge_sha"] and provenance["source"]["tree"] == proof["merge_tree"], "provenance source differs from proof"
  '';
  # The pinned cf CLI for the coming Workers adapter. Checkpoint only: the runtime below still deploys through the
  # existing Pages adapter until the cf path is proven; cf is exercised offline by tests/workers.test.mjs.
  cf = import ./cf.nix { inherit pkgs; };
  artifact = pkgs.runCommand "voice-ui-dist-release" ({
    nativeBuildInputs = [ pkgs.python3 pkgs.unzip ];
  } // release) ''
    python3 ${checkRelease}
    unzip -q "$zip" -d unpacked
    test "$(ls -A unpacked)" = voice-ui-dist
    cp -R unpacked/voice-ui-dist "$out"
  '';
  config = {
    inherit opsSha appsSha;
    artifactRoot = "${artifact}";
    appsRelease = {
      locator = "${appsRelease.base}/voice-ui-dist.zip";
      inherit (appsRelease) sha256;
      proof_sha256 = appsRelease.proofSha256;
      provenance_sha256 = appsRelease.provenanceSha256;
    };
  };
  runtime = pkgs.runCommand "voice-ui-target-runtime" {
    nativeBuildInputs = [ pkgs.makeWrapper pkgs.nodejs ];
  } ''
    root="$out/share/voice-ui-target-runtime"
    mkdir -p "$root/modules" "$out/bin"
    cp ${./lib.mjs} "$root/lib.mjs"
    cp ${./pages.mjs} "$root/pages.mjs"
    cp ${./entry.mjs} "$root/entry.mjs"
    cp ${./capture-isolation.mjs} "$root/capture-isolation.mjs"
    cp ${./modules}/*.mjs "$root/modules/"
    printf '%s' '${builtins.toJSON config}' > "$root/configuration.json"
    node - "$root/configuration.json" ${artifact}/manifest.json <<'JS'
    const fs=require('fs'),crypto=require('crypto');
    const [file,manifest]=process.argv.slice(2),config=JSON.parse(fs.readFileSync(file));
    config.artifactManifestSha256=crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex');
    fs.writeFileSync(file,JSON.stringify(config));
    JS
    cat > "$root/deploy.mjs" <<'JS'
    import { adapterMain } from './pages.mjs';
    try { await adapterMain('deploy', '${pkgs.wrangler}/bin/wrangler'); }
    catch(error) { console.error(error.message); process.exitCode=1; }
    JS
    cat > "$root/readback.mjs" <<'JS'
    import { adapterMain } from './pages.mjs';
    try { await adapterMain('readback'); }
    catch(error) { console.error(error.message); process.exitCode=1; }
    JS
    cat > "$root/main.mjs" <<'JS'
    import fs from 'node:fs';
    import { fileURLToPath } from 'node:url';
    import { main } from './entry.mjs';
    try { main(JSON.parse(fs.readFileSync(new URL('./configuration.json',import.meta.url))), fileURLToPath(new URL('.',import.meta.url))); }
    catch(error) { console.error(error.message); process.exitCode=1; }
    JS
    makeWrapper ${pkgs.nodejs}/bin/node "$out/bin/voice-ui-target-runtime" \
      --add-flags "$root/main.mjs" \
      --set PATH ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.git pkgs.coreutils ]}
    makeWrapper ${pkgs.nodejs}/bin/node "$out/bin/voice-ui-isolation-capture" \
      --add-flags "$root/capture-isolation.mjs" \
      --set PATH ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.git pkgs.yq-go ]}
  '';
in runtime // {
  boundaryCheck = pkgs.runCommand "voice-ui-target-runtime-boundary" ({
    nativeBuildInputs = [ pkgs.nodejs pkgs.git pkgs.python3 ];
  } // release) ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    # The release check must reject provenance naming another source or zip.
    python3 ${checkRelease}
    for mutation in 'p["source"]["commit"]="0"*40' 'p["artifact"]["sha256"]="0"*64'; do
      python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); exec(sys.argv[2]); json.dump(p,open("mutated.json","w"))' "$provenance" "$mutation"
      if provenance=mutated.json python3 ${checkRelease} 2>/dev/null; then
        echo "release check accepted mutated provenance: $mutation" >&2; exit 1
      fi
    done
    ${runtime}/bin/voice-ui-target-runtime --describe > runtime.json
    ${pkgs.wrangler}/bin/wrangler --version
    node ${./.}/tests/run.test.mjs
    node ${./.}/tests/pages.test.mjs
    node ${./tests/boundary.mjs} ${runtime} ${artifact} ${pkgs.wrangler}/bin/wrangler
    # cf checkpoint. --require-isolation fails the check unless the kernel shows a loopback-only network namespace
    # (only lo, and a TEST-NET-1 connect fails with ENETUNREACH), so a passing check means no request could leave
    # loopback. An unsandboxed build therefore fails here; run tests/workers.test.mjs directly for an UNISOLATED grade.
    ${cf}/bin/cf --version
    node ${./tests/workers.test.mjs} ${cf}/bin/cf ${cf.nodeModules}/node_modules ${artifact} --require-isolation > cf-checkpoint.json
    mkdir -p "$out"
    cp runtime.json cf-checkpoint.json "$out/"
    printf 'CI_BOUNDARY_PASS\nCF_CHECKPOINT_OFFLINE_PASS_ISOLATED\nLIVE_PROVIDER_NOT_RUN\n' > "$out/status"
  '';
}
