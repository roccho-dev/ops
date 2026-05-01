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
        default = ops-runbook-checks;
      });

      checks = forEachSystem (pkgs: {
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
