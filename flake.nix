{
  description = "ops: operational packages implementing specs contracts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    specs.url = "path:../specs";
  };

  outputs = { self, nixpkgs, specs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      packages = forEachSystem (pkgs: {
        ops-bootstrap = pkgs.runCommand "ops-bootstrap" { } ''
          mkdir -p $out/share/ops
          cat > $out/share/ops/README <<'EOF'
          ops bootstrap package. Replace with package-backed implementations.
          EOF
        '';
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap;
      });

      checks = forEachSystem (pkgs: {
        ops-bootstrap = pkgs.runCommand "ops-bootstrap-check" { } ''
          test -e ${self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap}/share/ops/README
          touch $out
        '';
      });
    };
}
