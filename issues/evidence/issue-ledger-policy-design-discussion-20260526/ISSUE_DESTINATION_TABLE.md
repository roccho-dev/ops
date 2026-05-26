# Issue destination table

作成日: 2026-05-26

根拠:

- `ISSUE_LEDGER_POLICY_DISCUSSION_V2.md`
- `discussion-v2-final.json`
- `discussion-v2-final.check-discussion.json`
- `discussion-v2-final.facilitate-discussion.json`

この表は issue 化の置き場所を切るための作業表です。ここでの合意は「2 threads の同一 revision no-objections」であり、実装承認、merge 承認、push 承認、cleanup 承認ではありません。

## 置き場所の切り方

| 格納先 | 置くもの |
|---|---|
| `/home/nixos/repos/policy/issues` | 全 repo に効く不変条件、権限境界、禁止昇格、status の意味 |
| `/home/nixos/repos/specs/issues` | 複数 repo / package / tool が共有する contract、schema、出力形式 |
| `/home/nixos/repos/ops/issues` | ops repo 固有の実装、移行、検証、CDP/tool 修正、証跡運用 |

## 全項目表

| ID | 項目 | issue 化する理由 | 格納先 | 補助/依存 |
|---|---|---|---|---|
| P-01 | Git は issue control plane を持てるが、evidence data plane とは限らない | issue を Git 管理することと、大きい証跡を Git に入れることを分ける必要がある | `/home/nixos/repos/policy/issues` | ops で具体 tier を決める |
| P-02 | repo は最小 worker-readable issue interface を持つ | worker が 1 record と repo policy から開始できる条件を全体規約にする | `/home/nixos/repos/policy/issues` | specs で contract 化 |
| P-03 | `issues/*.jsonl` が current v1 と legacy を同時に意味しないようにする | worker が古い履歴を active issue と誤読するのを防ぐ | `/home/nixos/repos/policy/issues` | ops で legacy 分類を実施 |
| P-04 | active / archive / legacy / migration / release validation scope を宣言する | 検証範囲の違いを全 repo で明確にする | `/home/nixos/repos/policy/issues` | specs/ops で形式と実装 |
| P-05 | validation mode の意味を定義する | active, full-v1, migration, release, archive-restore の失敗条件を揃える | `/home/nixos/repos/policy/issues` | specs で出力 contract、ops で gate |
| P-06 | `blocked` は issue scope 内の停止であり、tool/repo 全体停止ではない | blocked の意味が広がると運用が止まる | `/home/nixos/repos/policy/issues` | ops の既存 issue 更新で反映 |
| P-07 | narrowing を許可する | 広すぎる issue を狭めても worker-facing identity が続く場合の扱いが必要 | `/home/nixos/repos/policy/issues` | specs で schema 補助が必要なら別issue |
| P-08 | split-vs-supersede の不変条件 | 同じ issueId を続ける場合と新 issue に分ける場合の判断軸が必要 | `/home/nixos/repos/policy/issues` | ops migration で利用 |
| P-09 | `evidenceRefs[]` へ寄せる方針 | bare string evidence だけでは hash/size/tier/retention を扱えない | `/home/nixos/repos/policy/issues` | specs で schema、ops で移行 |
| P-10 | upload/readback/report/issue/facilitator summary は evidence であり approval ではない | transport 成功や議論要約を merge 承認へ昇格しないため | `/home/nixos/repos/policy/issues` | ops-thread-fsm contract と連動 |
| P-11 | generated views は明示昇格されない限り non-authoritative | Markdown pages, dashboard, latest DB を正本と誤認しないため | `/home/nixos/repos/policy/issues` | ops で view 表示を実装 |
| P-12 | repo は issue backend/concurrency mode を宣言する | single-writer と multi-writer の mutation ルールを混ぜないため | `/home/nixos/repos/policy/issues` | specs で manifest schema |
| P-13 | discussion-no-objections は impl-review-pass/merge-ready ではない | 今回の合意を merge 承認と誤用しないため | `/home/nixos/repos/policy/issues` | ops-thread-fsm の表示も修正対象 |
| P-14 | policy は tool の HOWTO を再定義せず、tool docs / package entrypoint に handoff する | KISS / DRY / YAGNI の違反を防ぐ | `/home/nixos/repos/policy/issues` | specs/ops の tool contract に依存 |
| S-01 | worker-readable issue interface contract | repo ごとの差を吸収する共通 contract が必要 | `/home/nixos/repos/specs/issues` | policy P-02 が前提 |
| S-02 | validation mode output contract | gate の結果を worker/reviewer が同じ意味で読めるようにする | `/home/nixos/repos/specs/issues` | policy P-05、ops gate |
| S-03 | issue backend/concurrency manifest schema | repo が single-writer/multi-writer/hybrid を宣言する形式が必要 | `/home/nixos/repos/specs/issues` | policy P-12 |
| S-04 | structured `evidenceRefs[]` schema | ref/kind/hash/size/tier/retention/sensitivity/requiredForClose を機械可読にする | `/home/nixos/repos/specs/issues` | policy P-09、ops migration |
| S-05 | Project Source transport contract | visible-only upload と worker-readable upload を同じ success にしない | `/home/nixos/repos/specs/issues` | ops-cdp-core 実装修正 |
| S-06 | semantic readback contract | send 直後の UI 表示と、300 秒後の意味確認を分ける | `/home/nixos/repos/specs/issues` | ops wrapper 実装 |
| S-07 | ops-thread-fsm discussion classification contract | no-objections / facilitation / impl-review-pass / merge-ready を混ぜない | `/home/nixos/repos/specs/issues` | ops-thread-fsm 実装修正 |
| S-08 | package / prove-feat から issue design を受け渡す contract | policy が specs の package 正本を再定義しないため | `/home/nixos/repos/specs/issues` | policy P-14 |
| S-09 | compression / archive publication contract | 圧縮や archive を使っても reader が復元できる形式が必要 | `/home/nixos/repos/specs/issues` | ops の storage tier 決定後 |
| S-10 | Git refs vs tree-file publication model | 複数 actor/repo が issue state をどう受け取るかを contract 化する必要がある | `/home/nixos/repos/specs/issues` | policy authority rule と整合 |
| O-01 | ops の active/archive/legacy 表現を path か manifest で決める | global policy ではなく ops repo 固有の構造判断 | `/home/nixos/repos/ops/issues` | policy P-04 |
| O-02 | snapshot JSONL 継続か event stream + latest view へ移るか決める | ops の issue volume と concurrency に直結する | `/home/nixos/repos/ops/issues` | deferred schema は specs |
| O-03 | latest-state view の生成と non-authoritative 表示 | worker が便利に読めるが正本誤認しない view が必要 | `/home/nixos/repos/ops/issues` | policy P-11 |
| O-04 | SQLite / materialized view の採用条件 | issue 量が増えた時の検索・検証性能を扱う | `/home/nixos/repos/ops/issues` | specs contract が必要なら S-09/S-10 |
| O-05 | evidence storage tier と size threshold | Git bloat、cold archive、artifact store、外部保管を切り分ける | `/home/nixos/repos/ops/issues` | policy P-01、specs S-09 |
| O-06 | replay/fsck checks | duplicate、missing supersedes、hash、view rebuild、archive restore を検査する | `/home/nixos/repos/ops/issues` | specs S-02/S-04 |
| O-07 | post-push/post-merge issue-code divergence checks | code state と issue state のズレを release 前に検出する | `/home/nixos/repos/ops/issues` | specs S-02 |
| O-08 | legacy migration: `260519.jsonl` を legacy として分類 | active worker input として扱わないため | `/home/nixos/repos/ops/issues` | policy P-03 |
| O-09 | `260524/260525/260526` v1 chain を維持 | 現在 pass する chain を壊さないため | `/home/nixos/repos/ops/issues` | migration gate |
| O-10 | Markdown issues と evidence directory の棚卸し | 既存資産を消さずに current/legacy/archive へ分類する | `/home/nixos/repos/ops/issues` | evidenceRefs 移行 |
| O-11 | validation modes を先に実装してから大きな移動を行う | 移動後に何が壊れたか分からなくなるのを防ぐ | `/home/nixos/repos/ops/issues` | policy P-05 |
| O-12 | index/manifest backfill | old record を native に見せるための無理な rewrite を避ける | `/home/nixos/repos/ops/issues` | policy P-03/P-08 |
| O-13 | Project Source `auto` upload が visible-only success になる問題 | 実際には worker-readable でないのに成功扱いになる偽陽性 | `/home/nixos/repos/ops/issues` | specs S-05 |
| O-14 | Project Source list/readback が worker-readable を証明できるようにする | source に見えても thread から読めない状態を検出する必要がある | `/home/nixos/repos/ops/issues` | specs S-05 |
| O-15 | `project-thread-send` の `send_not_confirmed_prompt_not_cleared` 診断 | wrapper-first 運用で失敗理由と fallback 条件を明確にする | `/home/nixos/repos/ops/issues` | specs S-06 |
| O-16 | semantic readback wait wrapper | 300 秒待機などの運用を手作業にしない | `/home/nixos/repos/ops/issues` | specs S-06 |
| O-17 | CDP port/profile detection | 9222/9234 の混乱を減らし、正しい Project browser に接続する | `/home/nixos/repos/ops/issues` | ops-cdp-core docs |
| O-18 | ops-thread-fsm marker substring bug | marker 文字列だけの判定が誤分類を生む | `/home/nixos/repos/ops/issues` | specs S-07 |
| O-19 | ops-thread-fsm no-objections 表示を非承認として明示 | discussion convergence と merge approval を混ぜない UI/JSON にする | `/home/nixos/repos/ops/issues` | policy P-13、specs S-07 |
| O-20 | 今回の facilitation 証跡の import 方針 | raw evidence を issue/claim/evidence record のどれに昇格するか決める | `/home/nixos/repos/ops/issues` | approval ではない |
| D-01 | exact event schema | event-sourced issue state に移る場合だけ必要 | `/home/nixos/repos/specs/issues` | ops O-02 の決定後 |
| D-02 | exact SQLite/latest-state threshold | 具体しきい値は ops の volume と運用で決める | `/home/nixos/repos/ops/issues` | specs 化は必要時 |
| D-03 | exact cold archive restore SLA | 復元時間/保持条件は contract と運用の両方に効く | `/home/nixos/repos/specs/issues` | ops O-05/O-06 |
| D-04 | artifact-store credentials policy | credential の権限境界は全体規約に近い | `/home/nixos/repos/policy/issues` | ops 実装 issue が別途必要 |
| D-05 | same-issue multi-agent mutation implementation | 実装は ops の concurrency/gate 問題 | `/home/nixos/repos/ops/issues` | policy P-12、specs S-03 |
| D-06 | exact compression format | 複数 reader が復元するなら contract 問題 | `/home/nixos/repos/specs/issues` | ops O-05 |
| D-07 | Git refs vs tree-file publication model | publication/consumption の contract として扱う | `/home/nixos/repos/specs/issues` | policy authority rule と整合 |

## すぐ作るなら分割単位

| 優先 | issue 名の案 | 格納先 |
|---|---|---|
| 1 | issue-ledger-global-invariants-policy-seed | `/home/nixos/repos/policy/issues` |
| 1 | ops-issue-ledger-local-design | `/home/nixos/repos/ops/issues` |
| 1 | ops-issue-ledger-migration-plan | `/home/nixos/repos/ops/issues` |
| 1 | ops-cdp-project-source-worker-readable-proof | `/home/nixos/repos/ops/issues` |
| 1 | specs-project-source-worker-readable-contract | `/home/nixos/repos/specs/issues` |
| 2 | specs-issue-interface-and-validation-contract | `/home/nixos/repos/specs/issues` |
| 2 | ops-thread-fsm-discussion-classification-hardening | `/home/nixos/repos/ops/issues` |
| 2 | policy-tool-doc-boundary-and-handoff-routing | `/home/nixos/repos/policy/issues` |
| 3 | specs-archive-compression-publication-contract | `/home/nixos/repos/specs/issues` |
| 3 | policy-artifact-credential-boundary | `/home/nixos/repos/policy/issues` |
