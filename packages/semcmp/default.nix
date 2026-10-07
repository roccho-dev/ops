{ runCommand, nodejs, makeWrapper }:

runCommand "semcmp-0.1.0" { nativeBuildInputs = [ makeWrapper ]; } ''
  mkdir -p "$out/lib/semcmp/bin" "$out/lib/jev-review" "$out/lib/jev/src" "$out/share/semcmp" "$out/bin"
  cp ${./semcmp.mjs} "$out/lib/semcmp/semcmp.mjs"
  cp ${./bin/semcmp.mjs} "$out/lib/semcmp/bin/semcmp.mjs"
  cp ${../jev-review/review.mjs} "$out/lib/jev-review/review.mjs"
  cp ${../jev-review/rank.mjs} "$out/lib/jev-review/rank.mjs"
  cp ${../jev-review/core.mjs} "$out/lib/jev-review/core.mjs"
  cp ${../jev-review/jev.mjs} "$out/lib/jev-review/jev.mjs"
  cp ${../jev/src/core.mjs} "$out/lib/jev/src/core.mjs"
  cp ${./artifact.jsonl} "$out/share/semcmp/artifact.jsonl"
  makeWrapper ${nodejs}/bin/node "$out/bin/semcmp" \
    --add-flags "$out/lib/semcmp/bin/semcmp.mjs"
''
