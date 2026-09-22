# Closure Evaluation

`adrs#392` の共通Jev評価契約を、`adrs#389` の閉包へ適用する薄いadapter。

新しいCoreではない。既存の `repo-health/lib/jev.mjs` を使い、宣言済みclosure条件を独立したNoul questionとして一括評価する。

## 入力

- purpose
- world: closed | open
- scope
- snapshot
- conditions[]
  - id
  - from
  - to
  - criterion
  - evidence[]

条件集合は呼出元が宣言する。adapterは閉包条件を発明しない。

## 出力

- raw Noul finding
- subject edge
- scope / snapshot
- declared/evaluated coverage
- Jev usage

**PASS/FAIL、closed判定、threshold、自動repair、admission、effectは返さない。**

高いNoulは「宣言された証拠では、そのclosure条件が満たされていると言うには弱い可能性」を表すだけ。

## world

- closed: 宣言された条件集合を全件評価したかを記録する。Jev判断を形式証明にはしない。
- open: 調べたscopeだけの結果として扱う。

`declaredSetFullyEvaluated=true` は「宣言集合を全件評価した」の意味だけであり、「business loopがclosed」の意味ではない。

## 責務

| 担当 | 責務 |
|---|---|
| S2 | closureを設計・修復する |
| Jev | 宣言済みclosure条件を意味評価する |
| Rule / Bend | hard invariantを証明する |
| Runtime | 採否・作用を決める |
| Readback | 実世界の結果を確認する |

Refs: roccho-dev/adrs#392, roccho-dev/adrs#389
