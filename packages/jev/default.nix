{ stdenvNoCC, nodejs, makeWrapper }:

stdenvNoCC.mkDerivation {
  pname = "jev";
  version = "1.0.0";

  src = ./.;

  nativeBuildInputs = [ nodejs makeWrapper ];

  installPhase = ''
    mkdir -p $out/lib
    cp -r src cli package.json $out/lib/

    mkdir -p $out/bin
    makeWrapper ${nodejs}/bin/node $out/bin/jev \
      --add-flags "$out/lib/cli/index.mjs"
  '';
}
