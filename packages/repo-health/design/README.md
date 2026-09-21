# 設計を渡す → 気になる箇所を上から見直す

呼出元が**目的・合格条件・制約と、関係unitの責務・IN/OUT・計画**を渡し、各テーマで知りたい件数 `topK` を指定する。構造エラーは対象を見て直す。意味上の懸念はテーマ別のNoul降順で読み、修正・問題なし・情報追加を判断する。

**上位は欠陥確定ではなく、下位・未表示も正常の証明ではない。全て正常でも候補は返る。** 意味判断の閾値は持たず、CI成功は評価の実施を表すだけ。ランキングの誤りは残る。

## 今動くlibの使い方

Node.js 22。取得したopsの `packages/repo-health` を使う。`REPO_HEALTH_DIR` をその絶対パス、`DESIGN_FILE` を自分のDesign JSONのパスに設定し、下の内容を `.mjs` として実行する。`JEV_API_KEY` は既存envsの許可された供給経路からprocessへ渡す。入力・出力・Gitへキーを書かない。

```js
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(path.resolve(process.env.REPO_HEALTH_DIR) + path.sep);
const { review } = await import(new URL('design/lint.mjs', root));
const { askJev } = await import(new URL('lib/jev.mjs', root));
const design = JSON.parse(fs.readFileSync(process.env.DESIGN_FILE, 'utf8'));
const ask = (state, questions) => askJev(state, questions, {
  key: process.env.JEV_API_KEY, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs: 15000,
});
const result = await review(design, { topK: 5 }, ask);
console.log(JSON.stringify(result, null, 2));
if (result.hard.length) process.exitCode = 1;
```

`review`に渡すのは設定済みの二引数`ask`。注入先も同じmodel・Noul応答契約で検査する。認証・通信・応答・予算エラーはPromiseの拒否であり、空の正常結果にはしない。CIでの保存・表示・呼出し時機は呼出元が所有する。

## 入力は一つのDesign

| 対象 | 必須項目 |
|---|---|
| Design | `purpose: string`, `acceptance: string[]`, `constraints: string[]`, `in: string[]`, `out: string[]`, `units: Unit[]` |
| Unit | `id: string`, `kind: string`, `responsibility: string`, `in: string[]`, `out: string[]`, `design: string` |

JSONのデータだけを受け、未定義項目・不足・空文字は拒否する。`constraints`と`in`は空配列可。`out`・`units`・`acceptance`は一つ以上。`kind`はpackage/dir/file/function等の表示名であり、権限ではない。

対象は**境界を宣言した、有限・各port供給元一つの依存DAG**。外部だけが使う公開成果もDesignの`out`へ含める。作用を扱うなら観測可能な結果/receiptも宣言する。一般の再帰やイベントループを禁止する検査ではない。上位dirと配下fileを同じ責務として二重列挙しない。

これはContract/WorkGraphから呼出元が作る一時的な入力で、第二正本ではない。source自動抽出、汎用CLI、PR自動注釈はこのlibにない。目的や責務をコードだけから確実に復元できるとも主張しない。自然言語欄を含め、秘密・送信不許可の情報は入力に含めない。

## テーマと件数

`review(design, {topK, themes?}, ask)`。`topK`は必須の非負整数、**各テーマの返却数**。0は意味評価を停止する。対象を削る設定ではなく、全候補を評価してから表示分を返す。

標準6テーマは目的/合格条件がdesign、責務/目的外処理がunit、意味接続がedge、責務重複がpair。ドメイン固有の問いは `{id, scope: 'design'|'unit'|'edge'|'pair', concern}` を`themes`へ渡す。省略なら標準、指定なら置換。追加時はexportされた`BUILTIN_THEMES`と合わせる。同じ小さいDesign・同じテーマ群を1 API requestで評価する。pair数はunit数に対して二乗で増えるため、呼出前に関連する範囲へ絞る。予算超過を黙って切り捨てない。

## 戻り値の読む順

`hard`は`{code, subject, port}`の配列。異なる箇所のエラーを一つへ潰さない。対象refは区切り文字連結ではなく`['unit', id]`、`['edge', producer, consumer, port]`、`['pair', id1, id2]`等の組で、順位が同点でも安定した順序を使う。

`ranked`はテーマごとの`{theme, status, candidates, evaluated, returned, findings}`。`findings`は`{subject, noul}`。異なるテーマの確率を一つの順位へ混ぜない。

| status | 意味 |
|---|---|
| `blocked` | 構造不良。候補数は未確定のnull、評価0、API0 |
| `disabled` | topK=0。候補数を示し、評価0、API0 |
| `empty` | このテーマに対象なし。評価0、API0 |
| `evaluated` | 宣言した候補全件を評価。返却外の件数はevaluated−returned |

これらは評価の実施状態で、設計の合否ではない。`calls`と`usage`も返す。機械検査または評価器の失敗と、非blockingの意味判断を区別する。

## 検証と継続利用

通信なし: `node packages/repo-health/design/test.mjs`。README上の実利用例も別作業場所で試験する。

実APIの固定20事例: `node packages/repo-health/design/run.mjs NEW_REPORT.jsonl`。正解ラベルは送らず、16意味評価・8比較ペア・4構造不良の全件対応を検査する。実行漏れはエラー、逆転や同点はそのまま記録する。新しい出力先を指定し、過去証拠を上書きしない。

GitHubではenvsの`design-lint-proof`が、固定ops SHAと既存SOPS/envctlだけで同じ試験を実行しJSONLを保存する。PoC中は同一repoの限定PR、default branchへworkflowが採用された後は **Actions → design-lint-proof → Run workflow → default branch** が入口。任意branch/任意consumerを秘密付きで実行する入力は設けない。積み上げPRのbaseへmergeしただけではdefault branch採用ではない。

既存20例は作者作成・単一テーマ選択の限定試験で、実PRでの有用性や誤りゼロは未証明。注文の正常ラベルは同時到着・発送後障害の保証を意味しない。必要なドメイン条件を別テーマで問い、証明は実装・試験側で行う。履歴・実測は[ops#398](https://github.com/roccho-dev/ops/pull/398)に残す。
