{ pkgs, opsSha }:
let
  # The canonical apps PRODUCT (apps PR 83), pinned as reviewed DATA. The runtime holds no product bytes: a consumer
  # passes the release's zip, merged-PR proof and provenance as one operand directory, which
  # modules/input-contracts.mjs admits once against this pin. The full ACCEPTANCE closure metadata is in that
  # provenance; only its identity is pinned here. Bytes are not claimed to be reproducible across hosts.
  product = rec {
    tag = "voice-ui-dist-fa7576d300fff838d0fe09e90794f2cce0eb9dcb";
    base = "https://github.com/roccho-dev/apps/releases/download/${tag}";
    zip = { sha256 = "48196d28129aa6640b4294bfe3003387a78a3a94d6597438946f77114bbbbeb5"; bytes = 62581180; };
    proofSha256 = "18ffa5d17b00fa49329118afac74bb24bb60aac57ac2218510ce5d42dcb4c789";
    provenanceSha256 = "c95f0b45d4f59a08223d2694fa910769a89aca05309c6c6fc879d687b2134deb";
    manifestSha256 = "1fbd5682092f6873e1218b290c44dcc5b256798ac4445f2a4e5554455275e25b";
    workerSha256 = "3ff38fedd8aee00b4f1e9dc48dddb2906c53c94402d7145bae354d8bf131b2df";
    proof = {
      pr_number = 83;
      base = "proposals";
      reviewed_head = "32e90f903ebecc85e8c270f972d7f2f8858cf27e";
      r_exact_head_verdict_ref = "https://github.com/roccho-dev/apps/pull/83#pullrequestreview-5451254971";
      merge_sha = "fa7576d300fff838d0fe09e90794f2cce0eb9dcb";
      reviewed_tree = "c4ddc1dc379b94c712b7f74d57b49cc6859e8c79";
      merge_tree = "c4ddc1dc379b94c712b7f74d57b49cc6859e8c79";
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
