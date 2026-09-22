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

let
  # Stage 1 is the only stage allowed to reach the network. Every input it
  # fetches is declared by identity in sources.lock.jsonl and verified
  # fail-closed, so the fixed output hash covers downloaded bytes only -- never
  # compiler output.
  sources = stdenvNoCC.mkDerivation {
    pname = "hayamimi-web-sources";
    version = "0.1.0";
    src = ./.;

    nativeBuildInputs = [ bash cacert coreutils git gnutar python3 ];

    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-RLic63Z5lGABVsBGcCrM4dxI/5FzoS9oKOU0gk0yA+U=";

    installPhase = ''
      runHook preInstall
      export HOME="$TMPDIR/home"
      export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
      mkdir -p "$HOME"

      packageRoot="$PWD"
      work="$TMPDIR/fetch"

      python3 "$packageRoot/build/fetch.py" --root "$packageRoot" --work "$work"
      python3 "$packageRoot/build/verify-sources.py" --root "$packageRoot" --work "$work"

      # Clean export: git archive emits the tracked tree at the verified
      # revision, so no .git reaches the output and its packfiles cannot make
      # the closure host-dependent. Verification above already ran while the
      # clone was still intact.
      mkdir -p "$out/sources"
      for repo in "$work"/sources/*; do
        name="$(basename "$repo")"
        mkdir -p "$out/sources/$name"
        git -C "$repo" archive --format=tar HEAD | tar -x -C "$out/sources/$name"
      done
      cp -R "$work/downloads" "$out/downloads"
      cp -R "$work/cmake-deps" "$out/cmake-deps"
      cp "$work/source-receipt.jsonl" "$out/source-receipt.jsonl"
      runHook postInstall
    '';
  };
in
stdenvNoCC.mkDerivation {
  pname = "hayamimi-web";
  version = "0.1.0";
  src = ./.;

  nativeBuildInputs = [
    bash
    bzip2
    cmake
    coreutils
    emscripten
    findutils
    gnumake
    gnugrep
    gnutar
    python3
    which
  ];

  dontConfigure = true;
  dontFixup = true;

  # Stage 2 is an ordinary input-addressed derivation: no network and no output
  # hash. The Emscripten output is allowed to differ between hosts; the artifact
  # contract is verify-dist.py, not byte equality.
  buildPhase = ''
    runHook preBuild
    packageRoot="$PWD"
    work="$TMPDIR/hayamimi"

    cp -R ${sources} "$work"
    chmod -R u+w "$work"

    # Offline CMake placement. Every archive the upstream build would otherwise
    # download is staged in $HOME/Downloads, which each cmake module checks
    # first. That location is environment-based rather than project-relative, so
    # it is also found by nested FetchContent sub-builds such as kissfft and
    # eigen, where CMAKE_SOURCE_DIR no longer points at the sherpa-onnx root.
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME/Downloads"
    cp "$work"/cmake-deps/* "$HOME/Downloads/"

    patchShebangs "$work/sources/sherpa-onnx"
    export EMSCRIPTEN="${emscripten}/share/emscripten"
    export EM_CACHE="$TMPDIR/em-cache"
    mkdir -p "$EM_CACHE"
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
