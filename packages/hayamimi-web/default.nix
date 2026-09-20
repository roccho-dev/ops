{
  lib,
  stdenvNoCC,
  bash,
  bzip2,
  cacert,
  cmake,
  coreutils,
  emscripten,
  findutils,
  git,
  gnumake,
  gnugrep,
  gnutar,
  python3,
  which,
}:

stdenvNoCC.mkDerivation {
  pname = "hayamimi-web";
  version = "0.1.0";
  src = ./.;

  nativeBuildInputs = [
    bash
    bzip2
    cacert
    cmake
    coreutils
    emscripten
    findutils
    git
    gnumake
    gnugrep
    gnutar
    python3
    which
  ];

  dontConfigure = true;
  dontFixup = true;

  # Fixed-output: upstream/model downloads are allowed during the build, while
  # the resulting browser dist tree is content-addressed and immutable.
  outputHashMode = "recursive";
  outputHashAlgo = "sha256";
  outputHash = lib.fakeHash;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR/home"
    export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
    mkdir -p "$HOME"

    packageRoot="$PWD"
    work="$TMPDIR/hayamimi"
    python3 "$packageRoot/build/fetch.py" --root "$packageRoot" --work "$work"
    python3 "$packageRoot/build/verify-sources.py" --root "$packageRoot" --work "$work"
    patchShebangs "$work/sources/sherpa-onnx"
    export EMSCRIPTEN="${emscripten}/share/emscripten"
    bash "$packageRoot/build/wasm.sh" "$work"
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    python3 "$packageRoot/build/assemble.py" --root "$packageRoot" --work "$work" --out "$out"
    python3 "$packageRoot/build/verify-dist.py" "$out"
    runHook postInstall
  '';
}
