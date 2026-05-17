{
  description = "ops: operational packages implementing specs contracts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      cdpFor = pkgs: (import ./packages/ops-cdp-core/src/cdp/chromium-cdp.nix { }).perSystem { inherit pkgs; };
    in {
      packages = forEachSystem (pkgs:
      let
        cdp = cdpFor pkgs;
      in rec {
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
        ops-thread-fsm = pkgs.writeShellApplication {
          name = "ops-thread-fsm";
          runtimeInputs = [ pkgs.python3 ];
          text = ''
            export PYTHONPATH="${./packages/ops-thread-fsm/lib}''${PYTHONPATH:+:}''${PYTHONPATH:-}"
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-thread-fsm/bin/ops-thread-fsm} "$@"
          '';
        };
        ops-tailnet-github-egress = pkgs.writeShellApplication {
          name = "ops-tailnet-github-egress";
          runtimeInputs = [ pkgs.git pkgs.glibc.bin pkgs.iproute2 pkgs.openssh pkgs.procps pkgs.python3 pkgs.sudo pkgs.tailscale ];
          text = ''
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-tailnet-github-egress/bin/ops-tailnet-github-egress.py} "$@"
          '';
        };
        git-push-tailnet = pkgs.writeShellApplication {
          name = "git-push-tailnet";
          runtimeInputs = [ pkgs.git pkgs.python3 ops-tailnet-github-egress ];
          text = ''
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-tailnet-github-egress/bin/git-push-tailnet} "$@"
          '';
        };
        ops-refs-vault = pkgs.writeShellApplication {
          name = "ops-refs-vault";
          runtimeInputs = [ pkgs.git pkgs.python3 git-push-tailnet ops-tailnet-github-egress ];
          text = ''
            exec ${pkgs.python3}/bin/python3 ${./packages/ops-refs-vault/bin/ops-refs-vault.py} "$@"
          '';
        };
        ops-bootstrap = pkgs.runCommand "ops-bootstrap" { } ''
          mkdir -p $out/share/ops
          cat > $out/share/ops/README <<'EOF'
          ops bootstrap package. Replace with package-backed implementations.
          EOF
        '';
        ops-cdp-core = cdp.packages.cdp;
        default = ops-bootstrap;
      } // cdp.packages);

      apps = forEachSystem (pkgs: (cdpFor pkgs).apps);

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
          grep -q '"classification": "minimum-static-gate-pass"' "$out/report.json"
          grep -q '"scope": "static-only"' "$out/report.json"
          grep -q '"capability": "chatgpt.projectSource.uploadReadback"' "$out/report.json"
          grep -q '"capability": "chatgpt.artifact.receipt"' "$out/report.json"
          grep -q '"capability": "review.impl.pass"' "$out/report.json"
          grep -q '"capability": "review.merge.pass"' "$out/report.json"
          grep -q '"capability": "tailnet.github.egressPush"' "$out/report.json"
          grep -q '"capability": "authority.completeApproved"' "$out/report.json"
          test "$(grep -c '"not-proven-by-static-check"' "$out/report.json")" -eq 6
          cp -R ${./packages/ops-runbook-checks/tests/root} "$out/legacy-token-root"
          chmod -R u+w "$out/legacy-token-root"
          cat >> "$out/legacy-token-root/AGENTS.md" <<'EOF'

          Legacy false-positive tokens below must fail this otherwise complete fixture:

          - `0/9`
          - `$HOME/.agents/status.md`
          - `delivery-verified`
          - `merge executor`
          - `role-override`
          - `post-hoc-merge-review-required`
          EOF
          if ops-runbook-checks \
            --root "$out/legacy-token-root" \
            --json > "$out/legacy-report.json"; then
            echo "legacy token fixture unexpectedly passed" >&2
            exit 1
          fi
          grep -q '"classification": "minimum-static-gate-fail"' "$out/legacy-report.json"
          grep -q 'AGENTS.md still contains legacy or raw-success token' "$out/legacy-report.json"
        '';
        ops-thread-fsm = pkgs.runCommand "ops-thread-fsm-check" {
          nativeBuildInputs = [ pkgs.python3 self.packages.${pkgs.stdenv.hostPlatform.system}.ops-thread-fsm ];
        } ''
          mkdir -p "$out"
          cp -R ${./packages/ops-thread-fsm} ./ops-thread-fsm-src
          chmod -R u+w ./ops-thread-fsm-src
          python3 -S ./ops-thread-fsm-src/tests/test_ops_thread_fsm.py > "$out/test.log"
          ops-thread-fsm next --state-kind request-sent --dry-run --json > "$out/next.json"
          grep -q '"writes": false' "$out/next.json"
          grep -q 'sleep 900' "$out/next.json"
          touch "$out/done"
        '';
        ops-tailnet-github-egress = pkgs.runCommand "ops-tailnet-github-egress-check" {
          nativeBuildInputs = [ pkgs.git pkgs.python3 self.packages.${pkgs.stdenv.hostPlatform.system}.ops-tailnet-github-egress self.packages.${pkgs.stdenv.hostPlatform.system}.git-push-tailnet pkgs.gnugrep ];
        } ''
          mkdir -p "$out"
          ops-tailnet-github-egress policy --json > "$out/policy.json"
          grep -q '"connectorTag": "tag:github"' "$out/policy.json"
          grep -q 'route-gated local git push' "$out/policy.json"
          grep -q 'tcp_mtu_probing' "$out/policy.json"
          grep -q 'all resolved github.com IPv4' ${./packages/ops-tailnet-github-egress/tests/offline-contract.txt}
          grep -q -- '--print-selected-ip' ${./packages/ops-tailnet-github-egress/snippets/github-route-check.sh}
          grep -q -- '--print-selected-ip' ${./packages/ops-tailnet-github-egress/snippets/github-push-local-app-connector-long.sh}
          grep -q -- '--print-selected-ip' ${./packages/ops-tailnet-github-egress/snippets/github-restore-ref-app-connector-long.sh}
          ! grep -R "print \$1; exit" ${./packages/ops-tailnet-github-egress/snippets}
          GIT_PUSH_TAILNET_SCRIPT=${./packages/ops-tailnet-github-egress/bin/git-push-tailnet} \
            python3 -S ${./packages/ops-tailnet-github-egress/tests/test_git_push_tailnet.py} > "$out/git-push-tailnet.log"
        '';
        ops-refs-vault = pkgs.runCommand "ops-refs-vault-check" {
          nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-refs-vault pkgs.gnugrep ];
        } ''
          mkdir -p "$out"
          ops-refs-vault smoke-local > "$out/report.json"
          grep -q '"ok": true' "$out/report.json"
        '';
        ops-cdp-core = pkgs.runCommand "ops-cdp-core-check" {
          nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-cdp-core ];
        } ''
          mkdir -p "$out"
          chromium-cdp-chatgpt-command-map > "$out/chatgpt-command-map.md"
          grep -q 'chromium-cdp-upload-project-source-text' "$out/chatgpt-command-map.md"
          grep -q 'chromium-cdp-create-project-thread' "$out/chatgpt-command-map.md"
          test -x "$(command -v chromium-cdp-upload-project-source-text)"
          test -x "$(command -v chromium-cdp-upload-project-source-file)"
          test -x "$(command -v chromium-cdp-create-project-thread)"
          test -x "$(command -v chromium-cdp-send-chatgpt)"
          test -x "$(command -v chromium-cdp-project-source-reread)"
          test -x "$(command -v chromium-cdp-fetch-artifact-strict)"
          test -x "$(command -v project-transport-doctor)"
          test -x "$(command -v project-transport-env)"
          test -x "$(command -v project-source-put)"
          test -x "$(command -v project-thread-create)"
          test -x "$(command -v project-thread-send)"
          test -x "$(command -v project-thread-readback)"
          test -x "$(command -v project-artifact-fetch)"
          test -x "$(command -v project-transport-claim)"
          test -x "$(command -v project-transport-run)"
          test -x "$(command -v cdp-bridge)"
          cdp-bridge --help > "$out/cdp-bridge-help.txt" 2>&1
          grep -q 'cdp-bridge wsurl' "$out/cdp-bridge-help.txt"
          grep -q 'click-mode direct' "$out/cdp-bridge-help.txt"
          mkdir -p "$out/transport"
          printf 'hello\n' > "$out/transport/source.txt"
          printf 'use Project Source artifact\n' > "$out/transport/prompt.txt"
          project-transport-doctor --offline --out-path "$out/transport/doctor.json" > "$out/transport/doctor.stdout"
          project-source-put --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --file "$out/transport/source.txt" --out-dir "$out/transport" > "$out/transport/source-put.json"
          project-thread-create --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --text-file "$out/transport/prompt.txt" --out-dir "$out/transport" > "$out/transport/thread-create.json"
          project-thread-send --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --project-url 'https://chatgpt.com/g/g-p-test/project' --text 'artifact: source.txt' --out-dir "$out/transport" > "$out/transport/thread-send.json"
          ! project-thread-send --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --text "$(python3 - <<'PY'
          print('x' * 2100)
          PY
          )" --out-dir "$out/transport" > "$out/transport/thread-send-long.json"
          project-thread-readback --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --id target-test --markers source.txt --out-dir "$out/transport" > "$out/transport/readback.json"
          project-artifact-fetch --dry-run --name result.zip --url 'https://chatgpt.com/g/g-p-test/c/test' --out-dir "$out/transport" > "$out/transport/artifact-fetch.json"
          project-transport-run --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --source-file "$out/transport/source.txt" --prompt-file "$out/transport/prompt.txt" --out-dir "$out/transport/run" > "$out/transport/run.json"
          project-transport-claim --input "$out/transport/run/transport-result.json" --claim-path "$out/transport/claim.jsonl" > "$out/transport/claim.json"
          test -f "$out/transport/run/TRANSPORT_RUN_REPORT.md"
          test -s "$out/transport/claim.jsonl"
          grep -q '"semanticApproval": false' "$out/transport/run/transport-result.json"
          grep -q '"completionApproval": false' "$out/transport/run/transport-result.json"
          grep -q '"routeDecision": false' "$out/transport/run/transport-result.json"
          grep -q '"threadAttachmentFallbackAllowed": false' "$out/transport/source-put.json"
          grep -q 'inline-too-long' "$out/transport/thread-send-long.json"
        '';
        ops-bootstrap = pkgs.runCommand "ops-bootstrap-check" { } ''
          test -e ${self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap}/share/ops/README
          touch $out
        '';
      });
    };
}
