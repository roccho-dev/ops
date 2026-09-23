# DAG semantic evaluation

Accepted Contract と Observed World に対して Candidate DAG をJevで意味評価する薄いadapter。DAG生成・採否・作用はしない。

## 最短

入力JSONは一つだけ。

```text
contract
  purpose / acceptance / constraints
world
  snapshot / facts
dag
  nodes: id / actor / action
  edges: from / to / reason
```

既存envsの `jev-api` で child processへ `JEV_API_KEY` を供給し、次を実行する。

```text
node packages/repo-health/dag/run.mjs INPUT.json OUTPUT.jsonl
```

出力はmanifest + `dagSemanticEvaluation.v1`。見るのは `hard` と `findings[{theme,subject,noul}]`。

- unnecessary: 目的・acceptanceに対して不要かもしれない
- misfit: Contract / Worldと不整合かもしれない
- low-contribution: 目的・acceptanceへの寄与が弱いかもしれない

Noulは懸念の意味証拠であり、PASS/FAIL・重要度・権限ではない。

## 境界

ID・参照・重複edge・cycleはJev前に決定論で検査し、一般DAG構造検査は既存 `design/lint.mjs structural()` を再利用する。
Jev通信・request budget・応答検査は既存 `packages/jev-review` を再利用する。

```text
Contract + World + DAG
  → hard Rule
  → Jev semantic evidence
  → caller / S2 / Runtime
```

## 再検証

`benchmark/` は同じ `evaluateDag` を使う。正解はJevへ送らず全request後にgoldを読む。

- 20 discriminative pairs: node action / edge reason / Contract purpose / World fact
- 4 semantic-equivalent controls
- 各pairを A→B と B→A の両順序で実行
- discriminative goldは A/B 10/10
- 独立標本はNoul数ではなくpair
- exact two-sided sign test vs 50%
- 効果の有無と順序安定性は別に記録する
- controlは差を記録するだけで恣意的thresholdを作らない

過去のbounded proofは `evidence/` に固定する。benchmark変更後は過去evidenceを新しいproofとして読み替えない。

実証済み: bounded corpusでContract/Worldに対する意味差を区別できた。
未実証: 任意DAGの完全正解、zero FP/FN、顧客行動・売上・S2手戻り改善。

Refs: roccho-dev/adrs#389, ops#398, ops#407.
