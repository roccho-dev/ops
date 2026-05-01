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
        ops-knowledge-intake = pkgs.writeShellApplication {
          name = "ops-knowledge-intake";
          runtimeInputs = [ pkgs.python3 ];
          text = ''
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-knowledge-intake/bin/ops-knowledge-intake.py} "$@"
          '';
        };
        ops-runbook-checks = pkgs.writeShellApplication {
          name = "ops-runbook-checks";
          runtimeInputs = [ pkgs.python3 ];
          text = ''
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-runbook-checks/bin/ops-runbook-checks.py} "$@"
          '';
        };
        ops-bootstrap = pkgs.runCommand "ops-bootstrap" { } ''
          mkdir -p $out/share/ops
          cat > $out/share/ops/README <<'EOF'
          ops bootstrap package. Replace with package-backed implementations.
          EOF
        '';
        default = ops-bootstrap;
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
        ops-runbook-checks = pkgs.runCommand "ops-runbook-checks-check" {
          nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-runbook-checks ];
        } ''
          mkdir -p "$out"
          ops-runbook-checks \
            --root ${./packages/ops-runbook-checks/tests/root} \
            --json > "$out/report.json"
          grep -q '"ok": true' "$out/report.json"
        '';
        ops-bootstrap = pkgs.runCommand "ops-bootstrap-check" { } ''
          test -e ${self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap}/share/ops/README
          touch $out
        '';
      });
    };
}
