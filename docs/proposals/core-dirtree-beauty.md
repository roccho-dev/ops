# core-dirtree-beauty — 期待dirtreeの設計美を継続評価するCore用途（方針案）

> **Status: PROPOSAL ONLY / documentation-only.** 本文は期待する能力と評価契約であり、実装・CI起動・実Jev/LLM呼出し・自動修正・強制・mergeの許可ではない。
>
> **Relation:** [ops#524 — Jev Core / route・xxx・cli adapter](https://github.com/roccho-org/ops/issues/524) の独立した用途候補。[ops#523](https://github.com/roccho-org/ops/issues/523) が評価項目の発見とRoute選択、[adrs#497](https://github.com/roccho-dev/adrs/issues/497) が上位Goalを所有する。
>
> **Issue記載規約との整合：** Issue本文のdirtreeは「欲しい完成状態」であり、現行repoの実体とは限らない。現状・gap・実測値は時点付きコメントへ分離する。設計評価を実装状況の証明にしない。

## Goal — 欲しい完成形

> **欲しいものをdirtreeと数式コメントに書き足すだけで、その設計がGoalに対して美しく閉じているかを評価できる。不要な複雑さ、責務重複、依存逆転、未充足、過剰結合、拡張時の変更波及を指摘し、最小の改善候補を返す。**

ここでいう「美しい」は、ファイル数・階層数・名前の見栄えの小ささではない。

**目標に必要な意味と責務が過不足なく現れ、境界が閉じていて、実装内部を読み直さなくても他人が再利用・合成・交換できること。**

未完成なtreeも段階的に検討できること。ただし未宣言・意図的な保留を欠陥と断定せず、確かめられる範囲を示す。修正不要なら「変更0」が望ましい。

## One core-xxx: core-dirtree-beauty

| 契約 | 期待 |
|---|---|
| **when to use** | Goal・要件・設計をdirtreeで書く／更新する／比較する時。Issue本文、PR設計案、独立設計文書など |
| **what to eval** | 個々のpath/責務/数式と、Goal・合格条件・相互依存・拡張性の整合 |
| **input** | tree全文（途中でも可、数式・役割コメント含む）。tree内または参照にGoal/制約/完成条件。任意で前版tree・今回の追加意図 |
| **output** | 指摘先path/行/式、懸念、理由と反例、最小修正案、評価範囲、UNKNOWN。前版があれば新規/解消/継続/退行 |
| **not applicable** | 設計契約ではない現行ファイル一覧・史料の保存。Goal不明時は全体目的への整合だけUNKNOWNとし、他の局所検査まで拒まない |
| **authority** | 0：助言・評価候補のみ。自動削除・修正・合否・merge・作用を担わない |

**Tree-first UX：** 利用者に毎回JSONや専用schemaの手書きを要求しない。Goalや数式がtreeに含まれていればそれを読む。宣言した数式は検査対象であり、それ自体で動作証明したとみなさない。

## 美しさの評価観点

| 観点 | 問い |
|---|---|
| **Aligned** | その責務や構造はGoalの達成と受入条件へ寄与しているか |
| **Closed** | 入出力・契約・依存・失敗・循環の扱いが閉じているか |
| **Unique** | 責務と意味の正本は一つか。合法な参照・投影を重複と誤認していないか |
| **Minimal** | 本当に取り除ける冗長層か。削除しても安全・交換可能性を保持できるか |
| **Composable** | 用途やCoreを足しても既存要素の変更波及を抑えられるか |
| **Measurable** | 完成条件は独立に検証・反証可能か |
| **Improving** | 変更前後の真の改善と、隠れた退行を別々に説明できるか |

既存の [semlint 6軸](https://github.com/roccho-org/ops/issues/471) と [repo-health/design](https://github.com/roccho-org/ops/blob/proposals/packages/repo-health/design/README.md) の設計検査を再利用候補とする。Composableは拡張時の局所性を問う横断条件。**独自の万能美観スコア、第二のJev Core、第二の規約正本は追加しない。**

「読みやすさ」を名前や字数だけで独立採点しない。目的、責務、接続、根拠を**実装未読でcomposeできるか**に帰着させる。

## 期待する使い方

~~~text
Goal + expected dirtree_vN（数式コメント込み）
  → 独立の構造・意味検査
  → Beauty findings（根拠付き・上位候補から）
      ├─ 美しい箇所：成立する責務と境界
      ├─ 不自然な箇所：過不足・重複・結合・波及
      ├─ なぜ問題か：Goalに結びついた反例
      ├─ 最小修正候補：不要なら変更0
      └─ 未確認：不足根拠・未探索のまま
dirtree_vN+1
  → Resolved / New / Persisting / Regressed / UNKNOWN
~~~

トップKは**表示順**であり、非表示要素が安全・美しい証明ではない。美しさをひとつの点数へ集約しない。「最小修正」は美的理由で必要な安全境界を消すことを許さない。

### 数式付きtreeの評価例

~~~text
packages/jev/                          # Goal: 新用途の追加を局所化する
├── core/
│   └── judge.mjs                      # J(State, Questions) → Judgments ∪ ERROR
├── adapters/
│   ├── route/
│   │   └── index.mjs                  # R(Goal, Catalog) → Selected ⊆ Catalog
│   ├── core-xxx/
│   │   ├── core.json                  # when_i / what_i / version_i
│   │   └── index.mjs                  # E_i(x)=J(project_i(x),questions_i(x))
│   └── cli/
│       └── index.mjs                  # CLIはI/Oのみ
└── README.md                          # Add(Core_i) ⇒ ΔJudge = ΔRouteLogic = ΔCLI = 0
~~~

例：routeが選択だけでなく実行権限と採否権限を持つ変更なら、責務混合をpathと契約に紐づけて指摘。treeにGoalとIN/OUTが全く無ければ、勝手な目的・依存を補わずUNKNOWNを示す。

### 有限の判定例（実績ではなく期待）

| Case | 条件 | 期待 |
|---|---|---|
| B01 | 目的・責務・接続・検証が矛盾しない | 改善を無理に捏造しない |
| B02 | 同一の責務を別要素が独立所有 | Unique concern + 該当path |
| B03 | 必要入力に供給元が存在しないと明示 | Closed concern |
| B04 | 新Core追加ごとにJudge・Route・CLIを改修 | Composable concern |
| B05 | 安全・権限・Readback境界を短縮のため削除 | Minimal改善と誤判定しない |
| B06 | 根拠がなく、役割も不要な中間層 | Minimal concern + 削除の条件 |
| B07 | 途中のtreeで一部が未記載 | UNKNOWN。欠陥確定ではない |
| B08 | Goal不明、もしくはtreeしかない | Aligned/全体ClosedはUNKNOWN。局所検討は可能 |
| B09 | alias / 投影として同じ定義を参照 | 不正な重複と誤判定しない |
| B10 | 次版で既存の拡張不変条件を壊す | Regressed |
| B11 | 未実装の完成希望treeを提示 | 設計のみ評価し、実装の成立・gapを断定しない |
| B12 | 必要なファイルが多くても責務が明瞭 | ファイル数だけで美しさを否定しない |

## 受入条件 / non-goals

1. treeと数式コメントを**そのまま利用できる**。専用JSON・現行ソース閲覧・実装を評価開始の前提にしない。
2. 名前ではなくGoal→責務→接続→検証→将来追加の意味を評価する。判断は対象箇所付き、UNKNOWNも対象箇所付き。
3. 書き足すたび、新規懸念・解消・継続・退行を区別。未完部分・合法な例外・美しい多層化に偽警報を出さない。
4. 誤警報/見逃し/useful@K/設計変更負担を、事前固定の独立した正常・破壊・部分tree例で比較できる。
5. 既存の構造lint・Jev共通評価・Core routeと競合させない。JevHarness等による個別改善は**任意**であり、評価基準の改変を許さない。
6. 結果は助言であり、Issue本文の期待宣言、実装の現状、採否・削除・mergeに権限を持たない。

**このPRは用途の方針文書のみ。** 実際にdirtreeを評価できる製品が完成した、精度が立証された、CIが実行されたとは主張しない。
