{
  description = "ops: operational packages implementing specs contracts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      packages = forEachSystem (pkgs: rec {
        ops-artifact-materialize = pkgs.writeShellApplication {
          name = "ops-artifact-materialize";
          runtimeInputs = [ pkgs.python3 ];
          text = ''
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-artifact-materialize/bin/ops-artifact-materialize.py} "$@"
          '';
        };
        ops-bootstrap = pkgs.runCommand "ops-bootstrap" { } ''
          mkdir -p $out/share/ops
          cat > $out/share/ops/README <<'EOF'
          ops bootstrap package. Replace with package-backed implementations.
          EOF
        '';
        default = ops-artifact-materialize;
      });

      checks = forEachSystem (pkgs: {
        ops-artifact-materialize = pkgs.runCommand "ops-artifact-materialize-check" {
          nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-artifact-materialize ];
        } ''
          mkdir -p "$out/restored"
          ops-artifact-materialize \
            --input ${./packages/ops-artifact-materialize/tests/sample-thread.txt} \
            --out-dir "$out/restored" \
            --strict-count \
            --json > "$out/result.json"
          test "$(cat "$out/restored/hello.txt")" = "ok"
          grep -q '"ok": true' "$out/restored/MATERIALIZE_MANIFEST.json"
        '';
        ops-bootstrap = pkgs.runCommand "ops-bootstrap-check" { } ''
          test -e ${self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap}/share/ops/README
          touch $out
        '';
      });
    };
}
