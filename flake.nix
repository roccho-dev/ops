{
  description = "ops: operational packages implementing governance contracts, including gosh v0";

  inputs = (import ./flake.base.nix).inputs;

  outputs =
    inputs@{ nixpkgs, ... }:
    let
      original = (import ./flake.base.nix).outputs inputs;
      packages = builtins.mapAttrs (
        system: existing:
        existing
        // {
          gosh = nixpkgs.legacyPackages.${system}.buildGoModule {
            pname = "gosh";
            version = "0.1.0";
            src = ./packages/gosh;
            vendorHash = null;
            subPackages = [ "cmd/gosh" ];
            ldflags = [
              "-s"
              "-w"
            ];
            doCheck = true;
          };
        }
      ) original.packages;
    in
    original // { inherit packages; };
}
