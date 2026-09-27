{
  stdenvNoCC,
  nodejs,
  git,
  makeWrapper,
}:

stdenvNoCC.mkDerivation {
  pname = "jev-dispatcher-query";
  version = "0.1.0";
  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];
  installPhase = ''
    mkdir -p $out/lib/jev-dispatcher $out/lib/jev/src $out/bin $out/share/jev-dispatcher
    cp ${./query.mjs} $out/lib/jev-dispatcher/query.mjs
    cp ${./policy-select.mjs} $out/lib/jev-dispatcher/policy-select.mjs
    cp ${./proof.mjs} $out/lib/jev-dispatcher/proof.mjs
    cp ${../jev/src/client.mjs} $out/lib/jev/src/client.mjs
    cp ${./README.md} $out/share/jev-dispatcher/README.md
    cp ${./artifact.jsonl} $out/share/jev-dispatcher/artifact.jsonl
    makeWrapper ${nodejs}/bin/node $out/bin/jev-dispatcher-query \
      --set DISPATCHER_GIT_BIN ${git}/bin/git \
      --add-flags "$out/lib/jev-dispatcher/query.mjs"
  '';
}
