{ pkgs, opsSha }:
let
  # The canonical apps PRODUCT (apps PR 74), pinned as reviewed DATA. The runtime holds no product bytes: a consumer
  # passes the release's zip, merged-PR proof and provenance as one operand directory, which
  # modules/input-contracts.mjs admits once against this pin. The full ACCEPTANCE closure metadata is in that
  # provenance; only its identity is pinned here. Bytes are not claimed to be reproducible across hosts.
  product = rec {
    tag = "voice-ui-dist-7fba0eaacd8ee3132b5bff89546fa07f35803733";
    base = "https://github.com/roccho-dev/apps/releases/download/${tag}";
    zip = { sha256 = "f69744ee8c003526a81891e9a9639c705bd5d3decc3aa8dceae0e1eb485b123f"; bytes = 62571846; };
    proofSha256 = "20ebf30dd7c9544f26e7f6534b046b377ded58db5036d5b97a967c45e2d7908a";
    provenanceSha256 = "13882942c57aa1486904745d046b09a61ab2eb3d44be5f5eef9ba2862752bba4";
    manifestSha256 = "5088f318d86ae5a6569eaf52ca08d85bfef25ae6bac5e1a5eee48fee1aaba0da";
    workerSha256 = "f481ab976bac6a0121b1fdad9a5110b970749cb8a7a048decfba1dd983a33492";
    proof = {
      pr_number = 74;
      base = "proposals";
      reviewed_head = "94683cebfa54c6e8583cb9b3630f0cf4d702ff8f";
      r_exact_head_verdict_ref = "https://github.com/roccho-dev/apps/pull/74#pullrequestreview-5443492415";
      merge_sha = "7fba0eaacd8ee3132b5bff89546fa07f35803733";
      reviewed_tree = "1d3fb2042d62112822ca693951813630066b3722";
      merge_tree = "1d3fb2042d62112822ca693951813630066b3722";
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
