{ pkgs ? let
    pin = (builtins.fromJSON (builtins.readFile ../flake.lock)).nodes.nixpkgs.locked;
  in (builtins.getFlake "github:NixOS/nixpkgs/${pin.rev}").legacyPackages.${builtins.currentSystem}
}:
let
  python = pkgs.python3.withPackages (ps: [ ps.playwright ]);
  runtime = pkgs.buildEnv {
    name = "ops-provider-effect-runtime";
    paths = [ pkgs.nodejs python pkgs.chromium pkgs.wrangler pkgs.git pkgs.gh
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
