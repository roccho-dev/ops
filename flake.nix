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
        ops-knowledge-intake = pkgs.writeShellApplication {
          name = "ops-knowledge-intake";
          runtimeInputs = [ pkgs.python3 ];
          text = ''
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-knowledge-intake/bin/ops-knowledge-intake.py} "$@"
          '';
        };
        ops-bootstrap = pkgs.runCommand "ops-bootstrap" { } ''
          mkdir -p $out/share/ops
          cat > $out/share/ops/README <<'EOF'
          ops bootstrap package. Replace with package-backed implementations.
          EOF
        '';
        default = ops-knowledge-intake;
      });

      checks = forEachSystem (pkgs: {
        ops-knowledge-intake = pkgs.runCommand "ops-knowledge-intake-check" {
          nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-knowledge-intake ];
        } ''
          mkdir -p "$out"
          ops-knowledge-intake \
            --items ${./packages/ops-knowledge-intake/tests/items.tsv} \
            --out "$out/knowledge.tsv" \
            --json-summary "$out/summary.json" > "$out/stdout.json"
          grep -q '^knowledge_id' "$out/knowledge.tsv"
          grep -q 'retry-template-candidate' "$out/knowledge.tsv"
          grep -q 'gate-candidate' "$out/knowledge.tsv"
          grep -q '"count": 3' "$out/summary.json"
        '';
        ops-bootstrap = pkgs.runCommand "ops-bootstrap-check" { } ''
          test -e ${self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap}/share/ops/README
          touch $out
        '';
      });
    };
}
