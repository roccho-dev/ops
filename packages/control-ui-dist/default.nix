{ pkgs, uiControl }:
let
  serve = pkgs.writeShellApplication {
    name = "control-ui-serve";
    runtimeInputs = [ pkgs.caddy ];
    text = ''
      : "''${CONTROL_STATE_DIR:?CONTROL_STATE_DIR is required}"
      test -d "$CONTROL_STATE_DIR" || {
        echo "control-ui-serve: CONTROL_STATE_DIR is not a directory: $CONTROL_STATE_DIR" >&2
        exit 64
      }
      export CONTROL_UI_ROOT=${uiControl}
      exec caddy run --config ${./Caddyfile} --adapter caddyfile
    '';
  };
in
pkgs.symlinkJoin {
  name = "control-ui-dist";
  paths = [ pkgs.caddy pkgs.cloudflared serve ];
  postBuild = ''
    mkdir -p "$out/config" "$out/share"
    cp ${./Caddyfile} "$out/config/Caddyfile"
    ln -s ${uiControl} "$out/share/control-ui"
    cat > "$out/manifest.json" <<EOF
    {"schema":"control-ui-dist/1","ui":"${uiControl}","state":"external","listen":"127.0.0.1:8080","methods":["GET","HEAD"],"data":["control.jsonl","claims.jsonl"]}
    EOF
    test -x "$out/bin/caddy"
    test -x "$out/bin/cloudflared"
    test -x "$out/bin/control-ui-serve"
    test -s "$out/config/Caddyfile"
    test -s "$out/manifest.json"
  '';
}
