{ nixpkgs, nodejs }:

nixpkgs.stdenv.mkDerivation {
  pname = "jev";
  version = "1.0.0";

  src = ./.;

  nativeBuildInputs = [ nodejs ];

  installPhase = ''
    mkdir -p $out/lib
    cp -r src cli package.json $out/lib/

    mkdir -p $out/bin
    cat > $out/bin/jev <<'WRAPPER'
#!/bin/sh
${nodejs}/bin/node $out/lib/cli/index.mjs "$@"
WRAPPER
    chmod +x $out/bin/jev
  '';
}
