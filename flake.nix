{
  description = "ops: operational packages implementing governance contracts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    governance = {
      url = "git+file:///home/nixos/repos/governance?ref=refs/heads/main&rev=573b32b4320df3ea065e84d0b664da718d2d378c";
      flake = false;
    };
    # 分離可能な build 定義 package(append-only jsonl -> nix snapshot/module)。
    # flake.lock が snapshot。defs.jsonl 追記後 `nix flake update ops-build-defs` で再 snapshot。
    # 将来 ops から分離する場合は url を ssh://…/ops-build-defs.git に差し替えるのみ。
    ops-build-defs = {
      url = "path:./packages/ops-build-defs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # G2 nodejs-only: node26 を nixpkgs(max nodejs_25)ではなく git+https から取得 (DEC-20260604-node26-via-git-https-from-source)。
    # nodejs/node に flake.nix は無いため flake=false のソース入力 + 自前 derivation(ソースビルド)。
    # v26.3.0 を commit rev で pin し可変タグの供給網リスクを排除 (DC-N-05)。
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
      ops-build-defs,
      nodejs-src,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      lib = nixpkgs.lib;
      cdpFor =
        pkgs: (import ./packages/ops-cdp-core/src/cdp/chromium-cdp.nix { }).perSystem { inherit pkgs; };
      # 汎用 jsonl インタプリタ(Phase B / 完成系 goal ②)。
      # build/*.jsonl の宣言を fold して packages/checks を生成する。flake.nix は一度だけ書き、
      # package 追加 = build/packages.jsonl に 1 行 + .mjs(per-package 手書き derivation なし)。
      # pure-eval / IFD なし: builtins.readFile + builtins.fromJSON のみ(import-from-derivation 不使用)。
      srcRoot = ./.;
      readJsonl =
        path:
        map builtins.fromJSON (
          builtins.filter (l: l != "") (lib.splitString "\n" (builtins.readFile path))
        );
      runtimeDecls = readJsonl ./build/runtime.jsonl;
      packageDecls = readJsonl ./build/packages.jsonl;
      checkDecls = readJsonl ./build/checks.jsonl;
      # runtime id -> nixpkgs attr 名(例: node -> nodejs)。
      runtimeAttrById = builtins.listToAttrs (
        map (r: {
          name = r.id;
          value = r.from;
        }) runtimeDecls
      );
      # build/*.jsonl から system ごとの packages を生成する。
      # genPkgs は rec: ops package 同士の依存(他 ops package を deps トークンで参照)を解決する。
      mkGeneratedPackages =
        pkgs:
        let
          # runtime id -> その runtime derivation(build/runtime.jsonl 由来)。
          #   node   -> pkgs.nodejs,  python -> pkgs.python3
          runtimeDrvById = builtins.mapAttrs (_id: attr: pkgs.${attr}) runtimeAttrById;
          # 各 runtime の exec 前置(decl.runtime が選択する): entry を起動する binary。
          runtimeExecById = {
            node = rt: entry: ''exec ${rt}/bin/node ${entry} "$@"'';
            python = rt: entry: ''exec ${rt}/bin/python3 ${entry} "$@"'';
          };
          # dep トークンを derivation に解決:
          #   "node" / "python" -> その runtime derivation
          #   生成 package 名    -> その package(他 ops package への依存)
          #   それ以外           -> nixpkgs attr(dotted path 可: "glibc.bin")
          resolveDep =
            genPkgs: dep:
            if builtins.hasAttr dep runtimeDrvById then
              runtimeDrvById.${dep}
            else if builtins.hasAttr dep genPkgs then
              genPkgs.${dep}
            else
              lib.getAttrFromPath (lib.splitString "." dep) pkgs;
          # env 宣言を export 行に: {name,path} は source path を store path へ、{name,value} は literal。
          envLine =
            e:
            if e ? path then
              ''export ${e.name}="${srcRoot + "/${e.path}"}"''
            else
              ''export ${e.name}="${e.value}"'';
          # entry(repo 相対, packages/<dir>/bin/<file>.mjs)を package source DIR + DIR 内 path に分解。
          # DIR ごと store に入れることで bin/*.mjs が sibling(../lib/*.mjs)を import.meta.url 経由で
          # 解決できる(例: ops-thread-fsm の bin -> ../lib/cli.mjs)。
          entryDirOf = entry: lib.concatStringsSep "/" (lib.init (lib.init (lib.splitString "/" entry)));
          entryRelOf =
            entry:
            let
              parts = lib.splitString "/" entry;
              n = builtins.length parts;
            in
            lib.concatStringsSep "/" (lib.sublist (n - 2) 2 parts);
          mkPackage =
            genPkgs: decl:
            let
              envText = lib.concatMapStringsSep "\n" envLine decl.env;
              pkgDir = srcRoot + "/${entryDirOf decl.entry}";
              entryRel = entryRelOf decl.entry;
              # decl.runtime が exec 前置と runtime derivation を選択(node / python)。
              rt = runtimeDrvById.${decl.runtime};
              execLine =
                if decl ? pythonModule then
                  ''
                    export PYTHONPATH="${pkgDir}/${decl.pythonPath or "src"}''${PYTHONPATH:+:$PYTHONPATH}"
                    exec ${rt}/bin/python3 -m ${decl.pythonModule} "$@"''
                else
                  runtimeExecById.${decl.runtime} rt "${pkgDir}/${entryRel}";
            in
            pkgs.writeShellApplication {
              name = decl.bin;
              runtimeInputs = map (resolveDep genPkgs) decl.deps;
              text = (if decl.env == [ ] then "" else envText + "\n") + execLine;
            };
        in
        lib.fix (
          genPkgs:
          builtins.listToAttrs (
            map (decl: {
              name = decl.name;
              value = mkPackage genPkgs decl;
            }) packageDecls
          )
        );
      # build/checks.jsonl から system ごとの checks を生成する(node script を実行し self-assert)。
      # deps: 生成 package 名 -> その package(PATH 投入)/ それ以外 -> nixpkgs attr。
      mkGeneratedChecks =
        pkgs: genPkgs:
        let
          resolveCheckDep =
            dep:
            if builtins.hasAttr dep genPkgs then
              genPkgs.${dep}
            else
              lib.getAttrFromPath (lib.splitString "." dep) pkgs;
        in
        builtins.listToAttrs (
          map (decl: {
            name = decl.name;
            value =
              pkgs.runCommand "${decl.name}-check" { nativeBuildInputs = map resolveCheckDep decl.deps; }
                ''
                  mkdir -p "$out"
                  node ${srcRoot + "/${decl.script}"}
                  touch "$out/ok"
                '';
          }) checkDecls
        );
      # node26 を git+https ソースからビルド。nixpkgs の nodejs ビルド式(_25=直近 major)を
      # 土台に src/version を差し替える標準手法。major またぎで旧 patch は適合しないため除去 (DC-N-03)。
      # 注: ソースビルドは build-time に python/gyp 等を要する (DC-N-02) — これは builder toolchain であり
      # 'node-only' の runtime purity 対象外 (DC-M-08 の境界定義に従う)。
      nodejs26For =
        pkgs:
        pkgs.nodejs_25.overrideAttrs (_: {
          pname = "nodejs";
          version = "26.3.0";
          src = nodejs-src;
          patches = [ ];
        });
    in
    {
      packages = forEachSystem (
        pkgs:
        let
          cdp = cdpFor pkgs;
          # ★goal ②: 通常 package(11 本中の node CLI 群)は build/packages.jsonl の fold で生成。
          # per-package 手書き derivation なし。下の explicit 群は schema に収まらない特例のみ。
          generated = mkGeneratedPackages pkgs;
          # specsless: catalog/placement は unified governance repo(SSOT jsonl + bridge tool)
          # から導出する(records/ が権威台帳、tools/ が projection 関数)。
          # C3 CUE 一本化: catalog 生成の前段 blocking gate は cue vet のみ
          # (governance 自身の flake check と同一形の宣言駆動プラミング)。
          # ${governance}/policy/interface.json が {file, def, group, required} を宣言し、
          #   (a) def を持つ各 file を cue vet ${governance}/policy/cue/*.cue <file> -d '<def>'
          #   (b) group 付き file 群を 1 つの labeled JSON に束ねて -d '#All' で関係制約を vet
          # 検査ロジックは全て governance の policy/cue/ 側。required:false の file は
          # 存在しなければ skip(adrs 梯子 binding は ${governance} に file が無い)。
          # records-gate.py は REPORT 専用に退役し、ここでは実行しない。
          # gate 赤 = この derivation が fail = catalog/placement は生成されない。
          specCatalog =
            pkgs.runCommand "spec-catalog"
              {
                nativeBuildInputs = [
                  pkgs.python3
                  pkgs.cue
                ];
              }
              ''
                set -euo pipefail
                export HOME="$TMPDIR"
                cd ${governance}
                python3 -c 'import json,os; e=json.load(open("policy/interface.json")); m=[x["file"] for x in e if x.get("required") and not os.path.exists(x["file"])]; assert not m, "missing required record files: %s" % m; print("\n".join(x["file"]+" "+x["def"] for x in e if x.get("def") and os.path.exists(x["file"])))' > "$TMPDIR/per-file-defs"
                while read -r file def; do
                  cue vet policy/cue/*.cue "$file" -d "$def"
                done < "$TMPDIR/per-file-defs"
                python3 -c 'import json,os; e=json.load(open("policy/interface.json")); g=sorted({x["group"] for x in e if x.get("group")}); print(json.dumps({k: [json.loads(l) for x in e if x.get("group")==k and os.path.exists(x["file"]) for l in open(x["file"], encoding="utf-8") if l.strip()] for k in g}))' > "$TMPDIR/relational-all.json"
                cue vet policy/cue/*.cue "$TMPDIR/relational-all.json" -d '#All'
                echo "spec-catalog gate: cue vet PASS (per-file + relational)"
                python3 ${governance}/tools/make-spec-catalog.py ${governance} --out-dir $out/share/spec
              '';
        in
        generated
        // rec {
          # ops 自己完結 PoC(.dev 廃止し ops 本体へ統合): jsonl を入力に package のみを生成。
          # KISS/DRY/SOLID/YAGNI 徹底。consume は checks.poc-consumes。
          poc-from-jsonl = pkgs.runCommand "poc-from-jsonl" { nativeBuildInputs = [ pkgs.jq ]; } ''
            mkdir -p "$out"
            jq -s '{ count: length, ids: [ .[].id ] }' ${./packages/ops-selfcontained-poc/data.jsonl} > "$out/result.json"
          '';
          # ops-build-defs(分離可能 package)を consume して ops を build する。
          # snapshot package を再公開 + nix module(lib.snapshot)から環境を構成(pure-eval, IFD なし)。
          ops-build-defs-snapshot = ops-build-defs.packages.${pkgs.stdenv.hostPlatform.system}.snapshot;
          ops-tools-from-defs = pkgs.buildEnv {
            name = "ops-tools-from-defs";
            paths = map (a: pkgs.${a}) ops-build-defs.lib.snapshot.nixpkgAttrs;
          };
          # G2: nodejs-only 移行の runtime 基盤。git+https 取得の node v26.3.0。
          nodejs26 = nodejs26For pkgs;
          # 特例: prove-feat は env が flake input(governance bridge)由来の
          # store path 参照であり build/packages.jsonl の静的 path/value schema に
          # 収まらないため explicit に残す。
          prove-feat = pkgs.writeShellApplication {
            name = "prove-feat";
            runtimeInputs = [
              pkgs.deadnix
              pkgs.git
              pkgs.nixfmt
              pkgs.nodejs
            ];
            text = ''
              export PROVE_FEAT_SPEC_CATALOG="${specCatalog}/share/spec/package-catalog.json"
              export PROVE_FEAT_SPEC_PLACEMENT_TABLE="${specCatalog}/share/spec/placement-table.json"
              exec ${pkgs.nodejs}/bin/node ${./packages/prove-feat/bin/prove-feat.mjs} "$@"
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
          # ★goal ②: build/checks.jsonl の fold で生成する simple node-script check。
          # deps は ops package 名 -> self.packages の該当 package(PATH 投入)/ それ以外 -> nixpkgs attr。
          generatedChecks = mkGeneratedChecks pkgs self.packages.${system};
        in
        generatedChecks
        // {
          # ops 本体 flake が jsonl 由来 package を consume = ops 自己完結の閉路(外部 input なし)
          poc-consumes = pkgs.runCommand "poc-consumes" { nativeBuildInputs = [ pkgs.jq ]; } ''
            got=$(jq -r '.count' ${self.packages.${system}.poc-from-jsonl}/result.json)
            want=$(jq -s 'length' ${./packages/ops-selfcontained-poc/data.jsonl})
            test "$got" = "$want"
            mkdir -p "$out"
            echo "closed: count=$got matches jsonl ($want) — ops self-contained (no .dev, no external input)" > "$out/proof.txt"
          '';
          # gate #5: repo-wide node-only purity。logic 層に *.py/*.pyc/*.zig/qjs: import/
          # python3・qjs 起動が混入したら fail(stray .pyc の再混入を CI で捕捉)。
          purity = pkgs.runCommand "ops-purity-check" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
            mkdir -p "$out"
            node ${./packages/ops-purity/bin/purity.mjs} ${./.} > "$out/report.txt"
          '';
          prove-feat-structure = proveFeatStructure;
          prove-feat-format = proveFeatFormat;
          prove-feat-deadnix = proveFeatDeadnix;
          prove-feat-contract-lint = proveFeatContractLint;
          ops-feat-input-continuity =
            pkgs.runCommand "ops-feat-input-continuity-check"
              {
                nativeBuildInputs = [
                  pkgs.gnugrep
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-feat-input-continuity
                ];
              }
              ''
                mkdir -p "$out" "$TMPDIR/feat-input-continuity"
                base_package_contract="$TMPDIR/feat-input-continuity/base-package-contract.v1.jsonl"
                synthetic_drop_base="$TMPDIR/feat-input-continuity/synthetic-drop-base.v1.jsonl"
                cp ${governance}/records/specs/package-contract.v1.jsonl "$base_package_contract"
                ops-feat-input-continuity \
                  --governance-root ${governance} \
                  --require-base \
                  --base-package-contract "$base_package_contract" \
                  > "$out/pass.log"
                grep -q 'accepted-set-non-decrease: PASS' "$out/pass.log"
                grep -q 'feat-input-continuity: PASS' "$out/pass.log"

                cp "$base_package_contract" "$synthetic_drop_base"
                chmod u+w "$synthetic_drop_base"
                printf '%s\n' '{"packageId":"__synthetic_removed_accepted__","status":"accepted"}' >> "$synthetic_drop_base"
                if ops-feat-input-continuity \
                  --governance-root ${governance} \
                  --require-base \
                  --base-package-contract "$synthetic_drop_base" \
                  > "$out/synthetic-drop.log" 2>&1; then
                  echo "synthetic accepted-package drop unexpectedly passed" >&2
                  exit 1
                fi
                grep -q '__synthetic_removed_accepted__' "$out/synthetic-drop.log"
                touch "$out/ok"
              '';
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
                  pkgs.nodejs
                  pkgs.gnugrep
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-handoff-core
                ];
              }
              ''
                mkdir -p "$out/generated"
                node --check ${./packages/ops-handoff-core/bin/ops-handoff-core.mjs}
                node ${./packages/ops-handoff-core/tests/test_ops_handoff_core.mjs} \
                  ${./packages/ops-handoff-core} "$out/node-test"
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
          # STAY-PY: ops-src-runtime-pack は tarfile/gzip 依存で py 据え置き(runtime:"python")。
          # check は package binary(python3 を exec する)経由で実 python ツールを走らせる。
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
                # 静的挙動テスト(python tool を sys.executable で起動)。
                python3 -S ${./packages/ops-src-runtime-pack/tests/test_ops_src_runtime_pack.py} \
                  ${./packages/ops-src-runtime-pack} "$out/py-test" > "$out/test.log"
                # 生成 package binary(python3 を exec する wrapper)自体を起動し real 挙動を実証。
                export HOME="$out/home"
                mkdir -p "$HOME"
                git init -q "$out/repo"
                git -C "$out/repo" config user.email "ops-src-runtime-pack@example.invalid"
                git -C "$out/repo" config user.name "ops-src-runtime-pack"
                printf 'fixture source\n' > "$out/repo/README.md"
                git -C "$out/repo" add README.md
                git -C "$out/repo" -c commit.gpgsign=false commit -q -m fixture
                ops-src-runtime-pack create \
                  --repo-root "$out/repo" \
                  --package-name fixture \
                  --installable .#fixture \
                  --metadata-only \
                  --out-dir "$out/pack" \
                  --json > "$out/create.json"
                ops-src-runtime-pack validate --pack-dir "$out/pack" --json > "$out/validate.json"
                grep -q '"status": "src-runtime-pack-created"' "$out/create.json"
                grep -q '"status": "src-runtime-pack-valid"' "$out/validate.json"
              '';
          ops-thread-fsm =
            pkgs.runCommand "ops-thread-fsm-check"
              {
                nativeBuildInputs = [
                  pkgs.nodejs
                  self.packages.${pkgs.stdenv.hostPlatform.system}.ops-thread-fsm
                ];
              }
              ''
                mkdir -p "$out"
                cp -R ${./packages/ops-thread-fsm} ./ops-thread-fsm-src
                chmod -R u+w ./ops-thread-fsm-src
                node --check ./ops-thread-fsm-src/bin/ops-thread-fsm.mjs
                node ./ops-thread-fsm-src/tests/test_ops_thread_fsm.mjs > "$out/test.log"
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
                nativeBuildInputs = [ self.packages.${pkgs.stdenv.hostPlatform.system}.ops-cdp-core ];
              }
              ''
                mkdir -p "$out"
                chromium-cdp-chatgpt-command-map > "$out/chatgpt-command-map.md"
                grep -q 'chromium-cdp-upload-project-source-text' "$out/chatgpt-command-map.md"
                grep -q 'chromium-cdp-create-project-thread' "$out/chatgpt-command-map.md"
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
                test -x "$(command -v project-source-list)"
                test -x "$(command -v project-source-delete)"
                test -x "$(command -v project-thread-create)"
                test -x "$(command -v project-thread-send)"
                test -x "$(command -v project-thread-readback)"
                test -x "$(command -v project-artifact-fetch)"
                test -x "$(command -v project-transport-claim)"
                test -x "$(command -v project-handoff-preflight)"
                test -x "$(command -v project-transport-run)"
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
                project-source-list --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --out-dir "$out/transport" > "$out/transport/source-list.json"
                project-source-delete --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --title old.md --reason 'test dry run' --out-dir "$out/transport" > "$out/transport/source-delete-dry-run.json"
                ! project-source-delete --project-url 'https://chatgpt.com/g/g-p-test/project' --title old.md --reason 'test requires explicit remove flag' --out-dir "$out/transport" > "$out/transport/source-delete-denied.json"
                project-thread-create --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project' --text-file "$out/transport/prompt.txt" --out-dir "$out/transport" > "$out/transport/thread-create.json"
                ! project-thread-create --dry-run --project-url 'https://chatgpt.com/g/g-p-test/project?tab=sources' --text-file "$out/transport/prompt.txt" --out-dir "$out/transport" > "$out/transport/thread-create-sources-tab.json"
                project-thread-send --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --project-url 'https://chatgpt.com/g/g-p-test/project' --text 'artifact: source.txt' --out-dir "$out/transport" > "$out/transport/thread-send.json"
                ! project-thread-send --dry-run --url 'https://chatgpt.com/g/g-p-test/c/test' --text "$(head -c 2100 /dev/zero | tr '\0' x)" --out-dir "$out/transport" > "$out/transport/thread-send-long.json"
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
                grep -q '"status": "dry-run-ready"' "$out/transport/handoff-preflight.json"
                grep -q '"threadAttachmentFallbackAllowed": false' "$out/transport/handoff-preflight.json"
                test -f "$out/transport/run/TRANSPORT_RUN_REPORT.md"
                test -s "$out/transport/claim.jsonl"
                grep -q '"semanticApproval": false' "$out/transport/run/transport-result.json"
                grep -q '"completionApproval": false' "$out/transport/run/transport-result.json"
                grep -q '"routeDecision": false' "$out/transport/run/transport-result.json"
                grep -q '"threadAttachmentFallbackAllowed": false' "$out/transport/source-put.json"
                grep -q 'dry-run-ready' "$out/transport/source-list.json"
                grep -q 'dry-run-ready' "$out/transport/source-delete-dry-run.json"
                grep -q 'remove-not-authorized' "$out/transport/source-delete-denied.json"
                grep -q 'project-url-wrong-shape' "$out/transport/thread-create-sources-tab.json"
                grep -q 'project-url-wrong-shape' "$out/transport/run-wrong-shape.json"
                grep -q 'inline-too-long' "$out/transport/thread-send-long.json"
                grep -q 'offline-project-route-unverified' "$out/transport/doctor-offline-project.json"
                grep -q 'project-probe-dry-run-ready' "$out/transport/doctor-project-dry-run.json"
                grep -q 'no-cdp-port-reachable' "$out/transport/env-no-port.json"
              '';
          ops-bootstrap = pkgs.runCommand "ops-bootstrap-check" { } ''
            test -e ${self.packages.${pkgs.stdenv.hostPlatform.system}.ops-bootstrap}/share/ops/README
            touch $out
          '';
        }
      );
    };
}
