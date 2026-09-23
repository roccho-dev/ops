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
    {
      self,
      nixpkgs,
      governance,
      adrsRecords,
      conventionGovernance,
      ops-build-defs,
      nodejs-src,
      ...
    }:
    let
      inputs = {
        inherit
          self
          nixpkgs
          governance
          adrsRecords
          conventionGovernance
          ops-build-defs
          nodejs-src
          ;
      };
      original = (import ./flake.base.nix).outputs inputs;
      packages = builtins.mapAttrs (
        system: existing:
        existing
        // {
          prove-feat = existing.prove-feat;
          ops-artifact-materialize = existing.ops-artifact-materialize;
          ops-knowledge-intake = existing.ops-knowledge-intake;
          ops-runbook-checks = existing.ops-runbook-checks;
          ops-thread-fsm = existing.ops-thread-fsm;
          ops-refs-vault = existing.ops-refs-vault;
          ops-cdp-core = existing.ops-cdp-core;
          hayamimi-web = nixpkgs.legacyPackages.${system}.callPackage ./packages/hayamimi-web { };
          jev = nixpkgs.legacyPackages.${system}.callPackage ./packages/jev/default.nix { };
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
          hq-modeling-runtime = nixpkgs.legacyPackages.${system}.buildGoModule {
            pname = "hq-modeling-runtime";
            version = "1.0.0";
            src = ./packages/hq-modeling-runtime;
            vendorHash = null;
            subPackages = [ "cmd/hq-modeling-runtime" ];
            ldflags = [
              "-s"
              "-w"
              "-buildid="
            ];
            doCheck = true;
          };
          shiftleft-admission =
            let
              pkgs = nixpkgs.legacyPackages.${system};
            in
            pkgs.buildGoModule {
              pname = "shiftleft-admission";
              version = "0.1.0";
              src = ./packages/shiftleft-admission;
              vendorHash = null;
              allowGoReference = true;
              subPackages = [ "cmd/policyctl" ];
              ldflags = [
                "-s"
                "-w"
                "-buildid="
              ];
              nativeBuildInputs = [ pkgs.makeWrapper ];
              postInstall = ''
                test -x "$out/bin/policyctl"
              '';
              postFixup = ''
                wrapProgram "$out/bin/policyctl" \
                  --prefix PATH : ${
                    pkgs.lib.makeBinPath [
                      pkgs.ast-grep
                      pkgs.git
                      pkgs.go
                      pkgs.nodejs
                      pkgs.python3
                    ]
                  }
              '';
              doCheck = true;
            };
        }
      ) original.packages;
      checks = builtins.mapAttrs (
        system: existing:
        existing
        // {
          prove-feat = existing.prove-feat;
          prove-feat-structure = existing.prove-feat-structure;
          prove-feat-format = existing.prove-feat-format;
          prove-feat-deadnix = existing.prove-feat-deadnix;
          prove-feat-contract-lint = existing.prove-feat-contract-lint;
          ops-artifact-materialize = existing.ops-artifact-materialize;
          ops-knowledge-intake = existing.ops-knowledge-intake;
          ops-runbook-checks = existing.ops-runbook-checks;
          ops-thread-fsm = existing.ops-thread-fsm;
          ops-refs-vault = existing.ops-refs-vault;
          ops-cdp-core = existing.ops-cdp-core;
          jev =
            let
              pkgs = nixpkgs.legacyPackages.${system};
            in
            pkgs.runCommand "jev-test"
              {
                nativeBuildInputs = [ pkgs.nodejs ];
              }
              ''
                mkdir -p $out
                cd ${self}/packages/jev

                # Run offline unit tests
                ${pkgs.nodejs}/bin/node --test tests/*.test.mjs

                # Test installed binary directly via symlink
                BIN=${packages.${system}.jev}/bin/jev

                # Test 1: invalid JSON should exit 1 and output single JSON line
                OUTPUT=$($BIN <<< 'not json' 2>&1; echo "EXIT_CODE:$?")
                LINE_COUNT=$(echo "$OUTPUT" | grep -v '^EXIT_CODE:' | wc -l)
                [ "$LINE_COUNT" -eq 1 ] || (echo "Invalid JSON test: expected 1 line, got $LINE_COUNT"; exit 1)
                echo "$OUTPUT" | grep -v '^EXIT_CODE:' | grep -q '"error":"invalid_json"' || exit 1
                EXIT=$(echo "$OUTPUT" | grep '^EXIT_CODE:' | cut -d: -f3)
                [ "$EXIT" -eq 1 ] || (echo "Invalid JSON test: expected exit 1, got $EXIT"; exit 1)

                # Test 2: missing key should exit 2 and output single JSON line
                INPUT='{"type":"noul","text":"test","question":"Q?"}'
                OUTPUT=$(env -i $BIN <<< "$INPUT" 2>&1; echo "EXIT_CODE:$?")
                LINE_COUNT=$(echo "$OUTPUT" | grep -v '^EXIT_CODE:' | wc -l)
                [ "$LINE_COUNT" -eq 1 ] || (echo "Missing key test: expected 1 line, got $LINE_COUNT"; exit 1)
                echo "$OUTPUT" | grep -v '^EXIT_CODE:' | grep -q '"error":"auth_missing"' || exit 1
                EXIT=$(echo "$OUTPUT" | grep '^EXIT_CODE:' | cut -d: -f3)
                [ "$EXIT" -eq 2 ] || (echo "Missing key test: expected exit 2, got $EXIT"; exit 1)

                echo "All Nix check tests passed"
              '';
          hq-modeling-runtime = packages.${system}.hq-modeling-runtime;
          issue-116-shiftleft-proof =
            let
              pkgs = nixpkgs.legacyPackages.${system};
            in
            pkgs.runCommand "issue-116-shiftleft-proof-check"
              {
                nativeBuildInputs = [
                  pkgs.ast-grep
                  pkgs.git
                  pkgs.go
                  pkgs.nodejs
                  pkgs.python3
                  packages.${system}.shiftleft-admission
                ];
              }
              ''
                mkdir -p "$out" source/packages
                cp -R ${./packages/shiftleft-admission} source/packages/shiftleft-admission
                cp -R ${./packages/structured-diagnostic} source/packages/structured-diagnostic
                chmod -R u+w source
                cd source/packages/shiftleft-admission
                POLICYCTL=${packages.${system}.shiftleft-admission}/bin/.policyctl-wrapped \
                GIT_WRITE_CLOSURE_SCRIPT=${./packages/ops-git-write-closure/bin/ops-git-write-closure.mjs} \
                  ${pkgs.bash}/bin/bash tests/e2e.sh
                touch "$out/ok"
              '';
        }
      ) original.checks;
    in
    original // { inherit packages checks; };
}
