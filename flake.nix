{
  description = "ops: operational packages implementing specs contracts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    specs = {
      url = "git+file:///home/nixos/repos/specs?ref=refs/heads/main&rev=35e1e6840a7c8a9d49eeb8f94c8c91e196d88eb6";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      specs,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      cdpFor =
        pkgs: (import ./packages/ops-cdp-core/src/cdp/chromium-cdp.nix { }).perSystem { inherit pkgs; };
    in
    {
      packages = forEachSystem (
        pkgs:
        let
          cdp = cdpFor pkgs;
        in
        rec {
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
          package-architecture-map = pkgs.writeShellApplication {
            name = "package-architecture-map";
            runtimeInputs = [ pkgs.python3 ];
            text = ''
              export PACKAGE_ARCHITECTURE_MAP_VIEWER="${./packages/package-architecture-map/viewer/index.html}"
              exec ${pkgs.python3}/bin/python3 ${./packages/package-architecture-map/bin/package-architecture-map.py} "$@"
            '';
          };
          ops-runbook-checks = pkgs.writeShellApplication {
            name = "ops-runbook-checks";
            runtimeInputs = [ pkgs.python3 ];
            text = ''
              exec ${pkgs.python3}/bin/python3 ${./packages/ops-runbook-checks/bin/ops-runbook-checks.py} "$@"
            '';
          };
          ops-handoff-core = pkgs.writeShellApplication {
            name = "ops-handoff-core";
            runtimeInputs = [ pkgs.python3 ];
            text = ''
              exec ${pkgs.python3}/bin/python3 ${./packages/ops-handoff-core/bin/ops-handoff-core.py} "$@"
            '';
          };
          ops-src-runtime-pack = pkgs.writeShellApplication {
            name = "ops-src-runtime-pack";
            runtimeInputs = [
              pkgs.git
              pkgs.gnutar
              pkgs.gzip
              pkgs.nix
              pkgs.python3
            ];
            text = ''
              exec ${pkgs.python3}/bin/python3 ${./packages/ops-src-runtime-pack/bin/ops-src-runtime-pack.py} "$@"
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
            runtimeInputs = [
              pkgs.git
              pkgs.glibc.bin
              pkgs.iproute2
              pkgs.openssh
              pkgs.procps
              pkgs.python3
              pkgs.sudo
              pkgs.tailscale
            ];
            text = ''
              exec ${pkgs.python3}/bin/python3 ${./packages/ops-tailnet-github-egress/bin/ops-tailnet-github-egress.py} "$@"
            '';
          };
          git-push-tailnet = pkgs.writeShellApplication {
            name = "git-push-tailnet";
            runtimeInputs = [
              pkgs.git
              pkgs.python3
              ops-tailnet-github-egress
            ];
            text = ''
              exec ${pkgs.python3}/bin/python3 ${./packages/ops-tailnet-github-egress/bin/git-push-tailnet} "$@"
            '';
          };
          prove-feat = pkgs.writeShellApplication {
            name = "prove-feat";
            runtimeInputs = [
              pkgs.deadnix
              pkgs.git
              pkgs.nixfmt
              pkgs.python3
            ];
            text = ''
              export PROVE_FEAT_SPEC_CATALOG="${
                specs.packages.${pkgs.stdenv.hostPlatform.system}.spec
              }/share/spec/package-catalog.json"
              export PROVE_FEAT_SPEC_PLACEMENT_TABLE="${
                specs.packages.${pkgs.stdenv.hostPlatform.system}.spec
              }/share/spec/placement-table.json"
              exec ${pkgs.python3}/bin/python3 ${./packages/prove-feat/bin/prove-feat.py} "$@"
            '';
          };
          ops-refs-vault = pkgs.writeShellApplication {
            name = "ops-refs-vault";
            runtimeInputs = [
              pkgs.git
              pkgs.python3
              git-push-tailnet
              ops-tailnet-github-egress
            ];
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
        }
        // cdp.packages
      );
      checks = forEachSystem (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          proveFeatGate =
            gate:
            pkgs.runCommand "prove-feat-${gate}"
              {
                nativeBuildInputs = [ self.packages.${system}.prove-feat ];
              }
              ''
                mkdir -p "$out"
                prove-feat --root ${self} --system ${system} --gate ${gate} --json > "$out/report.json"
                grep -q '"ok": true' "$out/report.json"
              '';
          proveFeatStructure = proveFeatGate "structure";
          proveFeatFormat = proveFeatGate "format";
          proveFeatDeadnix = proveFeatGate "deadnix";
          proveFeatContractLint = proveFeatGate "contract-lint";
        in
        {
          prove-feat-structure = proveFeatStructure;
          prove-feat-format = proveFeatFormat;
          prove-feat-deadnix = proveFeatDeadnix;
          prove-feat-contract-lint = proveFeatContractLint;
          prove-feat =
            pkgs.runCommand "prove-feat-check"
              {
                nativeBuildInputs = [ self.packages.${system}.prove-feat ];
              }
              ''
                mkdir -p "$out"
                test -e ${proveFeatStructure}
                test -e ${proveFeatFormat}
                test -e ${proveFeatDeadnix}
                test -e ${proveFeatContractLint}
                prove-feat --root ${self} --system ${system} --json > "$out/report.json"
                grep -q '"ok": true' "$out/report.json"
              '';
          ops-artifact-materialize =
            pkgs.runCommand "ops-artifact-materialize-check"
              {
                nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-artifact-materialize ];
              }
              ''
                mkdir -p "$out/restored"
                ops-artifact-materialize \
                  --input ${./packages/ops-artifact-materialize/tests/sample-thread.txt} \
                  --out-dir "$out/restored" \
                  --strict-count \
                  --json > "$out/result.json"
                test "$(cat "$out/restored/hello.txt")" = "ok"
                grep -q '"ok": true' "$out/restored/MATERIALIZE_MANIFEST.json"
              '';
          ops-knowledge-intake =
            pkgs.runCommand "ops-knowledge-intake-check"
              {
                nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-knowledge-intake ];
              }
              ''
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
          package-architecture-map =
            pkgs.runCommand "package-architecture-map-check"
              {
                nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.package-architecture-map ];
              }
              ''
                mkdir -p "$out"
                package-architecture-map \
                  --inventory ${./packages/package-architecture-map/tests/a2ui-agent-status.inventory.json} \
                  --out-dir "$out/dist" \
                  --name a2ui-agent-status > "$out/stdout.json"
                package-architecture-map \
                  --inventory ${./packages/package-architecture-map/tests/a2ui-agent-status.inventory.json} \
                  --validate-only > "$out/valid.json"
                test -s "$out/dist/latest.mmd"
                test -s "$out/dist/maps/a2ui-agent-status.mmd"
                test -s "$out/dist/index.html"
                test -s "$out/dist/manifest.json"
                grep -q '"ok": true' "$out/valid.json"
                grep -q 'subgraph workspace' "$out/dist/latest.mmd"
                grep -q 'agent-status-view' "$out/dist/latest.mmd"
                grep -q 'future-only' "$out/dist/latest.mmd"
                grep -q 'forbidden: canonical state' "$out/dist/latest.mmd"
                grep -q '"generatedIsAuthority": false' "$out/dist/manifest.json"
                ! package-architecture-map \
                  --inventory ${./packages/package-architecture-map/tests/invalid-edge.inventory.json} \
                  --validate-only > "$out/invalid.stdout" 2> "$out/invalid.json"
                grep -q '"ok": false' "$out/invalid.json"
                grep -q 'edge to references unknown node: missing' "$out/invalid.json"
                package-architecture-map \
                  ${./packages/package-architecture-map/tests/a2ui-agent-status.inventory.json} \
                  --stdout > "$out/stdout.mmd"
                cmp "$out/stdout.mmd" "$out/dist/latest.mmd"
              '';
          ops-runbook-checks =
            pkgs.runCommand "ops-runbook-checks-check"
              {
                nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-runbook-checks ];
              }
              ''
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
                mkdir -p "$out/issue-ledger"
                cat > "$out/issue-ledger/current.jsonl" <<'EOF'
                {"kind":"issue.record.v1","schemaVersion":"v1","recordId":"ops-runbook-checks-fixture-opened","issueId":"ops.runbook-checks-fixture","recordedAt":"2026-05-27T00:00:00+00:00","recordType":"opened","status":"open","title":"Fixture issue","issueKind":"test","sourceRepo":"ops","targetRepo":"ops","priority":"P3","suggestedBranch":"codex/fixture","dependsOn":[],"allowedPaths":["issues/**"],"forbiddenActions":["Do not use this fixture as approval."],"closeCriteria":["Fixture close criterion."],"requiredEvidence":["Fixture evidence."],"supersedes":[],"evidence":["fixture"]}
                {"kind":"issue.record.v1","schemaVersion":"v1","recordId":"ops-runbook-checks-fixture-closed","issueId":"ops.runbook-checks-fixture","recordedAt":"2026-05-27T00:01:00+00:00","recordType":"closed","status":"closed","title":"Fixture issue","issueKind":"test","sourceRepo":"ops","targetRepo":"ops","priority":"P3","suggestedBranch":"codex/fixture","dependsOn":[],"allowedPaths":["issues/**"],"forbiddenActions":["Do not use this fixture as approval."],"closeCriteria":["Fixture close criterion."],"requiredEvidence":["Fixture evidence."],"supersedes":["ops-runbook-checks-fixture-opened"],"evidence":["fixture"],"closure":{"closedAt":"2026-05-27T00:01:00+00:00","satisfiedCloseCriteria":["Fixture close criterion."],"evidence":["fixture"]}}
                EOF
                cat > "$out/issue-ledger/legacy.jsonl" <<'EOF'
                {"id":"legacy-fixture","status":"open","kind":"legacy"}
                EOF
                ops-runbook-checks \
                  --issue-ledger "$out/issue-ledger/current.jsonl" \
                  --legacy-glob "$out/issue-ledger/*.jsonl" \
                  --json > "$out/issue-ledger-fsck.json"
                grep -q '"classification": "issue-ledger-fsck-pass"' "$out/issue-ledger-fsck.json"
                grep -q '"legacyOrNonV1Records": 1' "$out/issue-ledger-fsck.json"
                grep -q '"ops.runbook-checks-fixture"' "$out/issue-ledger-fsck.json"
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
          ops-handoff-core =
            pkgs.runCommand "ops-handoff-core-check"
              {
                nativeBuildInputs = [
                  pkgs.python3
                  pkgs.gnugrep
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-handoff-core
                ];
              }
              ''
                mkdir -p "$out/generated"
                python3 -m py_compile ${./packages/ops-handoff-core/bin/ops-handoff-core.py}
                python3 -S ${./packages/ops-handoff-core/tests/test_ops_handoff_core.py} \
                  ${./packages/ops-handoff-core} "$out/python-test"
                ops-handoff-core generate \
                  --role-catalog ${./packages/ops-handoff-core/tests/fixtures/role-catalog.md} \
                  --topology ${./packages/ops-handoff-core/tests/fixtures/organization-topology.a2ui.jsonl} \
                  --command-board ${./packages/ops-handoff-core/tests/fixtures/command-board.a2ui.jsonl} \
                  --request ${./packages/ops-handoff-core/tests/fixtures/REQUEST.md} \
                  --source-manifest ${./packages/ops-handoff-core/tests/fixtures/source-manifest.json} \
                  --runtime-manifest ${./packages/ops-handoff-core/tests/fixtures/runtime-manifest.json} \
                  --merge-target ${./packages/ops-handoff-core/tests/fixtures/merge-target.json} \
                  --thread-roster ${./packages/ops-handoff-core/tests/fixtures/thread-roster.json} \
                  --out-dir "$out/generated/handoff" \
                  --json > "$out/generate.json"
                ops-handoff-core validate \
                  --handoff-dir "$out/generated/handoff" \
                  --no-role-body-sentinel FULL_ROLE_CATALOG_BODY_SENTINEL > "$out/validate.json"
                printf 'merge-review-pass\nok\n' > "$out/verdict.txt"
                printf '# run report\nok\n' > "$out/RUN_REPORT.md"
                printf 'artifact\n' > "$out/artifact.txt"
                ops-handoff-core import-result \
                  --thread-function merge-review \
                  --artifact "$out/artifact.txt" \
                  --run-report "$out/RUN_REPORT.md" \
                  --verdict-file "$out/verdict.txt" \
                  --claim-path "$out/result-claim.jsonl" \
                  --json > "$out/import.json"
                grep -q '"status": "handoff-generated"' "$out/generate.json"
                grep -q '"status": "handoff-valid"' "$out/validate.json"
                grep -q '"status": "handoff-result-imported"' "$out/import.json"
                grep -q '"localizerApproval": false' "$out/import.json"
                grep -q '"current": "handoff-created"' "$out/generated/handoff/HANDOFF_MANIFEST.json"
                grep -q '"terminal": false' "$out/generated/handoff/HANDOFF_MANIFEST.json"
                grep -q '"transportReadbackIsApproval": false' "$out/generated/handoff/HANDOFF_MANIFEST.json"
                test -s "$out/result-claim.jsonl"
                test -f "$out/generated/handoff/THREADS/impl-work/BOOTSTRAP.md"
                test -f "$out/generated/handoff/THREADS/impl-review/REVIEW_CHECKLIST.md"
                test -f "$out/generated/handoff/THREADS/merge-work/EXPECTED_OUTPUT.md"
                test -f "$out/generated/handoff/THREADS/merge-review/MERGE_REVIEW_CHECKLIST.md"
                grep -q 'threadFunction: impl-work' "$out/generated/handoff/THREADS/impl-work/BOOTSTRAP.md"
                grep -q 'threadFunction: impl-review' "$out/generated/handoff/THREADS/impl-review/BOOTSTRAP.md"
                grep -q 'threadFunction: merge-work' "$out/generated/handoff/THREADS/merge-work/BOOTSTRAP.md"
                grep -q 'threadFunction: merge-review' "$out/generated/handoff/THREADS/merge-review/BOOTSTRAP.md"
                ! grep -R FULL_ROLE_CATALOG_BODY_SENTINEL "$out/generated/handoff/THREADS"
                ! grep -R 'project-source-put\|project-thread-create\|project-artifact-fetch' "$out/generated/handoff/THREADS"
              '';
          ops-src-runtime-pack =
            pkgs.runCommand "ops-src-runtime-pack-check"
              {
                nativeBuildInputs = [
                  pkgs.git
                  pkgs.gnutar
                  pkgs.gzip
                  pkgs.nix
                  pkgs.python3
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-src-runtime-pack
                ];
              }
              ''
                mkdir -p "$out"
                python3 -m py_compile ${./packages/ops-src-runtime-pack/bin/ops-src-runtime-pack.py}
                python3 -S ${./packages/ops-src-runtime-pack/tests/test_ops_src_runtime_pack.py} \
                  ${./packages/ops-src-runtime-pack} "$out/python-test" > "$out/test.log"
              '';
          ops-thread-fsm =
            pkgs.runCommand "ops-thread-fsm-check"
              {
                nativeBuildInputs = [
                  pkgs.python3
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-thread-fsm
                ];
              }
              ''
                mkdir -p "$out"
                cp -R ${./packages/ops-thread-fsm} ./ops-thread-fsm-src
                chmod -R u+w ./ops-thread-fsm-src
                python3 -S ./ops-thread-fsm-src/tests/test_ops_thread_fsm.py > "$out/test.log"
                ops-thread-fsm next --state-kind request-sent --dry-run --json > "$out/next.json"
                ops-thread-fsm next --state-kind handoff-created --dry-run --json > "$out/handoff-created.json"
                printf '{"policyFresh":true,"canonicalNoDrift":true,"mergeReviewPass":true,"localGatePass":true,"runReportPresent":true}\n' > "$out/localize-input.json"
                ops-thread-fsm classify-localize --input "$out/localize-input.json" --json > "$out/localize-ready.json"
                grep -q '"writes": false' "$out/next.json"
                grep -q '"stateKind": "localizer-ready"' "$out/localize-ready.json"
                grep -q 'non-terminal' "$out/handoff-created.json"
                grep -q 'sleep 900' "$out/next.json"
                cat > "$out/discussion.json" <<'EOF'
                {
                  "discussionId": "d1",
                  "proposalRevision": "r3",
                  "noObjectionsRequiredFrom": ["A", "B"],
                  "responses": [
                    {"actorId": "A", "proposalRevision": "r3", "verdict": "NO_UNRESOLVED_OBJECTIONS"},
                    {"actorId": "B", "proposalRevision": "r3", "verdict": "NO_UNRESOLVED_OBJECTIONS"}
                  ]
                }
                EOF
                ops-thread-fsm check-discussion --input "$out/discussion.json" --json > "$out/discussion-result.json"
                grep -q '"classification": "discussion-no-objections-confirmed"' "$out/discussion-result.json"
                touch "$out/done"
              '';
          ops-tailnet-github-egress =
            pkgs.runCommand "ops-tailnet-github-egress-check"
              {
                nativeBuildInputs = [
                  pkgs.git
                  pkgs.python3
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-tailnet-github-egress
                  self.packages.${pkgs.stdenv.hostPlatform.system}.git-push-tailnet
                  pkgs.gnugrep
                ];
              }
              ''
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
          ops-refs-vault =
            pkgs.runCommand "ops-refs-vault-check"
              {
                nativeBuildInputs = [
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-refs-vault
                  pkgs.gnugrep
                ];
              }
              ''
                mkdir -p "$out"
                ops-refs-vault smoke-local > "$out/report.json"
                grep -q '"ok": true' "$out/report.json"
                for proof in P01 P02 P03 P04 P05 P06 P07 P08 P09 P10 P11; do
                  grep -q "\"id\": \"$proof\"" "$out/report.json"
                done
              '';
          ops-cdp-core =
            pkgs.runCommand "ops-cdp-core-check"
              {
                nativeBuildInputs = [
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-cdp-core
                  pkgs.python3
                ];
              }
              ''
                mkdir -p "$out"
                HQ_CDP_SCRIPT_SRC=${./packages/ops-cdp-core/src/cdp} \
                  python3 ${./packages/ops-cdp-core/src/cdp/test-project-transport-regressions.py} > "$out/project-transport-regressions.txt"
                chromium-cdp-chatgpt-command-map > "$out/chatgpt-command-map.md"
                grep -q 'chromium-cdp-upload-project-source-text' "$out/chatgpt-command-map.md"
                grep -q 'chromium-cdp-create-project-thread' "$out/chatgpt-command-map.md"
                test -s ${./packages/ops-cdp-core/_incoming/proof-tree-extraction-inventory.tsv}
                test -s ${./packages/ops-cdp-core/_incoming/proof-tree-source-files.tsv}
                test -s ${./packages/ops-cdp-core/_incoming/rejected-raw-source-boundary.tsv}
                grep -q 'ops-handoff-core split boundary' ${./packages/ops-cdp-core/_incoming/proof-tree-extraction-inventory.tsv}
                grep -q 'ops-src-runtime-pack split boundary' ${./packages/ops-cdp-core/_incoming/proof-tree-extraction-inventory.tsv}
                grep -q 'browser profile directories' ${./packages/ops-cdp-core/_incoming/rejected-raw-source-boundary.tsv}
                test -x "$(command -v chromium-cdp-upload-project-source-text)"
                test -x "$(command -v chromium-cdp-upload-project-source-file)"
                test -x "$(command -v chromium-cdp-project-source-list)"
                test -x "$(command -v chromium-cdp-project-source-delete)"
                test -x "$(command -v chromium-cdp-project-access-probe)"
                test -x "$(command -v chromium-cdp-create-project-thread)"
                test -x "$(command -v chromium-cdp-send-chatgpt)"
                test -x "$(command -v chromium-cdp-project-source-reread)"
                test -x "$(command -v chromium-cdp-fetch-artifact-strict)"
                test -x "$(command -v project-transport-doctor)"
                test -x "$(command -v project-transport-env)"
                test -x "$(command -v project-source-put)"
                test -x "$(command -v project-source-put-classify-examples)"
                test -x "$(command -v project-source-list)"
                test -x "$(command -v project-source-delete)"
                test -x "$(command -v project-thread-create)"
                test -x "$(command -v project-thread-send)"
                test -x "$(command -v project-thread-readback)"
                test -x "$(command -v project-artifact-fetch)"
                test -x "$(command -v project-transport-claim)"
                test -x "$(command -v project-handoff-preflight)"
                test -x "$(command -v project-transport-run)"
                test -x "$(command -v chromium-cdp-profile-seed)"
                test -x "$(command -v chromium-cdp-profile-login-complete)"
                test -x "$(command -v chromium-cdp-profile-publish)"
                test -x "$(command -v chromium-cdp-profile-runtime-copy)"
                test -x "$(command -v cdp-bridge)"
                cdp-bridge --help > "$out/cdp-bridge-help.txt" 2>&1
                grep -q 'cdp-bridge wsurl' "$out/cdp-bridge-help.txt"
                grep -q 'click-mode direct' "$out/cdp-bridge-help.txt"
                mkdir -p "$out/transport"
                printf 'hello\n' > "$out/transport/source.txt"
                printf 'use Project Source artifact\n' > "$out/transport/prompt.txt"
                cat > "$out/transport/thread-roster.json" <<'EOF'
                {
                  "threads": [
                    {"actorId":"actor.chatgpt.impl-work","parentActor":"actor.codex.project","threadFunction":"impl-work"},
                    {"actorId":"actor.chatgpt.impl-review","parentActor":"actor.codex.project","threadFunction":"impl-review"},
                    {"actorId":"actor.chatgpt.merge-work","parentActor":"actor.codex.project","threadFunction":"merge-work"},
                    {"actorId":"actor.chatgpt.merge-review","parentActor":"actor.codex.project","threadFunction":"merge-review"}
                  ]
                }
                EOF
                project-transport-doctor --offline --out-path "$out/transport/doctor.json" > "$out/transport/doctor.stdout"
                ! project-transport-doctor --offline --project-url 'https://chatgpt.com/g/g-p-test/project' --out-path "$out/transport/doctor-offline-project.json" > "$out/transport/doctor-offline-project.stdout"
                project-transport-doctor --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --out-path "$out/transport/doctor-project-dry-run.json" > "$out/transport/doctor-project-dry-run.stdout"
                ! project-transport-env --ports 1 --project-url 'https://chatgpt.com/g/g-p-test/project' --out-path "$out/transport/env-no-port.json" > "$out/transport/env-no-port.stdout"
                project-source-put --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --file "$out/transport/source.txt" --out-dir "$out/transport" > "$out/transport/source-put.json"
                project-source-put --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project?tab=sources' --file "$out/transport/source.txt" --out-dir "$out/transport" > "$out/transport/source-put-sources-tab.json"
                project-source-put-classify-examples > "$out/transport/source-put-classify-examples.json"
                ! project-source-put --project-url 'https://example.com/not-a-project' --file "$out/transport/source.txt" --out-dir "$out/transport" > "$out/transport/source-put-wrong-url.json"
                ! project-source-put --project-url 'https://chatgpt.com/g/g-p-test/project' --file "$out/transport/missing.txt" --out-dir "$out/transport" > "$out/transport/source-put-missing-file.json"
                project-source-list --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --out-dir "$out/transport" > "$out/transport/source-list.json"
                project-source-delete --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --title old.md --reason 'test dry run' --out-dir "$out/transport" > "$out/transport/source-delete-dry-run.json"
                ! project-source-delete --project-url 'https://chatgpt.com/g/g-p-test/project' --title old.md --reason 'test requires explicit remove flag' --out-dir "$out/transport" > "$out/transport/source-delete-denied.json"
                project-thread-create --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --text-file "$out/transport/prompt.txt" --out-dir "$out/transport" > "$out/transport/thread-create.json"
                ! project-thread-create --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project?tab=sources' --text-file "$out/transport/prompt.txt" --out-dir "$out/transport" > "$out/transport/thread-create-sources-tab.json"
                project-thread-send --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --project-url 'https://chatgpt.com/g/g-p-test/project' --text 'artifact: source.txt' --out-dir "$out/transport" > "$out/transport/thread-send.json"
                ! project-thread-send --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --text "$(python3 - <<'PY'
                print('x' * 2100)
                PY
                )" --out-dir "$out/transport" > "$out/transport/thread-send-long.json"
                project-thread-readback --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --id target-test --markers source.txt --out-dir "$out/transport" > "$out/transport/readback.json"
                project-artifact-fetch --dry-run --name result.zip --url 'https://chatgpt.com/g/g-p-test/c/test' --out-dir "$out/transport" > "$out/transport/artifact-fetch.json"
                project-handoff-preflight \
                  --dry-run \
                  --project-url 'https://chatgpt.com/g/g-p-test/project' \
                  --thread-roster "$out/transport/thread-roster.json" \
                  --source-file "$out/transport/source.txt" \
                  --bootstrap-artifact "$out/transport/prompt.txt" \
                  --expected-artifact result.zip \
                  --out-dir "$out/transport" > "$out/transport/handoff-preflight.json"
                project-transport-run --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --source-file "$out/transport/source.txt" --prompt-file "$out/transport/prompt.txt" --out-dir "$out/transport/run" > "$out/transport/run.json"
                ! project-transport-run --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project?tab=sources' --source-file "$out/transport/source.txt" --prompt-file "$out/transport/prompt.txt" --out-dir "$out/transport/run-wrong-shape" > "$out/transport/run-wrong-shape.json"
                project-transport-claim --input "$out/transport/run/transport-result.json" --claim-path "$out/transport/claim.jsonl" > "$out/transport/claim.json"
                mkdir -p "$out/profile"
                chromium-cdp-profile-seed --profile-dir "$out/profile/seed" > "$out/transport/profile-seed.json"
                touch "$out/profile/seed/Local State"
                chromium-cdp-profile-login-complete --profile-dir "$out/profile/seed" > "$out/transport/profile-login-complete.json"
                ! chromium-cdp-profile-publish --profile-dir "$out/profile/seed" --snapshot-dir "$out/profile/snapshot" > "$out/transport/profile-publish-denied.json"
                chromium-cdp-profile-publish --profile-dir "$out/profile/seed" --snapshot-dir "$out/profile/snapshot" --allow-copy > "$out/transport/profile-publish.json"
                chromium-cdp-profile-runtime-copy --snapshot-dir "$out/profile/snapshot" --runtime-dir "$out/profile/runtime" > "$out/transport/profile-runtime-copy.json"
                grep -q '"status": "dry-run-ready"' "$out/transport/handoff-preflight.json"
                grep -q '"threadAttachmentFallbackAllowed": false' "$out/transport/handoff-preflight.json"
                test -f "$out/transport/run/TRANSPORT_RUN_REPORT.md"
                test -f "$out/transport/run/TRANSPORT_RUN_INDEX.md"
                test -f "$out/transport/run/TRANSPORT_RUN_MANIFEST.json"
                test -f "$out/transport/run/TRANSPORT_STATUS.jsonl"
                test -f "$out/transport/run/TRANSPORT_KNOWLEDGE.jsonl"
                test -f "$out/transport/run/ARTIFACTS_MANIFEST.json"
                test -f "$out/transport/run/transport-result.snapshot.json"
                test -f "$out/transport/run/SHA256SUMS.tsv"
                test -f "$out/transport/run-wrong-shape/TRANSPORT_RUN_INDEX.md"
                test -f "$out/transport/run-wrong-shape/TRANSPORT_RUN_MANIFEST.json"
                test -f "$out/transport/run-wrong-shape/transport-result.snapshot.json"
                test -f "$out/transport/run-wrong-shape/SHA256SUMS.tsv"
                test -s "$out/transport/claim.jsonl"
                grep -q '"semanticApproval": false' "$out/transport/run/transport-result.json"
                grep -q '"completionApproval": false' "$out/transport/run/transport-result.json"
                grep -q '"routeDecision": false' "$out/transport/run/transport-result.json"
                grep -q '"manualCollationRequired": false' "$out/transport/run/TRANSPORT_RUN_MANIFEST.json"
                grep -q 'TRANSPORT_RUN_INDEX.md' "$out/transport/run/TRANSPORT_RUN_MANIFEST.json"
                grep -q 'transport-result.snapshot.json' "$out/transport/run/TRANSPORT_RUN_MANIFEST.json"
                ! grep -q '"path": "transport-result.json"' "$out/transport/run/TRANSPORT_RUN_MANIFEST.json"
                grep -q 'TRANSPORT_RUN_MANIFEST.json' "$out/transport/run/SHA256SUMS.tsv"
                grep -q 'TRANSPORT_RUN_INDEX.md' "$out/transport/run/SHA256SUMS.tsv"
                grep -q 'transport-result.snapshot.json' "$out/transport/run/SHA256SUMS.tsv"
                ! grep -q $'\ttransport-result.json' "$out/transport/run/SHA256SUMS.tsv"
                grep -q 'TRANSPORT_RUN_INDEX.md' "$out/transport/run-wrong-shape/TRANSPORT_RUN_MANIFEST.json"
                grep -q 'transport-result.snapshot.json' "$out/transport/run-wrong-shape/TRANSPORT_RUN_MANIFEST.json"
                ( cd "$out/transport/run" && awk -F '\t' '{print $1 "  " $2}' SHA256SUMS.tsv | sha256sum -c - )
                ( cd "$out/transport/run-wrong-shape" && awk -F '\t' '{print $1 "  " $2}' SHA256SUMS.tsv | sha256sum -c - )
                grep -q 'transport evidence only' "$out/transport/run/TRANSPORT_RUN_INDEX.md"
                grep -q '"threadAttachmentFallbackAllowed": false' "$out/transport/source-put.json"
                grep -q 'project-url-wrong-shape' "$out/transport/source-put-wrong-url.json"
                grep -q 'local-file-validation-failed' "$out/transport/source-put-missing-file.json"
                grep -q 'local-file-validation-failure' "$out/transport/source-put-missing-file.json"
                grep -q '"ok": true' "$out/transport/source-put-classify-examples.json"
                grep -q 'project-access-profile-missing' "$out/transport/source-put-classify-examples.json"
                grep -q 'source-page-not-loaded' "$out/transport/source-put-classify-examples.json"
                grep -q 'source-upload-interaction-failed' "$out/transport/source-put-classify-examples.json"
                grep -q 'source-upload-visibility-readback-failed' "$out/transport/source-put-classify-examples.json"
                grep -q 'source-upload-unknown-failed' "$out/transport/source-put-classify-examples.json"
                grep -q 'dry-run-ready' "$out/transport/source-list.json"
                grep -q 'dry-run-ready' "$out/transport/source-delete-dry-run.json"
                grep -q 'remove-not-authorized' "$out/transport/source-delete-denied.json"
                grep -q 'project-url-wrong-shape' "$out/transport/thread-create-sources-tab.json"
                grep -q 'project-url-wrong-shape' "$out/transport/run-wrong-shape.json"
                grep -q 'inline-too-long' "$out/transport/thread-send-long.json"
                grep -q 'offline-project-route-unverified' "$out/transport/doctor-offline-project.json"
                grep -q 'project-probe-dry-run-ready' "$out/transport/doctor-project-dry-run.json"
                grep -q 'no-cdp-port-reachable' "$out/transport/env-no-port.json"
                grep -q 'profile-seed-ready' "$out/transport/profile-seed.json"
                grep -q 'profile-login-complete-observed' "$out/transport/profile-login-complete.json"
                grep -q 'publish-not-authorized' "$out/transport/profile-publish-denied.json"
                grep -q 'profile-snapshot-published' "$out/transport/profile-publish.json"
                grep -q 'runtime-profile-ready' "$out/transport/profile-runtime-copy.json"
                grep -q '"sourceMutated": false' "$out/transport/profile-runtime-copy.json"
              '';
          ops-bootstrap = pkgs.runCommand "ops-bootstrap-check" { } ''
            test -e ${self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap}/share/ops/README
            touch $out
          '';
        }
      );
    };
}
