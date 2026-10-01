{ pkgs }:
# The Cloudflare cf CLI, pinned by cf/package-lock.json. Every npm tarball is a fixed-output fetch keyed by the lock's
# integrity hash, so the closure is built once from reviewed bytes and never resolves or installs anything at run time.
# Only the voice-ui target runtime uses it, and only for `cf deploy --prebuilt` of an already built Worker.
let
  nodeModules = pkgs.importNpmLock.buildNodeModules {
    npmRoot = ./cf;
    inherit (pkgs) nodejs;
  };
in
pkgs.runCommand "cf-1.0.0-beta.6" {
  nativeBuildInputs = [ pkgs.makeWrapper ];
  passthru = { inherit nodeModules; };
} ''
  test -f ${nodeModules}/node_modules/cf/bin/cf
  # Telemetry off by the documented switches; nothing else about cf's behaviour is changed.
  makeWrapper ${pkgs.nodejs}/bin/node "$out/bin/cf" \
    --add-flags ${nodeModules}/node_modules/cf/bin/cf \
    --set DO_NOT_TRACK 1 \
    --set WRANGLER_SEND_METRICS false
''
