# Parallel branch merge — completion verification matrix

> Generated from `data/jsonl/criteria.jsonl` + `data/jsonl/status.jsonl`. Do not hand-edit.

- Total gates: **257**
- Blocking gates not PASS: **77**
- Status counts: `PASS`=180 / `IN_PROGRESS`=10 / `NOT_STARTED`=45 / `PENDING_INPUT`=22

| ID | Group | Owner | Blocking | Status | Requirement | Method | Expected | Evidence | Note |
|---|---|---|:---:|---|---|---|---|---|---|
| GIT-001 | git-provenance | both | YES | PASS | UI作業はcanonical proposals HEADから分岐する | git merge-base --is-ancestor 44d59a9 HEAD | ancestor=true | ui git history |  |
| GIT-002 | git-provenance | both | YES | PASS | OPS作業はcanonical proposals HEADから分岐する | git merge-base --is-ancestor d33aa2d HEAD | ancestor=true | ops git history |  |
| GIT-003 | git-provenance | both | YES | PASS | UI作業branch名を用途固定する | git branch --show-current | merge/all-parallel-intents-260811 | ui git branch |  |
| GIT-004 | git-provenance | both | YES | PASS | OPS作業branch名を用途固定する | git branch --show-current | merge/all-parallel-intents-260811 | ops git branch |  |
| GIT-005 | git-provenance | both | YES | PASS | UI統合commit列を固定する | git log --first-parent | transfer/diff/A2UI/CI commits present | ui git history |  |
| GIT-006 | git-provenance | both | YES | PASS | OPS assemblyとverificationをcommitする | git log --stat | non-empty commit after d33aa2d | ops git history |  |
| GIT-007 | git-provenance | both | YES | PASS | 各repoのworktreeをcleanにする | git status --porcelain | empty | final verification receipt |  |
| GIT-008 | git-provenance | both | YES | PASS | commit authorを指定identityへ固定する | git log -1 --format | PorcoRosso85 <1.is.universe@gmail.com> | git commit metadata |  |
| GIT-009 | git-provenance | both | NO | PASS | UI実装とOPS assemblyをrepo責務別に分ける | git diff/tree review | UI code in ui; composition in ops | merged tree |  |
| GIT-010 | git-provenance | both | YES | PASS | 旧diagrams commitをUI履歴へ到達可能なまま移管する | git merge-base + subtree tree | source commit reachable and tree exact | migration receipt |  |
| GIT-011 | git-provenance | both | YES | NOT_STARTED | base/head/treeを最終receiptへ記録する | receipt schema validation | all SHA fields present | external final receipt |  |
| GIT-012 | git-provenance | both | YES | NOT_STARTED | 各repo complete-history bundleを生成する | git bundle verify | complete history | external artifact manifest |  |
| GIT-013 | git-provenance | both | YES | NOT_STARTED | bundleからfresh cloneしてfsckとgateを再実行する | fresh clone + git fsck --strict | PASS | external clone receipt |  |
| GIT-014 | git-provenance | both | YES | PASS | UI branch head移動時にOPS lockを失効させる | lock revision vs UI HEAD | equal | locks/semantic-map-a2ui.jsonl |  |
| SRC-001 | semantic-map-source | source | YES | PASS | latest explicit semantic-map source HEADを固定する | evidence readback | a484df003370ed10e785076a165195063c6a11a9 | artifact lock |  |
| SRC-002 | semantic-map-source | source | YES | PASS | source git bundle digestを固定する | sha256sum | known digest | source package evidence |  |
| SRC-003 | semantic-map-source | source | YES | PASS | npm tgz digestを固定する | sha256sum exact tgz | 7df3604275ac962ae27700edb798a11092a60d024052341c0d9cb991a48603af | artifact lock |  |
| SRC-004 | semantic-map-source | source | YES | PENDING_INPUT | exact npm tgz bytesを実行環境へ取得する | filesystem stat | file exists | SEMANTIC_MAP_PACKAGE_TGZ |  |
| SRC-005 | semantic-map-source | source | YES | PENDING_INPUT | 取得したtgzのdigestを再計算する | sha256File | SRC-003と一致 | exact dependency receipt |  |
| SRC-006 | semantic-map-source | source | YES | PENDING_INPUT | package名を固定する | read package.json | @roccho/semantic-map | installed package.json |  |
| SRC-007 | semantic-map-source | source | YES | PENDING_INPUT | package versionを固定する | read package.json | 0.0.0 | installed package.json |  |
| SRC-008 | semantic-map-source | source | YES | PASS | packageをESMとして固定する | read package.json type | module | source evidence |  |
| SRC-009 | semantic-map-source | source | YES | PENDING_INPUT | root public exportだけでproducer APIを利用できる | fresh consumer import | DecisionLogからURLまで成功 | exact package E2E |  |
| SRC-010 | semantic-map-source | source | YES | PASS | 公開subpath exportsを保持する | package exports inspection | declared public exports preserved | source contract evidence |  |
| SRC-011 | semantic-map-source | source | YES | PASS | deep importをfail-closedにする | fresh consumer forbidden import | ERR_PACKAGE_PATH_NOT_EXPORTED | source package evidence |  |
| SRC-012 | semantic-map-source | source | YES | PASS | URL generationを公開APIだけで行う | public API invocation | URL created | source package evidence |  |
| SRC-013 | semantic-map-source | source | YES | PASS | URL round-tripでhead/stateを維持する | readSmapHash | head/stateHash equal | source package evidence |  |
| SRC-014 | semantic-map-source | source | YES | PASS | package化でruntime/build意味を変えない | base/runtime diff review | NONE | source verification |  |
| SRC-015 | semantic-map-source | source | YES | NOT_STARTED | full verify suiteをlatest package commitで再実行する | source verify command | all gates PASS | source CI receipt |  |
| SRC-016 | semantic-map-source | source | YES | PASS | semantic-map source treeをui/opsへcopyしない | path inventory | vendor/semantic-map absent | purity gates |  |
| SRC-017 | semantic-map-source | source | YES | PASS | UIはpublic API注入portだけを持つ | static source inspection | only required public functions | UI input-port test |  |
| SRC-018 | semantic-map-source | source | YES | PASS | OPSはpackage exportからproducer shimを生成する | synthetic assembly | producer.mjs re-export | assembly tests |  |
| UIO-001 | ui-ownership | ui | YES | PASS | A2UI browser compositionを独立packageにする | tree inspection | packages/a2ui-browser | ui tree |  |
| UIO-002 | ui-ownership | ui | YES | PASS | semantic-map A2UI projectionをbrowser非依存packageにする | tree inspection | packages/projections/semantic-map-a2ui | ui tree |  |
| UIO-003 | ui-ownership | ui | YES | PASS | actionを返すCSR appを独立させる | tree inspection | apps/semantic-map-a2ui-app | ui tree |  |
| UIO-004 | ui-ownership | ui | YES | PASS | browser ownership文書と実装境界を整合させる | docs/tree review | renderer source owned; hosting excluded | UI evidence |  |
| UIO-005 | ui-ownership | ui | YES | PASS | hosting/deploy設定をUI packageへ置かない | path/content scan | deploy secret absent | ownership gate |  |
| UIO-006 | ui-ownership | ui | YES | PASS | accepted/canonical authorityを持たない | manifest/docs scan | authority=false | artifact manifest |  |
| UIO-007 | ui-ownership | ui | YES | PASS | semantic-map reducerを実装しない | static scan | reduceOperations absent | purity gate |  |
| UIO-008 | ui-ownership | ui | YES | PASS | semantic-map codecを実装しない | static scan | gzip/base64url codec absent | purity gate |  |
| UIO-009 | ui-ownership | ui | YES | PASS | Web Core processorをlocal copyしない | path/source scan | local processor absent | purity gate |  |
| UIO-010 | ui-ownership | ui | YES | PASS | source/data/generated/evidenceを分離する | directory assertions | separate roots | tree gate |  |
| UIO-011 | ui-ownership | ui | YES | PASS | src配下にJSONL dataを置かない | purity scan | 0 files | purity gate |  |
| UIO-012 | ui-ownership | ui | YES | PASS | data配下に実行codeを置かない | purity scan | 0 .mjs files | purity gate |  |
| UIO-013 | ui-ownership | ui | YES | PASS | generatedを手編集authorityにしない | manifest check | generated=true authority=false | artifact manifest |  |
| UIO-014 | ui-ownership | ui | YES | PASS | evidenceをpackage workspaceにしない | workspace/path scan | evidence outside packages | root package.json |  |
| UIO-015 | ui-ownership | ui | YES | PASS | workspacesを明示列挙する | package.json review | explicit package/app list | existing regression test |  |
| UIO-016 | ui-ownership | ui | YES | PASS | 既存Purpose Atlas等の所有境界をデグレさせない | existing UI test suite | ui-all-checks-pass | tests/run-all.mjs |  |
| JSL-001 | jsonl-reduce | ui | YES | PASS | DecisionLog fixtureをJSONLとして保持する | file inspection | canonical lines + LF | fixtures input |  |
| JSL-002 | jsonl-reduce | ui | YES | IN_PROGRESS | CRを拒否する | negative exact package test | error | negative receipt |  |
| JSL-003 | jsonl-reduce | ui | YES | IN_PROGRESS | 末尾LF欠損を拒否する | negative exact package test | error | negative receipt |  |
| JSL-004 | jsonl-reduce | ui | YES | IN_PROGRESS | blank lineを拒否する | negative exact package test | error | negative receipt |  |
| JSL-005 | jsonl-reduce | ui | YES | IN_PROGRESS | 非canonical JSON key orderを拒否する | negative exact package test | error | negative receipt |  |
| JSL-006 | jsonl-reduce | ui | YES | IN_PROGRESS | first DecisionをCreateMapだけに限定する | negative exact package test | error | negative receipt |  |
| JSL-007 | jsonl-reduce | ui | YES | IN_PROGRESS | parent chain改ざんを拒否する | negative exact package test | error | negative receipt |  |
| JSL-008 | jsonl-reduce | ui | YES | IN_PROGRESS | stateHash改ざんを拒否する | negative exact package test | error | negative receipt |  |
| JSL-009 | jsonl-reduce | ui | YES | IN_PROGRESS | duplicate Decisionを拒否する | negative exact package test | error | negative receipt |  |
| JSL-010 | jsonl-reduce | ui | YES | PASS | JSONL reduceをsemantic-map verifyDecisionLogへ委譲する | spy API test | exact one delegation | input-port test |  |
| JSL-011 | jsonl-reduce | ui | YES | PASS | 同一logからheadを決定的に得る | compat/exact test | stable head | reduction golden |  |
| JSL-012 | jsonl-reduce | ui | YES | PASS | 同一logからstateHashを決定的に得る | compat/exact test | stable stateHash | reduction golden |  |
| JSL-013 | jsonl-reduce | ui | YES | PASS | Envelope schemaをsemantic-map-envelope/3へ固定する | projection input assertion | schema exact | golden fixture |  |
| JSL-014 | jsonl-reduce | ui | YES | PASS | Decision schemaをsemantic-map-decision/2へ固定する | fixture assertion | schema exact | golden fixture |  |
| JSL-015 | jsonl-reduce | ui | YES | PASS | State schemaをsemantic-map-state/1へ固定する | reduction assertion | schema exact | golden fixture |  |
| JSL-016 | jsonl-reduce | ui | YES | PASS | graph/map/seq patternを保持する | projection tests | three patterns supported | projection receipt |  |
| JSL-017 | jsonl-reduce | ui | YES | PASS | 同じreductionから同じA2UI DataModelを生成する | byte equality | golden exact match | projection test |  |
| JSL-018 | jsonl-reduce | ui | YES | PASS | 同じreductionから同じA2UI JSONLを生成する | byte equality | golden exact match | projection test |  |
| A2U-001 | a2ui-web-core | ui | YES | PASS | A2UI protocolをv0.9.1へ固定する | constant/message inspection | v0.9.1 | catalog contract + golden |  |
| A2U-002 | a2ui-web-core | ui | YES | PASS | 公式Web Core versioned exportだけをimportする | static scan | @a2ui/web_core/v0_9 | official boundary test |  |
| A2U-003 | a2ui-web-core | ui | YES | PASS | Web Core package versionをexact pinする | package/lock inspection | 0.10.6 | artifact lock |  |
| A2U-004 | a2ui-web-core | ui | YES | PENDING_INPUT | 公式Web Core tgz bytesを取得する | filesystem stat | file exists | A2UI_WEB_CORE_TGZ |  |
| A2U-005 | a2ui-web-core | ui | YES | PENDING_INPUT | 公式Web Core tgz digestをlockする | sha256 + lock row | 64hex locked | artifact lock |  |
| A2U-006 | a2ui-web-core | ui | YES | PENDING_INPUT | Web Core MessageProcessorを実際に使用する | exact package E2E | surface created | exact dependency receipt |  |
| A2U-007 | a2ui-web-core | ui | YES | PENDING_INPUT | Web Core Catalogを実際に使用する | exact package E2E | custom catalog registered | exact dependency receipt |  |
| A2U-008 | a2ui-web-core | ui | YES | PASS | local MessageProcessor/Surface/DataModelを実装しない | path/source scan | 0 local definitions | purity gate |  |
| A2U-009 | a2ui-web-core | ui | YES | PASS | catalog IDをversioned URIへ固定する | constant check | urn:roccho:a2ui:catalog:base:1 | catalog test |  |
| A2U-010 | a2ui-web-core | ui | YES | PASS | trusted catalogをText/Column/Card/Divider/Buttonへ限定する | catalog test | exact 5 component names | catalog test |  |
| A2U-011 | a2ui-web-core | ui | YES | PASS | component propertyをstrict schemaで検証する | unit test | unknown/missing invalid | component schema test |  |
| A2U-012 | a2ui-web-core | ui | YES | PASS | createSurfaceを最初に送る | golden order check | message[0] | golden JSONL |  |
| A2U-013 | a2ui-web-core | ui | YES | PASS | updateDataModelを二番目に送る | golden order check | message[1] | golden JSONL |  |
| A2U-014 | a2ui-web-core | ui | YES | PASS | updateComponentsを三番目に送る | golden order check | message[2] | golden JSONL |  |
| A2U-015 | a2ui-web-core | ui | YES | PASS | surface IDを安定固定する | projection test | main | projection output |  |
| A2U-016 | a2ui-web-core | ui | YES | PASS | root component IDを安定固定する | projection test | root | projection output |  |
| A2U-017 | a2ui-web-core | ui | YES | NOT_STARTED | message batch全体をmutation前に検証する | official Web Core negative test | invalid batch leaves state unchanged | exact negative receipt |  |
| A2U-018 | a2ui-web-core | ui | YES | NOT_STARTED | 未登録componentを拒否する | official Web Core negative test | error | exact negative receipt |  |
| A2U-019 | a2ui-web-core | ui | YES | NOT_STARTED | 重複surface creationを拒否する | official Web Core negative test | error | exact negative receipt |  |
| A2U-020 | a2ui-web-core | ui | YES | NOT_STARTED | 存在しないsurface updateを拒否する | official Web Core negative test | error | exact negative receipt |  |
| A2U-021 | a2ui-web-core | ui | YES | NOT_STARTED | client capabilitiesにcatalog IDを含める | exact package E2E | supportedCatalogIds contains ID | browser receipt |  |
| A2U-022 | a2ui-web-core | ui | YES | NOT_STARTED | sendDataModel要求時だけclient modelを返す | exact package E2E | expected surface state | browser receipt |  |
| A2U-023 | a2ui-web-core | ui | NO | PASS | projection component数を固定する | projection test | 17 | projection test |  |
| A2U-024 | a2ui-web-core | ui | YES | PASS | 意味IRの全record countをDataModelへ反映する | projection test | 7 | projection state |  |
| CSR-001 | csr-dom | ui | YES | PASS | appをCSRだけで起動する | HTML/source review | module script; no SSR | app index |  |
| CSR-002 | csr-dom | ui | YES | PENDING_INPUT | URLへ実行codeを入れない | URL decode inspection | Envelope data only | exact package URL receipt |  |
| CSR-003 | csr-dom | ui | YES | PASS | semantic producer routeをsame-origin固定suffixに限定する | source test | outside route rejected | app source |  |
| CSR-004 | csr-dom | ui | YES | PASS | Web Core routeをimport mapで固定する | HTML inspection | versioned export mapped | app index |  |
| CSR-005 | csr-dom | ui | YES | NOT_STARTED | smap欠損URLをfail-closedにする | browser negative E2E | blocked invalid input | browser receipt |  |
| CSR-006 | csr-dom | ui | YES | NOT_STARTED | 改ざんsmapをfail-closedにする | browser negative E2E | no surface render | browser receipt |  |
| CSR-007 | csr-dom | ui | YES | NOT_STARTED | 未知schemaをfail-closedにする | browser negative E2E | no surface render | browser receipt |  |
| CSR-008 | csr-dom | ui | YES | PASS | DOM文字列をtextContentで描画する | unit test/source review | HTML injection absent | DOM renderer test |  |
| CSR-009 | csr-dom | ui | YES | PASS | component参照欠損を拒否する | DOM renderer negative test | error | negative unit receipt |  |
| CSR-010 | csr-dom | ui | YES | PASS | component cycleを拒否する | DOM renderer negative test | error | negative unit receipt |  |
| CSR-011 | csr-dom | ui | YES | PASS | trusted catalog外typeを拒否する | DOM renderer negative test | error | negative unit receipt |  |
| CSR-012 | csr-dom | ui | YES | PASS | Button操作をsurface dispatchへ渡す | DOM unit test | action + source ID | DOM renderer test |  |
| CSR-013 | csr-dom | ui | YES | PASS | client actionをversion付きJSONへ整形する | browser action test | v0.9.1 + action | action test |  |
| CSR-014 | csr-dom | ui | YES | PASS | continue-conversation contextへhead/stateHash/pattern/titleを含める | projection/action test | all fields present | golden + action test |  |
| CSR-015 | csr-dom | ui | YES | IN_PROGRESS | client actionをCustomEventとして外へ出す | browser E2E | a2ui-client-action observed | browser receipt |  |
| CSR-016 | csr-dom | ui | NO | PASS | keyboard focusを可視化する | CSS inspection | focus-visible style present | app CSS |  |
| CSR-017 | csr-dom | ui | YES | NOT_STARTED | mobile viewportで崩れない | real browser 360x800 | surface/action visible | visual evidence |  |
| CSR-018 | csr-dom | ui | YES | NOT_STARTED | 実Chromiumでsurfaceを描画する | browser E2E | READY + title/button | browser receipt |  |
| CSR-019 | csr-dom | ui | YES | NOT_STARTED | 実Chromiumでactionを発火する | click E2E | continue-conversation | browser receipt |  |
| CSR-020 | csr-dom | ui | YES | NOT_STARTED | browser console errorを0にする | CDP log collection | 0 errors | browser receipt |  |
| PUR-001 | purity | both | YES | PASS | 新規UI実行JSを.mjsだけにする | extension scan | non-mjs=0 | UI purity gate |  |
| PUR-002 | purity | both | YES | PASS | 新規OPS実行JSを.mjsだけにする | extension scan | non-mjs=0 | OPS purity gate |  |
| PUR-003 | purity | both | YES | PASS | first-party class宣言を禁止する | regex/static scan | 0 class declarations | purity gates |  |
| PUR-004 | purity | both | YES | PASS | first-party extendsを禁止する | regex/static scan | 0 extends | purity gates |  |
| PUR-005 | purity | both | YES | PASS | prototype操作を禁止する | regex/static scan | 0 mutation | purity gates |  |
| PUR-006 | purity | both | YES | PASS | require()を禁止する | regex/static scan | 0 require | purity gates |  |
| PUR-007 | purity | both | YES | PASS | module.exportsを禁止する | regex/static scan | 0 module.exports | purity gates |  |
| PUR-008 | purity | both | YES | PASS | CommonJS fileを禁止する | extension scan | .cjs=0 | purity gates |  |
| PUR-009 | purity | both | YES | PASS | 外部Web Core classをfirst-party APIへ露出しない | API review | factory/closure API only | UI runtime source |  |
| PUR-010 | purity | both | YES | PASS | OPSへrenderer/domain codeを置かない | path/token scan | forbidden tokens=0 | OPS purity test |  |
| PUR-011 | purity | both | YES | PASS | generated artifactをsource importしない | dependency scan | edges=0 | conformance receipt |  |
| PUR-012 | purity | both | YES | PASS | evidence/receiptをruntime importしない | dependency scan | edges=0 | conformance receipt |  |
| BLD-001 | build-artifact | both | YES | PASS | UI-owned artifactを決定的にbuildする | two clean builds | byte equal | UI build test |  |
| BLD-002 | build-artifact | both | YES | PASS | UI artifact tree digestを固定する | sha256Tree | 814a987d58c7dcdbfa86ba60141409972ddaf97e1db76fc9e587f24aab43ec59 | OPS lock |  |
| BLD-003 | build-artifact | both | YES | PASS | UI artifact revisionを固定する | lock vs git head | 9bdec04db79ca50aee8c387232aeb98fb3a13f6d | OPS lock |  |
| BLD-004 | build-artifact | both | YES | PASS | UI manifestへexternal modulesを列挙する | manifest check | semantic-map + web_core | artifact manifest |  |
| BLD-005 | build-artifact | both | YES | PASS | UI artifactへsemantic-map sourceを含めない | tree scan | 0 copied source files | build test |  |
| BLD-006 | build-artifact | both | YES | PASS | UI artifactへWeb Core processor copyを含めない | tree scan | 0 local Web Core files | build test |  |
| BLD-007 | build-artifact | both | YES | PASS | artifact全fileにdigestを持たせる | manifest check | all files bytes+sha256 | artifact manifest |  |
| BLD-008 | build-artifact | both | YES | PASS | assembly出力を決定的にする | two synthetic builds | same outputTreeSha256 | assembly test |  |
| BLD-009 | build-artifact | both | YES | PASS | assembly receiptをoutput外authorityにしない | receipt schema review | generated evidence only | assembly test |  |
| BLD-010 | build-artifact | both | YES | NOT_STARTED | clean checkoutから同じbuildを再現する | fresh bundle clone + build | same digest | external clone receipt |  |
| BLD-011 | build-artifact | both | YES | PASS | build時刻やabsolute pathをartifactへ混入しない | byte diff inspection | none | determinism test |  |
| BLD-012 | build-artifact | both | NO | PASS | artifact manifestをcanonical JSONで保存する | canonical formatter check | byte stable | manifest gate |  |
| OPS-001 | ops-assembly | ops | YES | PASS | artifact lockをcanonical JSONLにする | parseArtifactLock | all lines canonical + LF | lock test |  |
| OPS-002 | ops-assembly | ops | YES | PASS | lock IDを一意にする | lock validator | duplicates rejected | lock test |  |
| OPS-003 | ops-assembly | ops | YES | PASS | semantic-map package/A2UI app/Web Coreの3入力をlockする | lock row set | exact IDs=3 | artifact lock |  |
| OPS-004 | ops-assembly | ops | YES | PASS | 未取得必須入力をcomplete lockで拒否する | requireComplete=true | error | lock test |  |
| OPS-005 | ops-assembly | ops | YES | PASS | file artifactのSHA-256を検査する | sha256File | lock equal | assembly test |  |
| OPS-006 | ops-assembly | ops | YES | PASS | directory artifactの決定的tree digestを検査する | sha256Tree | lock equal | assembly test |  |
| OPS-007 | ops-assembly | ops | YES | PASS | package nameをlockと照合する | read package.json | equal | assembly test |  |
| OPS-008 | ops-assembly | ops | YES | PASS | package versionをlockと照合する | read package.json | equal | assembly test |  |
| OPS-009 | ops-assembly | ops | YES | PASS | root exportを安全に解決する | exports resolver | safe relative ESM target | assembly test |  |
| OPS-010 | ops-assembly | ops | YES | PASS | versioned exportを安全に解決する | exports resolver | safe relative ESM target | assembly test |  |
| OPS-011 | ops-assembly | ops | YES | PASS | package外path exportを拒否する | negative resolver test | error | assembly negative test |  |
| OPS-012 | ops-assembly | ops | YES | PASS | root producer shimを生成する | assembly | re-export file | assembly test |  |
| OPS-013 | ops-assembly | ops | YES | PASS | versioned Web Core shimを生成する | assembly | re-export file | assembly test |  |
| OPS-014 | ops-assembly | ops | YES | PASS | UI artifactをcomposition rootへcopyする | assembly | UI files preserved | assembly test |  |
| OPS-015 | ops-assembly | ops | YES | PASS | 入力locksとoutput filesをreceiptへ記録する | receipt schema | roccho.artifact.assembly-receipt/2 | assembly test |  |
| OPS-016 | ops-assembly | ops | YES | PASS | artifact-assemblyをOPS package registryへ登録する | build/packages.jsonl check | one package row | OPS build inputs |  |
| OPS-017 | ops-assembly | ops | YES | PASS | package unit gatesをOPS checksへ登録する | build/checks.jsonl check | lock/assembly/purity rows | OPS build inputs |  |
| OPS-018 | ops-assembly | ops | YES | PASS | OPS packageへUI/semantic implementationを置かない | purity scan | forbidden paths/tokens=0 | OPS purity test |  |
| OPS-019 | ops-assembly | ops | YES | PASS | tgz extractionをtemp dirに閉じる | assembly review | scratch removed finally | assembly test |  |
| OPS-020 | ops-assembly | ops | YES | PASS | 途中失敗時に不完全outputを完成扱いしない | failure injection | previous output preserved | assembly negative test |  |
| E2E-001 | cross-repo-e2e | both | YES | PENDING_INPUT | exact semantic packageでDecisionLogをreduceする | exact dependency runner | head/state obtained | exact dependencies receipt |  |
| E2E-002 | cross-repo-e2e | both | YES | PENDING_INPUT | exact packageでEnvelopeを生成する | exact dependency runner | schema v3 | exact dependencies receipt |  |
| E2E-003 | cross-repo-e2e | both | YES | PENDING_INPUT | exact packageでURLを生成する | exact dependency runner | #smap URL | exact dependencies receipt |  |
| E2E-004 | cross-repo-e2e | both | YES | PENDING_INPUT | 同じURLをexact packageでdecodeする | exact dependency runner | inspection non-null | exact dependencies receipt |  |
| E2E-005 | cross-repo-e2e | both | YES | PENDING_INPUT | encode/decode前後のheadを一致させる | exact dependency assertion | equal | exact dependencies receipt |  |
| E2E-006 | cross-repo-e2e | both | YES | PENDING_INPUT | encode/decode前後のstateHashを一致させる | exact dependency assertion | equal | exact dependencies receipt |  |
| E2E-007 | cross-repo-e2e | both | YES | PASS | validated EnvelopeをA2UIへprojectionする | pure function | 3 messages/17 components | projection test |  |
| E2E-008 | cross-repo-e2e | both | YES | PENDING_INPUT | 公式Web Coreでmessagesを処理する | exact package runner | surface present | exact dependencies receipt |  |
| E2E-009 | cross-repo-e2e | both | YES | NOT_STARTED | surface DataModelへhead/stateを保持する | Web Core readback | equal | browser receipt |  |
| E2E-010 | cross-repo-e2e | both | YES | NOT_STARTED | trusted DOM rendererでtitleを描画する | browser E2E | title visible | browser receipt |  |
| E2E-011 | cross-repo-e2e | both | YES | NOT_STARTED | Button操作からstructured actionを得る | browser click | continue-conversation | browser receipt |  |
| E2E-012 | cross-repo-e2e | both | YES | NOT_STARTED | action contextを次会話入力へ渡せる形にする | JSON schema/readback | head/stateHash/pattern/title | browser receipt |  |
| E2E-013 | cross-repo-e2e | both | YES | PENDING_INPUT | exact3入力から単一artifactをassemblyする | assembly command | PASS receipt | final assembly receipt |  |
| E2E-014 | cross-repo-e2e | both | YES | NOT_STARTED | assembly artifactをHTTPで配信して起動する | local static server + browser | READY | browser receipt |  |
| E2E-015 | cross-repo-e2e | both | YES | NOT_STARTED | runtime外部network requestを0にする | CDP network log | 0 unexpected | browser receipt |  |
| E2E-016 | cross-repo-e2e | both | YES | NOT_STARTED | 単一メンタルモデルをreceiptへ明記する | receipt text assertion | validated URL + CSR -> render + action | final verification receipt |  |
| E2E-017 | cross-repo-e2e | both | YES | PENDING_INPUT | URL長が契約上限以内である | exact generated URL length | within source limit | exact receipt |  |
| E2E-018 | cross-repo-e2e | both | YES | NOT_STARTED | 同じfixtureで再実行してbyte同一を得る | repeat entire E2E | same hashes | determinism receipt |  |
| NEG-001 | negative-security | both | YES | NOT_STARTED | gzip bomb/展開上限をsource codecで拒否する | source negative test | error | source verification |  |
| NEG-002 | negative-security | both | YES | PASS | URL文字数上限超過を拒否する | source negative test | error | source verification |  |
| NEG-003 | negative-security | both | YES | NOT_STARTED | 不正base64urlを拒否する | source negative test | error | source verification |  |
| NEG-004 | negative-security | both | YES | PASS | producer moduleをcross-originへ変更できない | browser/source negative test | blocked | viewer test |  |
| NEG-005 | negative-security | both | YES | PASS | A2UI actionへ実行codeを含めない | action JSON scan | data only | projection/action test |  |
| NEG-006 | negative-security | both | YES | PASS | DOMへinnerHTMLを使用しない | source scan | 0 innerHTML | purity/security gate |  |
| NEG-007 | negative-security | both | YES | PASS | 未知component propertyを拒否する | schema unit test | failure | component schema test |  |
| NEG-008 | negative-security | both | YES | PASS | 不足required propertyを拒否する | schema unit test | failure | component schema test |  |
| NEG-009 | negative-security | both | YES | PASS | lockに未知fieldを許可しない | lock negative test | error | lock test |  |
| NEG-010 | negative-security | both | YES | PASS | 非canonical lock行を拒否する | lock negative test | error | lock test |  |
| NEG-011 | negative-security | both | YES | PASS | digest mismatchでassemblyを拒否する | assembly negative test | error/no receipt | assembly test |  |
| NEG-012 | negative-security | both | YES | PASS | package identity mismatchを拒否する | assembly negative test | error | assembly test |  |
| NEG-013 | negative-security | both | YES | PASS | missing exportを拒否する | assembly negative test | error | assembly test |  |
| NEG-014 | negative-security | both | YES | PASS | 秘密・個人情報をfixture URLへ含めない | fixture scan | none | data review |  |
| NEG-015 | negative-security | both | YES | PASS | URL artifactをauthorityと扱わない | docs/manifest assertion | authority=false | ownership docs |  |
| NEG-016 | negative-security | both | YES | PASS | client actionをaccepted mutationと扱わない | docs/schema assertion | proposal/input only | ownership docs |  |
| NEG-017 | negative-security | both | YES | PASS | npm tgzのpackage/外pathを拒否する | malicious tar traversal injection | error + old output preserved | assembly negative test |  |
| NEG-018 | negative-security | both | YES | PASS | npm tgz内symlinkを拒否する | symlink package injection | error + old output preserved | assembly negative test |  |
| REG-001 | regression-release | both | YES | PASS | 既存UI全testを通す | node tests/run-all.mjs | ui-all-checks-pass | UI test output |  |
| REG-002 | regression-release | both | YES | PASS | root npm checkへ新local gatesを統合する | root test inspection | PASS | UI package.json/tests |  |
| REG-003 | regression-release | both | YES | PASS | 既存OPS selected checksをデグレさせない | selected checks | PASS | OPS test output |  |
| REG-004 | regression-release | both | YES | PASS | 既存maxGraph rendererを変更しない | source subtree identity | exact transferred tree | migration receipt |  |
| REG-005 | regression-release | both | YES | NOT_STARTED | legacy /app#smap routeを維持する | source package/browser regression | PASS | source verification |  |
| REG-006 | regression-release | both | YES | NOT_STARTED | 既存producer API symbolsを壊さない | export snapshot | equal | source package E2E |  |
| REG-007 | regression-release | both | YES | NOT_STARTED | 公式A2UI noticeを保持する | license inventory | notice present | LICENSES/provenance |  |
| REG-008 | regression-release | both | YES | PASS | semantic-map artifact provenanceを記録する | evidence receipt | head/digests present | UI evidence |  |
| REG-009 | regression-release | both | YES | NOT_STARTED | 3 artifact provenanceをassembly receiptへ記録する | receipt check | all locked identities | final assembly receipt |  |
| REG-010 | regression-release | both | YES | IN_PROGRESS | UI CIへA2UI exact dependency gateを追加する | workflow review | local + exact input gates | GitHub workflow |  |
| REG-011 | regression-release | both | YES | PASS | OPS CI checkを追加する | checks.jsonl | package + completion renderer | OPS build checks |  |
| REG-012 | regression-release | both | YES | NOT_STARTED | Nix checkでUI local gatesを再現する | nix flake check | PASS | Nix receipt |  |
| REG-013 | regression-release | both | YES | NOT_STARTED | Nix checkでassembly packageを再現する | nix flake check | PASS | Nix receipt |  |
| REG-014 | regression-release | both | YES | PASS | deploy先固有設定をassemblyから分離する | path review | infra adapter only | OPS tree |  |
| REG-015 | regression-release | both | YES | NOT_STARTED | preview deployを実行する | deploy command | deployment URL | deployment receipt |  |
| REG-016 | regression-release | both | YES | NOT_STARTED | deploy readbackでartifact digestを照合する | HTTP readback | digest equal | deployment receipt |  |
| REG-017 | regression-release | both | YES | NOT_STARTED | rollback対象revisionをreceiptへ残す | receipt validation | previous/current refs | deployment receipt |  |
| REG-018 | regression-release | both | YES | PASS | 検証証拠をsource/data/generatedと分離する | tree assertions | evidence/receipts only | tree gate |  |
| REG-019 | regression-release | both | YES | PASS | 完了基準criteriaとstatusを別JSONLにする | file/schema check | separate appendable data | verification data |  |
| REG-020 | regression-release | both | YES | PASS | JSONLからMarkdown表を決定的生成する | renderer two-run diff | byte equal | completion renderer |  |
| CMP-001 | completion | ops | YES | PASS | 全blocking gateがPASSになるまでcompleteを出さない | renderer --require-complete | exit 0 only all PASS | completion summary |  |
| CMP-002 | completion | ops | YES | PENDING_INPUT | PENDING_INPUTを0にする | status count | 0 | completion summary |  |
| CMP-003 | completion | ops | YES | NOT_STARTED | NOT_STARTEDを0にする | status count | 0 blocking | completion summary |  |
| CMP-004 | completion | ops | YES | PASS | criteria/status IDを完全一致させる | renderer validation | no missing/orphan IDs | completion renderer |  |
| CMP-005 | completion | ops | YES | PASS | 細粒度完了基準表をartifactとして固定する | generated markdown | all rows rendered | generated completion-gates.md |  |
| CMP-006 | completion | ops | YES | NOT_STARTED | IN_PROGRESSを0にする | status count | 0 | completion summary |  |
| CMP-007 | completion | ops | YES | NOT_STARTED | blocking openを0にする | status count | 0 | completion summary |  |
| CMP-008 | completion | ops | YES | NOT_STARTED | external inputsの取得主体とdigestをreceipt化する | receipt validation | all exact inputs | dependency receipt |  |
| CMP-009 | completion | ops | YES | NOT_STARTED | browser/deploy証拠を最終summaryへ接続する | evidence linkage | no orphan evidence | final verification receipt |  |
| CMP-010 | completion | ops | YES | NOT_STARTED | 製品completionとmerge completionを分離表示する | summary schema | two explicit statuses | final verification receipt |  |
| TRN-001 | diagrams-retirement | ui | YES | PASS | 旧diagrams source commitを履歴へ保持する | git merge-base | 04569f23 ancestor | UI Git history | source commit remains an ancestor |
| TRN-002 | diagrams-retirement | ui | YES | PASS | 旧diagrams source treeのbyte同一objectを履歴へ保持する | git cat-file | 679a36c944d9081f069c1f8bd69575e93529c911 tree reachable | UI Git object database | exact source tree object remains reachable |
| TRN-003 | diagrams-retirement | ui | YES | PASS | 旧diagram実装を現行tree/CIから退役し、出自はGit履歴だけで保持する | current-tree absence + git object reachability | current package/workflow/drawio absent; source commit/tree reachable | UI retirement receipt + cross-repo verifier | current package/workflow/drawio absent; history reachable |
| TRN-004 | diagrams-retirement | ui | YES | PASS | 旧Python/Node/Nix/examples/tools/records/schemasを現行製品treeへ残さない | tracked-tree inventory | former package roots absent from current tree | UI retirement receipt | former package roots absent from current tracked tree |
| TRN-005 | diagrams-retirement | ui | YES | PASS | 旧package専用CIを現行CIから退役する | workflow and intent scan | no legacy dedicated workflow or CI intent | UI CI intent + workflow tree | dedicated workflow and CI intent absent |
| TRN-006 | diagrams-retirement | ui | YES | PASS | 旧packageのtestを実行せず現行UI全検査が通る | npm run check | PASS without retired package tests | UI full check receipt | full UI check passes without retired tests |
| TRN-007 | diagrams-retirement | ui | YES | PASS | 旧package向けnpm依存を現行workspaceから除く | package and lockfile scan | no legacy npm package or fixture dependency | UI workspace scan | no retired npm workspace or fixture dependency |
| TRN-008 | diagrams-retirement | ui | YES | PASS | 旧package向けNix入口を現行workspaceから除く | tracked path scan | no retired package Nix flake in current tree | UI tracked-tree scan | no retired package Nix entry in current tree |
| TRN-009 | diagrams-retirement | ui | YES | PASS | 退役証跡をauthority外へ置く | receipt validation | authority=false | UI retirement receipt | retirement receipt is non-authority |
| TRN-010 | diagrams-retirement | ui | YES | PASS | 旧sourceの出自を実merge履歴として保持する | git show parents | 3de1c6d6 has source commit as second parent | UI Git history | source provenance merge remains in history |
| TRN-011 | diagrams-retirement | ops | YES | PASS | OPSへrenderer/reducerを移さない | OPS path scan | 0 transferred implementation | OPS purity gate | OPS contains verification only, no renderer/reducer |
| TRN-012 | diagrams-retirement | ui | YES | PASS | fresh bundle cloneでも退役状態とGit履歴を再現する | fresh bundle clone + cross-repo verifier | absence + history reachability PASS | fresh bundle clone receipt | intent-proof fix後のmobile/UI/OPS proof-parent bundleをfresh cloneし、退役状態・履歴・43 checksを再現 |
| URLX-001 | url-source-export | mobile-agent | YES | PASS | #smap URLから承認済みState JSONLを正規化出力する | inline #smap decode | canonical accepted State JSONL | mobile source-export proof | inline #smap canonical accepted State JSONL proof PASS |
| URLX-002 | url-source-export | mobile-agent | YES | PASS | #smap-ref URLから同じ承認済みState JSONLを復元する | #smap-ref GET and SHA-256 | one GET + digest-verified same State JSONL | mobile source-export proof | #smap-ref one GET and digest-verified same State JSONL proof PASS |
| URLX-003 | url-source-export | mobile-agent | YES | PASS | URLから承認済みDecisionLog全履歴を出力する | DecisionLog byte equality | exact accepted DecisionLog JSONL | mobile source-export proof | accepted DecisionLog byte equality proof PASS |
| URLX-004 | url-source-export | mobile-agent | YES | PASS | URLから共有Envelopeを正規化出力する | canonical Envelope roundtrip | canonical Envelope JSON | mobile source-export proof | canonical Envelope JSON roundtrip proof PASS |
| URLX-005 | url-source-export | mobile-agent | YES | PASS | 未承認Proposalを承認済みStateへ混ぜない | Proposal preview comparison | accepted State unchanged and Proposal state separate | mobile source-export proof | accepted State stable and Proposal preview separate proof PASS |
| URLX-006 | url-source-export | mobile-agent | YES | PASS | AcceptでDecisionLogへ1件追記し次URLを生成する | Chromium Accept roundtrip | DecisionLog +1 and next URL decodes | mobile browser proof | Chromium Accept appends one DecisionLog entry and next URL decodes; proof PASS |
| URLX-007 | url-source-export | both | YES | PASS | 完成bundleだけからURL復元を第三者再現する | fresh bundle clone verification | final bundles pass source roundtrip verifier | cross-repo fresh-clone receipt | intent-proof fix後の完成bundleだけからURL source roundtripと旧dist path互換を再現 |
| DIF-001 | diff-url-generator | ui | YES | PASS | diff URL機能を独立packageにする | tree inspection | packages/diff-url-generator | UI tree |  |
| DIF-002 | diff-url-generator | ui | YES | PASS | 左右tree入力を外部JSONLへ置く | path scan | data/diagrams/...jsonl | UI data tree |  |
| DIF-003 | diff-url-generator | ui | YES | PASS | 入力JSONLをcanonical LF契約にする | parser negative tests | CR/blank/noncanonical rejected | package tests |  |
| DIF-004 | diff-url-generator | ui | YES | PASS | URLへdata/digest/viewだけを載せる | URL parser test | exact parameter set | package tests |  |
| DIF-005 | diff-url-generator | ui | YES | PASS | 取得dataのSHA-256を描画前に照合する | digest negative test | mismatch rejected | package tests |  |
| DIF-006 | diff-url-generator | ui | YES | PASS | JSONL event列を決定的にreduceする | two-run byte equality | same left/right tree | package tests |  |
| DIF-007 | diff-url-generator | ui | YES | PASS | 左右treeを二面表示する | DOM renderer test | two panels | package tests |  |
| DIF-008 | diff-url-generator | ui | YES | PASS | classless ESM onlyを守る | purity scan | 0 class/CommonJS | package tests |  |
| DIF-009 | diff-url-generator | ui | YES | PASS | package局所7 gateを通す | node tests | 7 PASS | UI test output |  |
| DIF-010 | diff-url-generator | ui | YES | NOT_STARTED | 実browserでURL loadと対比表示を確認する | browser E2E | rendered panels | browser receipt |  |
| MRG-001 | parallel-merge | both | YES | PENDING_INPUT | 参照された151940 ZIPのexact member manifestを取得する | ZIP readback | four exact bundle members | input evidence | active filesystem and File Library search did not expose ZIP bytes |
| MRG-002 | parallel-merge | both | YES | PENDING_INPUT | t=0 exact branch objectsをbyte単位で照合する | git object comparison | heads 26d41a8/af1bf55 reachable | exact ZIP evidence |  |
| MRG-003 | parallel-merge | both | YES | PASS | t=0命名・責務意図を契約から再構成する | tree/test review | requested paths and contracts preserved | merged repos |  |
| MRG-004 | parallel-merge | both | YES | PASS | UI canonical baseを第一親祖先として保つ | git merge-base | 44d59a9 ancestor | UI history |  |
| MRG-005 | parallel-merge | both | YES | PASS | OPS canonical baseを祖先として保つ | git merge-base | d33aa2d ancestor | OPS history |  |
| MRG-006 | parallel-merge | both | YES | PASS | transfer/diff/A2UI/assemblyの各意図を同時に保持する | merged intent gate | all four scopes present | UI/OPS tests |  |
| MRG-007 | parallel-merge | both | YES | PASS | 旧proof語彙を恒久identityへ残さない | token/path scan | renamed vocabulary | purity/tree gates |  |
| MRG-008 | parallel-merge | both | YES | NOT_STARTED | 二repo完成HEADをcomplete-history bundleへ固定する | bundle verify + fresh clone | PASS | external artifact set |  |
