{
  description = "ops: operational packages implementing governance contracts, including gosh v0";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    governance = {
      url = "github:roccho-dev/governance/proposals";
      flake = false;
    };
    adrsRecords = {
      url = "path:./fixtures/adrsRecords";
      flake = false;
    };
    conventionGovernance = {
      url = "github:roccho-dev/governance/proposals";
      inputs.adrsRecords.follows = "adrsRecords";
    };
    ops-build-defs = {
      url = "path:./packages/ops-build-defs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nodejs-src = {
      url = "git+https://github.com/nodejs/node?ref=refs/tags/v26.3.0&rev=b7e6a5d37e7a14ef0f2cc95214b95d66c4081415";
      flake = false;
    };
  };

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
