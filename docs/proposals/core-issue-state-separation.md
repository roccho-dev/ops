# core-issue-state-separation — Issue本文とコメントの役割を評価する用途（方針案）

> **Status: PROPOSAL ONLY / documentation-only.** 実装、全Issueへの自動適用、実Sys1モデル呼出し、CI必須化、既存Issueの一括編集、採否・merge・close権限は、この文書では発生しない。
>
> **Relation:** [ops#524 — Sys1 Core / Model・用途Adapter分離](https://github.com/roccho-org/ops/issues/524) に対する **1つの `core-xxx` 用途候補**。[ops#523](https://github.com/roccho-org/ops/issues/523) が必要な評価項目の発見・ルーティングを、[adrs#497](https://github.com/roccho-dev/adrs/issues/497) がFactory上位目標を所有する。

## Goal / 期待する完成状態

> **Issue本文には「今、こうであってほしい」という目標・要件・完成形を書く。その時点で観測された現状・進捗・差分・証拠はコメントに書く。**

これにより、Issueは現在の状況に合わせて都度書き換える進捗報告ではなく、**何を満たせばよいかを繰り返し参照できる期待の宣言**になる。実世界の観測は時点と出所を持つ記録として積み重ねる。

### 記載境界

| 記録先 | 書く内容 | 書かない内容 |
|---|---|---|
| **Issue本文** | Goal / Expected state / Requirements / Invariants / Acceptance / 完成形のdirtree・数式 | 「現時点でここまで実装済み」「CIは失敗中」「前回との差分」「最新の調査結果」のような現在地の報告 |
| **Issueコメント** | 観測時点の現状、exactな参照・証拠、gapの可能性、調査・検証・変更の結果、未確認、次の判断候補 | Issue本文の期待を、正規の変更手続なしに確定変更したという主張 |

- **Issue本文は不変という意味ではない。** 目的・要求・完成条件そのものが変わった場合は、権限と理由・版を明示した本文変更として扱う。単なる進捗更新で本文を変えない。
- 本文内の仮定、条件文、反例、受入例、外部根拠への参照は**現状報告と同一視しない**。「現在という文字列を検出する」単純な単語検査ではない。
- コメントには観測のほか質問・提案・議論もあってよい。**観測事実、解釈、変更提案**を区別し、コメントしただけで期待・採択・権限が変わったことにしない。
- 観測時点の状態は、その観測のscope・source・版に限る。古いコメントが新しい世界の事実を保証しない。観測不足や未探索は `UNKNOWN` とする。
- 課題は「今すでに期待形であってほしいが、gapがありうる」。**Issueを作る時点で未達・修正必須と断定しない。** すでに期待を満たしていれば、追加実装0でも成立する。

## One evaluation use case: `core-issue-state-separation`

この `core-xxx` は**Issue記載の意味的な置き場所**だけを評価する。新しいprovider、CLI、Issue管理者、lint全般を作ることではない。**判断の意味はSys1モデルから独立し、モデルの選択とconformanceは外部bindingが担当する。**

| Core要素 | 契約 |
|---|---|
| **when to use** | Goal・要求・変更・完成状態を定めるGitHub Issueを起票・改訂・レビューするとき、または当該Issueの記載の妥当性を評価するとき |
| **what to eval** | 本文が期待する状態を宣言しているか。現在時点の観測・進捗が本文に混入していないか。コメントの観測を暗黙の期待変更・完了証明へ格上げしていないか |
| **inputs** | 対象Issueのexact ref・本文版、評価対象コメントのID・内容・観測時点・利用可能な根拠、必要な上位契約 |
| **outputs** | 役割分離についての対象箇所付きconcern／根拠、評価範囲、未確認・適用外・失敗の区別。結果はadvisoryであり自動修正・採否権限を持たない |
| **not applicable** | 目標達成を追うIssueではなく、過去の事実そのものを保存することを目的とした純粋な記録。用途判定が曖昧なら `UNKNOWN`。非適用を都合のよい見逃しとして扱わない |

**問うべき意味（例）**：

> 対象Issueの本文は、実現すべき期待・契約を記述しており、対象時点の観測結果や進捗報告を本文に混在させず、観測は出所付きのコメントとして分離されているか。

この問い自体の正答率は未検証。**どのSys1モデルのtyped judgmentも規約違反の確定やGitHubの作用権限に変換しない。** `core-route` による用途選択、`ModelPort` へのモデルbindingと対応primitiveのconformance、最終修正判断はそれぞれ別の責務に残す。

### 時系列と数式

```text
Issue.body_v   = Expected_v(Goal, Constraints, Acceptance)
Issue.comment_t = Observation_t(World, Scope, Source, Revision)
                | Discussion_t
                | Proposal_t

Gap_t = Compare(Expected_v, Verified(Observation_≤t))
        # 比較可能な証拠が無ければ UNKNOWN
        # Gapを推定しても、変更が必要だとはまだ確定しない

ΔObservation_t ⇒ ΔExpected_v = 0
ΔExpected_v ≠ 0 ⇒ explicit expectation revision + reason + authority
Comment_t ≠ Admit(Expected_{v+1})
Sys1Judgment ≠ ProvenGap ≠ PermissionToEdit
```

### 誤った判定を防ぐための評価例（想定、実測ではない）

| Case | Issue本文／コメントの意味 | 期待する評価 |
|---|---|---|
| P1 | 本文に完成状態と受入条件、コメントに現在の実装率と証拠 | 分離できている |
| P2 | 本文に「現在3/10達成、CI RED」と追記し、期待と進捗を混在 | 本文への現状混入concern |
| P3 | 本文が現状の列挙だけで「何を満たしたいか」がない | 期待宣言の不足concern |
| P4 | コメントで「今後の期待を変えるべき」と提案、本文は未改訂 | **提案を受理済み期待へ昇格しない** |
| P5 | 本文が「失敗時はUNKNOWNにする」という期待条件を記述 | 現状報告との誤検知をしない |
| P6 | 本文だけ先に作成、現状観測コメントはまだない | 無観測をgap確定や違反確定にしない |
| P7 | ある時点の観測コメントと別時点の観測コメントが矛盾 | 時点・版を照合できなければUNKNOWN |
| P8 | 記録保存専用Issueの本文に歴史的事実がある | 適用可否を判断し、適用外を明示 |

## Desired properties / Acceptance

1. **主張の置き場所を正しく区別**：期待（本文）・観測（コメント）・提案（コメント）を取り違えない。
2. **未達前提を押し付けない**：課題の起票をgapの存在証明、実装着手許可としない。
3. **目標の変更と進捗の変更を分離**：期待自体の正規改訂は可能だが、単なる現状変化では本文を改訂しない。
4. **評価器を局所追加可能**：この用途が他の`core-xxx`・`cli`・共有Sys1判断契約・モデルAdapterの変更を要求しない。Routeによる用途選択とCore自身の判断品質を別に評価できる。
5. **独立正解に対して比較可能**：適切な正負例・曖昧例を事前固定し、無関係な既存6軸semLintとの差分、誤検知・見逃し・未観測を別々に保持する。
6. **効果も権限も先取りしない**：この文書の存在は判断精度の実証ではない。将来の実験が必要なら許可・実Sys1モデル費用・停止条件・検証対象版を別途固定する。

## Ownership / Non-goals

- **規約の上位意味**：Issueの期待を書く行為は既存の[adrs#449](https://github.com/roccho-dev/adrs/issues/449)（WHATを渡しHOWを奪わない）と整合することを確認し、ADRSの採択権限をopsへ移さない。
- **この文書の所有範囲**：[ops#524](https://github.com/roccho-org/ops/issues/524)の`core-xxx`の具体例として、Issue本文とコメントの意味区別を評価する境界だけ。Goal発見・選択全体は[ops#523](https://github.com/roccho-org/ops/issues/523)。
- **既存の汎用意味検査**：[ops#471](https://github.com/roccho-org/ops/issues/471)のAligned/Closed/Unique/Minimal/Measurable/Improvingや[ops#403](https://github.com/roccho-org/ops/issues/403)のJev固有評価契約は再定義せず、[adrs#465](https://github.com/roccho-dev/adrs/issues/465)・[ops#524](https://github.com/roccho-org/ops/issues/524)のモデル非依存な判断境界に従う。
- **対象外**：PR本文の同一規約化、Issueテンプレートの自動強制、GitHub bot、既存Issueの本文一括移行、現在状態の自動真偽認定、エラーによるmerge/close停止、新しいJevHarness/GEPAや特定Sys1モデルの導入・実装。

**本PRの完了は、この用途方針のレビュー可能な公開まで。実Core・Route・CIの完成、契約の組織的採択は主張しない。**
