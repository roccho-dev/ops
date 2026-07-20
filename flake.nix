let
  base = import ./flake.base.nix;
in
base
// {
  description = "ops: operational packages implementing governance contracts, including gosh v0";

  outputs =
    inputs@{ nixpkgs, ... }:
    let
      original = base.outputs inputs;
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
