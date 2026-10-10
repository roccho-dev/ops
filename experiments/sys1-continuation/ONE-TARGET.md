# P6：一対象の意味Gap閉包の最小準備

目的から評価を発見し、残Gap全体を独立に読む経路の **構造だけ** を検証する。公開コメント [#523/6097216818](https://github.com/roccho-org/ops/issues/523#issuecomment-6097216818) と [#523/6097343039](https://github.com/roccho-org/ops/issues/523#issuecomment-6097343039) の差分。

## 固定する契約と依存

- Goal・制約を含む全評価対象のcoverage・基準・比較窓は digest と参照へ固定。更新するのは現状の観測であり、目的を都合よく縮めない。
- World ID、開始版、有限Scope、反復回数とイベント上限、許された操作、権限ownerを固定。
- 観測→問いの提案（既知Core / catalog外不足）→別主体の確認→権限→変更0または作用receipt→独立readback→次の観測。残Gapなら上限内で繰返す。UNKNOWN・棄却・不許可は別扱い。
- Readbackは世界の版と固定coverageを照合。費用は Human、Sys2、Sys1、CI、計算、手戻り、支払額の別次元を保持し、未観測値は null として残す。
- `recordedReadbackCost` は受領したreadbackの費用だけの累計。次の観測でactiveを更新しても値を失わず、未知(null)は0にしない。readback未到着・外部作業・ブロック中の費用は含まないため、これを実行全体の総費用として主張しない。

## 未解決入力（独立担当が所有）

| owner | 未受領の外部証拠 |
|---|---|
| 対象owner | 実対象・目標・観測出所・露出履歴、利用者期待 |
| 独立Gold作成・照合者 | 本人の受諾・実在性、非公開集合の所在・digest・母集合、事前基準、意見不一致の手順 |
| 作用owner | 対象版に結び付く実許可、effectKey と実receipt |
| 独立readback owner | 事前比較窓、観測・費用の根拠、未充足全体と重要退行の判定 |

この純粋な実装は上記参照の真実性、独立性、権限、行為の実行、Sys2自動起動、意味的Gold、P3〜P6品質を証明**しない**。合格しても『作成者共通の合成開発例で型が動いた』に限る。目的達成は外部照合で別に判断する。今回のテストには実モデル・有料呼出0、新Workflow・DB・queue・Secretなし。

次の本物の一対象には非公開の未使用ケースを採用して事前基準を独立固定すること。最初の対象を調整に使った場合、独立Holdoutへ戻さない。CIは既存の `sys1-continuation-evidence.yml` を再利用し、読戻しと会計の証拠をIssueコメントへ残す。
