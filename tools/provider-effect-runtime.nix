{ pkgs ? let
    pin = (builtins.fromJSON (builtins.readFile ../flake.lock)).nodes.nixpkgs.locked;
  in (builtins.getFlake "github:NixOS/nixpkgs/${pin.rev}").legacyPackages.${builtins.currentSystem}
}:
let
  # Preserve the frozen producer's original Node/bundled-zlib bytes. Wrangler
  # retains its own current locked Node dependency; no service uses this as Node.
  archive = {
    x86_64-linux = { arch = "x64"; sha256 = "f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e"; };
    aarch64-linux = { arch = "arm64"; sha256 = "eab80cb88f8fda1e65f5e8d0420c9809bdb320b03fd34976ab7161b6e703b910"; };
  }.${pkgs.stdenv.hostPlatform.system};
  producerNode = pkgs.stdenvNoCC.mkDerivation {
    pname = "frozen-presentation-node";
    version = "22.16.0";
    src = pkgs.fetchurl {
      url = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-${archive.arch}.tar.xz";
      inherit (archive) sha256;
    };
    nativeBuildInputs = [ pkgs.autoPatchelfHook ];
    buildInputs = [ pkgs.stdenv.cc.cc.lib ];
    dontConfigure = true;
    dontBuild = true;
    dontStrip = true;
    installPhase = ''
      mkdir -p "$out/bin" "$out/lib/node_modules" "$out/share/licenses/node"
      cp bin/node "$out/bin/node"
      cp -r lib/node_modules/npm "$out/lib/node_modules/"
      ln -s ../lib/node_modules/npm/bin/npm-cli.js "$out/bin/npm"
      cp LICENSE "$out/share/licenses/node/LICENSE"
    '';
  };
  python = pkgs.python3.withPackages (ps: [ ps.playwright ]);
  runtime = pkgs.buildEnv {
    name = "ops-provider-effect-runtime";
    paths = [ producerNode python pkgs.chromium pkgs.wrangler pkgs.git pkgs.gh
      pkgs.curl pkgs.jq pkgs.coreutils pkgs.findutils pkgs.gnugrep pkgs.gnused
      pkgs.gawk pkgs.gnutar pkgs.gzip pkgs.bash ];
    pathsToLink = [ "/bin" ];
  };
in runtime // { check = pkgs.runCommand "provider-effect-runtime-check" {
  nativeBuildInputs = [ runtime ];
} ''
  export HOME="$TMPDIR/home"
  mkdir -p "$HOME"
  node --version
  wrangler --version
  CHROMIUM_PATH=${pkgs.chromium}/bin/chromium python3 ${./provider-effect-runtime-test.py}
  touch "$out"
''; }
