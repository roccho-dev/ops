{ pkgs, opsSha }:
let
  # The canonical apps PRODUCT (apps PR 40), pinned as reviewed DATA. The runtime holds no product bytes: a consumer
  # passes the release's zip, merged-PR proof and provenance as one operand directory, which
  # modules/input-contracts.mjs admits once against this pin. The full ACCEPTANCE closure metadata is in that
  # provenance; only its identity is pinned here. Bytes are not claimed to be reproducible across hosts.
  product = rec {
    tag = "voice-ui-dist-39dc6df680208ffe3c38b0330db26680022261bf";
    base = "https://github.com/roccho-dev/apps/releases/download/${tag}";
    zip = { sha256 = "54222e83b8c31e6e654fa38dc3f97d4df7b10cd3c0f6361b3d728ec605252a70"; bytes = 62383440; };
    proofSha256 = "8f63f2ade56aa09d0074a187afc5c84f807fb3dcdbecfe4df4b4e9028580117b";
    provenanceSha256 = "df736241b7c15a91507167d46e548581d5a7e136baf0c220ba69a73b42214e0d";
    manifestSha256 = "db10ad3fcfc01163b09ac494b35cd378d4744daa05f71b41c6dd846ebfbf64b1";
    workerSha256 = "78f988f7ce1b4b8e7b063472654cce58b1a3a76ddd5e93b459e889f243999468";
    proof = {
      pr_number = 40;
      base = "proposals";
      reviewed_head = "19b466845bfc35641b7181c7307ef1d521a00d20";
      r_exact_head_verdict_ref = "https://github.com/roccho-dev/apps/pull/40#pullrequestreview-5372940178";
      merge_sha = "39dc6df680208ffe3c38b0330db26680022261bf";
      reviewed_tree = "351ddcffa4be2b827aaab616359cd2b9cc66236d";
      merge_tree = "351ddcffa4be2b827aaab616359cd2b9cc66236d";
    };
    acceptance = {
      sha256 = "dae204f3e7787563908a59a5d8244bc28adb20090dcc268ec6c011630d910293";
      bytes = 916043600;
      paths = 176;
      root = "/nix/store/z7n35pr1j1m6yxk9qhhmhpha300c4a1w-voice-ui-acceptance-node";
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
