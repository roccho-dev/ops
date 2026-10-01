{
  stdenvNoCC,
  nodejs,
  makeWrapper,
  python3,
}:

stdenvNoCC.mkDerivation {
  pname = "jev";
  version = "1.0.0";

  src = ./.;

  nativeBuildInputs = [
    nodejs
    makeWrapper
  ];

  passthru.workerESM = stdenvNoCC.mkDerivation {
    pname = "jev-worker-esm";
    version = "1.0.0";
    src = ./.;
    nativeBuildInputs = [ python3 ];
    dontBuild = true;
    installPhase = ''
      python3 build/provider-artifact.py selftest --source src/batch.mjs
      python3 build/provider-artifact.py assemble --source src/batch.mjs --out "$out"
      digest=$(cut -d' ' -f1 "$out/jev-provider.zip.sha256")
      python3 build/provider-artifact.py verify --archive "$out/jev-provider.zip" --sha256 "$digest"
    '';
  };

  installPhase = ''
    mkdir -p $out/lib
    cp -r src cli package.json $out/lib/

    mkdir -p $out/share/jev
    cp artifact.jsonl $out/share/jev/artifact.jsonl

    mkdir -p $out/bin
    makeWrapper ${nodejs}/bin/node $out/bin/jev \
      --add-flags "$out/lib/cli/index.mjs"
  '';
}
