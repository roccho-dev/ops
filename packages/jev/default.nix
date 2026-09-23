{ stdenvNoCC, nodejs }:

stdenvNoCC.mkDerivation {
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
exec ${nodejs}/bin/node ''${BASH_SOURCE%/*}/../lib/cli/index.mjs "$@"
WRAPPER
    chmod +x $out/bin/jev
  '';

  postInstall = ''
    $out/bin/jev --version 2>&1 | grep -q "error\|Cannot find" && exit 1 || true
    test -x $out/bin/jev || exit 1
  '';
}
