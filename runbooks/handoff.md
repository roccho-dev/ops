# Runbook: handoff 作成・委譲

文脈ゼロの agent がこの文書だけで handoff を作成できる単一入口。
ここに書かれた手順以外の判断をしない。分岐は全て tool の exit code が決める。

## Agent 実行契約

- 入口はこの runbook のみ。manifest 類 (source-manifest / merge-target /
  payload-manifest) を手書き・手修正することは禁止 — 全て
  `ops-handoff-pack create` が git から導出する。
- 各 step の出力 JSON が `"ok": true` でなければ**そこで停止**し、JSON を
  そのまま報告する。回復・補完・再解釈をしない。
- `handoff-pack-valid` は transport 整合と提出先明確性の証明であって、
  semantic approval / merge 承認 / push 承認ではない。
- canonical merge / push / 承認はこの runbook の範囲外。

## 依頼ごとに変わる入力（依頼者が与える）

| 入力 | 形式 |
|---|---|
| 対象 repo 群と提出先 | `repoId=root@baseBranch..candidateRef` の列 |
| 依頼本文 | `REQUEST.md`（1 行目がタイトル） |
| thread roster | `thread-roster.json`（impl-work / impl-review / merge-work / merge-review の 4 entry） |
| role catalog / topology / command board | 既存の参照ファイル |

## 不変手順

```sh
# 1. 作成（pack 構築 → manifest 導出 → core generate/validate → pack validate まで一括）
ops-handoff-pack create \
  --repo <repoId>=<root>@<baseBranch>..<candidateRef> \   # repo の数だけ繰り返す
  --role-catalog <ROLE_CATALOG.md> \
  --topology <organization-topology.a2ui.jsonl> \
  --command-board <command-board.a2ui.jsonl> \
  --request <REQUEST.md> \
  --thread-roster <thread-roster.json> \
  --out-dir <out>/ \
  --json
# 期待: "status": "handoff-pack-created"

# 2. 送付直前の最終検証（base branch の live drift 検出を含める）
ops-handoff-pack validate --handoff-dir <out>/handoff \
  --repo <repoId>=<root>          # repo の数だけ繰り返す
# 期待: "status": "handoff-pack-valid"

# 3. zip 化（handoff/ がそのまま自己完結 root）
(cd <out> && zip -qr handoff-<topic>-<yymmdd>.zip handoff)

# 4. 委譲: zip を ChatGPT Project Source にアップロードし、
#    THREADS/impl-work/BOOTSTRAP.md から開始させる。
#    transport の readback は承認ではない（approvalBoundary 参照）。
```

## 返送物の取り込み

```sh
ops-handoff-core import-result \
  --thread-function <impl-work|impl-review|merge-work|merge-review> \
  --artifact <返送 artifact> --run-report <RUN_REPORT.md> \
  --verdict-file <VERDICT.txt> --claim-path <claims.jsonl> --json
```

取り込みは evidence 化であって承認ではない。承認は parent のみが行う。

## この runbook の機械検証

`nix build .#checks.x86_64-linux.ops-handoff-pack` が上記不変手順（create →
validate → 改竄検出 → drift 検出 → stub 拒否）を毎回実走する。runbook と tool
が乖離したらこの check を先に直すこと。
