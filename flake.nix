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
          provider-effect-runtime = import ./tools/provider-effect-runtime.nix {
            pkgs = nixpkgs.legacyPackages.${system};
          };
          voice-ui-target-runtime = import ./packages/voice-ui-target-runtime {
            pkgs = nixpkgs.legacyPackages.${system};
            opsSha = self.rev or "working-tree";
          };
          cdp-tty = nixpkgs.legacyPackages.${system}.callPackage ./packages/cdp-tty { };
          hayamimi-web = nixpkgs.legacyPackages.${system}.callPackage ./packages/hayamimi-web { };
          jev = nixpkgs.legacyPackages.${system}.callPackage ./packages/jev/default.nix { };
          semcmp = nixpkgs.legacyPackages.${system}.callPackage ./packages/semcmp/default.nix { };
          mail-routing-tofu =
            let
              envsSource = builtins.fetchTree {
                type = "github";
                owner = "NixOS";
                repo = "nixpkgs";
                rev = "f9948418dc8628ac02b6d6337e191ade9429d59d";
                narHash = "sha256-q1a/1H/Z5DJ9PRIueWDtoQbfhO2zAwni9wPsKCa1mc0=";
              };
              envsPkgs = import envsSource { inherit system; };
            in
            envsPkgs.opentofu.withPlugins (p: [ p.cloudflare_cloudflare ]);
          jev-worker-esm = packages.${system}.jev.workerESM;
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
          provider-effect-runtime = packages.${system}.provider-effect-runtime.check;
          mail-routing-native =
            let
              pkgs = nixpkgs.legacyPackages.${system};
              tofu = packages.${system}.mail-routing-tofu;
            in
            pkgs.runCommand "mail-routing-m0-native-source-check"
              { nativeBuildInputs = [ tofu ]; }
              ''
                set -eu
                export HOME="$TMPDIR/mail-home" XDG_CACHE_HOME="$TMPDIR/mail-cache"
                export HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9
                mkdir -p "$HOME" "$XDG_CACHE_HOME" root bootstrap
                cp ${./providers/mail-routing/main.tf} root/main.tf
                cp ${./providers/mail-routing/.terraform.lock.hcl} root/.terraform.lock.hcl
                cp ${./providers/mail-routing/safety.tftest.hcl} root/safety.tftest.hcl
                cp root/main.tf bootstrap/main.tf
                # Nix-installed exact provider identity from a temporary
                # unlocked sandbox. The actual check keeps readonly lock.
                cd bootstrap
                tofu init -backend=false -input=false -no-color >/dev/null
                observed="$(grep -o 'h1:[A-Za-z0-9+/=]*' .terraform.lock.hcl | head -n 1)"
                test -n "$observed"
                cd ../root
                tofu fmt -check -diff main.tf
                tofu fmt -check -diff safety.tftest.hcl
                if ! tofu init -backend=false -lockfile=readonly -input=false -no-color; then
                  echo "NIX_PINNED_PROVIDER_H1=$observed" >&2
                  exit 1
                fi
                if ! tofu validate -no-color; then
                  echo "NIX_PINNED_PROVIDER_H1=$observed" >&2
                  exit 1
                fi
                export TF_ENCRYPTION="$(printf '%s\n' \
                  'key_provider "pbkdf2" "fixture" { passphrase = "0000000000000000000000000000000000000000000000000000000000000000" }' \
                  'method "aes_gcm" "fixture" { keys = key_provider.pbkdf2.fixture }' \
                  'state { method = method.aes_gcm.fixture }' \
                  'plan { method = method.aes_gcm.fixture }')"
                tofu test -no-color
                mkdir -p "$out"
                printf "M0 readonly lock/schema/native mocked tests PASS, no provider effect\n" > "$out/proof"
              '';
          voice-ui-target-runtime = packages.${system}.voice-ui-target-runtime.boundaryCheck;
          jev =
            let
              pkgs = nixpkgs.legacyPackages.${system};
            in
            pkgs.runCommand "jev-test"
              {
                nativeBuildInputs = [
                  pkgs.nodejs
                  pkgs.python3
                  pkgs.yq-go
                ];
              }
              ''
                ${pkgs.nodejs}/bin/node --test ${self}/packages/jev-dispatcher/test.mjs
                cd ${self}/packages/jev
                ${pkgs.nodejs}/bin/node --test tests/*.test.mjs
                JEV_PROVIDER_ENTRY=${
                  packages.${system}.jev-worker-esm
                }/batch.mjs ${pkgs.nodejs}/bin/node --test tests/batch.test.mjs
                python3 ${self}/tools/jev-provider-artifact.py selftest --source ${
                  packages.${system}.jev-worker-esm
                }/batch.mjs
                yq -o=json . ${self}/.github/workflows/jev-provider-release.yml | python3 ${self}/packages/hayamimi-web/build/check-release-workflow.py
                python3 ${self}/packages/hayamimi-web/build/check-release-workflow.py --selftest
                python3 ${self}/packages/hayamimi-web/build/release-provenance.py selftest
                cd "$TMPDIR"
                unset JEV_API_KEY
                BIN=${packages.${system}.jev}/bin/jev
                ln -s "$BIN" jev-link
                printf 'not json' > in1
                printf '{"type":"noul","text":"t","question":"q"}' > in2
                for b in "$BIN" ./jev-link; do
                  rc=0; "$b" < in1 > o 2> e || rc=$?
                  test "$rc" -eq 1; test "$(wc -l < o)" -eq 1; grep -q '"invalid_json"' o; test ! -s e
                  rc=0; "$b" < in2 > o 2> e || rc=$?
                  test "$rc" -eq 2; test "$(wc -l < o)" -eq 1; grep -q '"auth_missing"' o; test ! -s e
                done
                cmp "${packages.${system}.jev}/share/jev/artifact.jsonl" "${self}/packages/jev/artifact.jsonl"
                echo "jev check: unit tests; installed CLI direct+symlink: invalid=1, nokey=2, 1 stdout line, empty stderr; artifact verified" > $out
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
