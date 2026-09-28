{ pkgs, opsSha }:
let
  appsSha = "28c1eee878004c87fcef3aaa1955517c31f73829";
  apps = (builtins.getFlake "github:roccho-dev/apps/${appsSha}").packages.${pkgs.stdenv.hostPlatform.system};
  artifact = apps.voice-ui-dist;
  acceptance = "${apps.voice-ui-acceptance-runtime}/bin/voice-ui-acceptance-node";
  config = { inherit opsSha appsSha acceptance; artifactRoot = "${artifact}"; };
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
    node ${./tests/boundary.mjs} ${runtime} ${artifact} ${acceptance} ${pkgs.wrangler}/bin/wrangler
    mkdir -p "$out"
    cp runtime.json "$out/"
    printf 'CI_BOUNDARY_PASS\nLIVE_PROVIDER_NOT_RUN\n' > "$out/status"
  '';
}
