{ pkgs, opsSha }:
let
  # The canonical apps PRODUCT (apps PR 77), pinned as reviewed DATA. The runtime holds no product bytes: a consumer
  # passes the release's zip, merged-PR proof and provenance as one operand directory, which
  # modules/input-contracts.mjs admits once against this pin. The full ACCEPTANCE closure metadata is in that
  # provenance; only its identity is pinned here. Bytes are not claimed to be reproducible across hosts.
  product = rec {
    tag = "voice-ui-dist-e044583c32cf0bc00c26ad8d46961a664b4f652e";
    base = "https://github.com/roccho-dev/apps/releases/download/${tag}";
    zip = { sha256 = "b157817ffc5755fbff46c0cf42cfa991e18ef4e0eb303e877716670ec6666f94"; bytes = 62574657; };
    proofSha256 = "a19695b54cfd1ca929e4fc79cea34673b4bba9b21db601018dcda01bed89cfaa";
    provenanceSha256 = "772d0d85e4977bdb4c343d182f02d7728ce5bef37daf88b9466c22891c3249cf";
    manifestSha256 = "327f94b0c8f7db22f00905b5895c5bab70e4f92a6ecc5a039e470ff17a624851";
    workerSha256 = "34fd8aafe0dd8b414c9c4667f980fba844898dfcdd48eb2c80da512f45cad9dc";
    proof = {
      pr_number = 77;
      base = "proposals";
      reviewed_head = "b994d674dbd57079befbea4216b7155bd01fc7a6";
      r_exact_head_verdict_ref = "https://github.com/roccho-dev/apps/pull/77#pullrequestreview-5448700267";
      merge_sha = "e044583c32cf0bc00c26ad8d46961a664b4f652e";
      reviewed_tree = "1364d1b08fc1fb3f68c66fa2a46f74ce2b91bff6";
      merge_tree = "1364d1b08fc1fb3f68c66fa2a46f74ce2b91bff6";
    };
    acceptance = {
      sha256 = "3f7c6fdc7639078aacd9bee8e76acacddbb02a10d05602f9629192223e1c0d08";
      bytes = 916072320;
      paths = 177;
      root = "/nix/store/p9fkgkchzjcqp9n6ry40r7mq43xj7v2v-voice-ui-acceptance-node";
      entry = "bin/voice-ui-acceptance-node";
    };
  };
  # Check input only (never in the runtime closure): the same release files a consumer downloads.
  fetch = name: sha256: pkgs.fetchurl { url = "${product.base}/${name}"; inherit sha256; };
  productRelease = {
    zip = fetch "voice-ui-dist.zip" product.zip.sha256;
    proof = fetch "merged-pr-proof.json" product.proofSha256;
    provenance = fetch "provenance.json" product.provenanceSha256;
  };
  # The pinned cf CLI; the Workers adapter deploys with `cf deploy --prebuilt`.
  cf = import ./cf.nix { inherit pkgs; };
  config = {
    inherit opsSha product;
    unzip = "${pkgs.unzip}/bin/unzip";
    cf = "${cf}/bin/cf";
    buildOutputUtils = "${cf.nodeModules}/node_modules";
  };
  runtime = pkgs.runCommand "voice-ui-target-runtime" {
    nativeBuildInputs = [ pkgs.makeWrapper pkgs.nodejs ];
  } ''
    root="$out/share/voice-ui-target-runtime"
    mkdir -p "$root/modules" "$root/tests/fixtures" "$out/bin"
    cp ${./lib.mjs} "$root/lib.mjs"
    cp ${./workers.mjs} "$root/workers.mjs"
    cp ${./entry.mjs} "$root/entry.mjs"
    cp ${./capture-isolation.mjs} "$root/capture-isolation.mjs"
    cp ${./modules}/*.mjs "$root/modules/"
    # The gate program: exactly tests/workers.test.mjs, installed as its own entry. Ordinary entries never run it.
    cp ${./tests/workers.test.mjs} "$root/tests/workers.test.mjs"
    cp ${./tests/fixtures/envs-projection.json} "$root/tests/fixtures/envs-projection.json"
    printf '%s' '${builtins.toJSON config}' > "$root/configuration.json"
    node - "$root/configuration.json" "$out" <<'JS'
    const fs=require('fs'),crypto=require('crypto'),path=require('path');
    const [file,out]=process.argv.slice(2),config=JSON.parse(fs.readFileSync(file));
    const program=path.join(out,'share/voice-ui-target-runtime/tests/workers.test.mjs');
    config.gate={entry:path.join(out,'bin/voice-ui-target-runtime-gate'),program,
      programSha256:crypto.createHash('sha256').update(fs.readFileSync(program)).digest('hex')};
    fs.writeFileSync(file,JSON.stringify(config));
    JS
    cat > "$root/deploy.mjs" <<'JS'
    import fs from 'node:fs';
    import { adapterMain } from './workers.mjs';
    const { cf, buildOutputUtils } = JSON.parse(fs.readFileSync(new URL('./configuration.json', import.meta.url)));
    try { await adapterMain('deploy', { cf, buildOutputUtils }); }
    catch(error) { console.error(error.message); process.exitCode=1; }
    JS
    cat > "$root/readback.mjs" <<'JS'
    import { adapterMain } from './workers.mjs';
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
      --set PATH ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.coreutils ]}
    # gitMinimal: the capture helper needs only git plumbing, and full git would add Python to the closure.
    makeWrapper ${pkgs.nodejs}/bin/node "$out/bin/voice-ui-isolation-capture" \
      --add-flags "$root/capture-isolation.mjs" \
      --set PATH ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.gitMinimal pkgs.yq-go ]}
    # The fresh-consumer gate entry. Run through sudo: it enters a new network namespace with only lo, then drops to
    # the invoking user before any test, adapter or acceptance code runs, and requires the kernel isolation evidence.
    cat > "$out/bin/voice-ui-target-runtime-gate" <<'SH'
    #!@bash@
    set -eo pipefail
    if [ "$(@coreutils@/bin/id -u)" != 0 ] || [ -z "$SUDO_UID" ] || [ "$SUDO_UID" = 0 ]; then
      echo "usage: sudo voice-ui-target-runtime-gate --product <dir> [--acceptance-node <bin>]" >&2; exit 2
    fi
    exec @utillinux@/bin/unshare --net -- @bash@ -c '@iproute2@/bin/ip link set lo up && exec @utillinux@/bin/setpriv --reuid="$SUDO_UID" --regid="$SUDO_GID" --clear-groups -- @node@ @program@ --runtime @out@ "$@" --require-isolation' gate "$@"
    SH
    substituteInPlace "$out/bin/voice-ui-target-runtime-gate" \
      --replace-fail @bash@ ${pkgs.bash}/bin/bash --replace-fail @coreutils@ ${pkgs.coreutils} \
      --replace-fail @utillinux@ ${pkgs.util-linux} --replace-fail @iproute2@ ${pkgs.iproute2} \
      --replace-fail @node@ ${pkgs.nodejs}/bin/node --replace-fail @program@ "$root/tests/workers.test.mjs" --replace-fail @out@ "$out"
    chmod +x "$out/bin/voice-ui-target-runtime-gate"
  '';
in runtime // {
  boundaryCheck = pkgs.runCommand "voice-ui-target-runtime-boundary" {
    nativeBuildInputs = [ pkgs.nodejs pkgs.git ];
  } ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME" product
    cp ${productRelease.zip} product/voice-ui-dist.zip
    cp ${productRelease.proof} product/merged-pr-proof.json
    cp ${productRelease.provenance} product/provenance.json
    # Store copies are read-only; the tests mutate their own copies of these files.
    chmod 0644 product/*
    ${runtime}/bin/voice-ui-target-runtime --describe > runtime.json
    ${cf}/bin/cf --version
    # DEPLOY holds no PRODUCT or ACCEPTANCE bytes and none of the retired or credential tools.
    if grep -E -- '-(voice-ui-dist|voice-ui-acceptance|wrangler|python3|sops|age|envs)[-.]' ${pkgs.closureInfo { rootPaths = [ runtime ]; }}/store-paths; then
      echo "forbidden path in the DEPLOY closure" >&2; exit 1
    fi
    VOICE_UI_RUNTIME=${runtime} VOICE_UI_PRODUCT="$PWD/product" node ${./.}/tests/run.test.mjs
    # The installed gate program, as the gate runs it but without acceptance (its closure cannot be imported inside a
    # build). --require-isolation fails unless the kernel shows a loopback-only network namespace (only lo, and a
    # TEST-NET-1 connect fails with ENETUNREACH), so a passing check means no request could leave loopback.
    node ${runtime}/share/voice-ui-target-runtime/tests/workers.test.mjs --runtime ${runtime} --product "$PWD/product" --require-isolation > cf-checkpoint.json
    mkdir -p "$out"
    cp runtime.json cf-checkpoint.json "$out/"
    printf 'CI_BOUNDARY_PASS\nCF_CHECKPOINT_OFFLINE_PASS_ISOLATED\nINSTALLED_ADAPTER_LOOPBACK_HARNESS\nLIVE_PROVIDER_NOT_RUN\n' > "$out/status"
  '';
}
