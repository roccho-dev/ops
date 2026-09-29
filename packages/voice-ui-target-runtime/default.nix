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
  fetch = name: sha256: pkgs.fetchurl { url = "${appsRelease.base}/${name}"; inherit sha256; };
  artifact = pkgs.runCommand "voice-ui-dist-release" {
    nativeBuildInputs = [ pkgs.python3 pkgs.unzip ];
    expected = builtins.toJSON appsRelease.proof;
    proof = fetch "merged-pr-proof.json" appsRelease.proofSha256;
    zip = fetch "voice-ui-dist.zip" appsRelease.sha256;
  } ''
    python3 - <<'PY'
    import json, os
    proof = json.load(open(os.environ["proof"]))
    expected = json.loads(os.environ["expected"])
    assert set(proof) == set(expected) | {"merged_at"}, sorted(proof)
    assert all(proof[k] == v for k, v in expected.items()), proof
    assert proof["reviewed_tree"] == proof["merge_tree"] and proof["merged_at"], proof
    PY
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
  boundaryCheck = pkgs.runCommand "voice-ui-target-runtime-boundary" {
    nativeBuildInputs = [ pkgs.nodejs pkgs.git ];
  } ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    ${runtime}/bin/voice-ui-target-runtime --describe > runtime.json
    ${pkgs.wrangler}/bin/wrangler --version
    node ${./.}/tests/run.test.mjs
    node ${./.}/tests/pages.test.mjs
    node ${./tests/boundary.mjs} ${runtime} ${artifact} ${pkgs.wrangler}/bin/wrangler
    mkdir -p "$out"
    cp runtime.json "$out/"
    printf 'CI_BOUNDARY_PASS\nLIVE_PROVIDER_NOT_RUN\n' > "$out/status"
  '';
}
