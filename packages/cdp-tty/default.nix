{ lib, stdenv, pkg-config, curl, json_c, chromium, python3, binutils }:
stdenv.mkDerivation {
  pname = "cdp-tty";
  version = "0.1.0";
  src = lib.cleanSource ./.;
  outputs = [ "out" "dev" "proof" ];
  strictDeps = true;
  nativeBuildInputs = [ pkg-config ];
  buildInputs = [ curl json_c ];
  nativeCheckInputs = [ chromium (python3.withPackages (p: [ p.websocket-client ])) binutils ];
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    export HOME="$TMPDIR/home" XDG_RUNTIME_DIR="$TMPDIR/runtime"
    mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
    chmod 700 "$XDG_RUNTIME_DIR"
    export CHROME_BIN=${chromium}/bin/chromium
    make probe
    ${curl.dev}/bin/curl-config --version
    ${curl.dev}/bin/curl-config --protocols
    echo ${lib.escapeShellArg (builtins.toJSON { configureFlags = curl.configureFlags or [ ]; cmakeFlags = curl.cmakeFlags or [ ]; source = curl.meta.position or ""; })}
    set -o pipefail
    python3 -u tests/proof.py | tee proof.jsonl
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    test -s proof.jsonl
    mkdir -p "$out/bin" "$dev/lib" "$dev/include/cdp-tty" "$proof"
    cp cdp-tty "$out/bin/"
    cp libcdp-tty.a "$dev/lib/"
    cp cdp.h "$dev/include/cdp-tty/"
    cp proof.jsonl "$proof/raws.jsonl"
    python3 -c 'import json,sys; rows=[json.loads(s) for s in open("proof.jsonl")]; assert all(r["status"] == "PASS" for r in rows if r["test"] != "residuals"); assert any(r["test"] == "residuals" and r["status"] == "NOT_RUN" for r in rows); [print(json.dumps(r)) for r in rows if any(k in r["test"] for k in ("block", "rejected", "only", "generation", "wire-", "no-retry", "isolation"))]' > "$proof/disruptives.jsonl"
    sha256sum cdp.c cdp.h tty.c tty.h main.c Makefile tests/probe.c tests/proof.py > "$proof/source.sha256"
    ${chromium}/bin/chromium --version > "$proof/versions.txt"
    pkg-config --modversion libcurl json-c >> "$proof/versions.txt"
    runHook postInstall
  '';
  meta = {
    description = "Attach-only Chrome page I/O for a Kitty-capable terminal";
    mainProgram = "cdp-tty";
    platforms = lib.platforms.linux;
  };
}
