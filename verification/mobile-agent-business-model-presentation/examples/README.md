# business-model/1 examples

このGitHubディレクトリを唯一の入口として使います。別の説明、Issueコメント、repository全体の探索は不要です。

## 最短手順

1. `manifest.json`を読み、`packageRoot`、固定された`sourceRef`、`sourcePaths`だけを解決します。
2. 対象事業の主体数に最も近い例を選びます。

| 主体数 | 例 | 適する形 |
|---:|---|---|
| 2 | `2-actors.jsonl` | 二者が直接交換する事業 |
| 3 | `3-actors.jsonl` | 運営が需要側と供給側を仲介する事業 |
| 4 | `4-actors.jsonl` | 四者が順につながる供給連鎖型の事業 |

3. 選んだ例から作業用JSONLを別に作り、主体、交換、段階、成果、証拠だけを対象事業へ置き換えます。座標、CSS、描画指定は追加しません。このディレクトリへfixtureの複製も追加しません。
4. `entrypoints.generateUrl.command`のプレースホルダーへ作業用JSONL、`host.stableBase`、receiptの保存先を入れて実行します。この生成処理自体がschema、`business-model/1` profile、URL round-trip、URL長を検査します。
5. receiptが`PASS`であることを確認し、生成URLを実Chromeで開きます。文書状態が`pass`、browser errorが0、横overflowが0でなければ返しません。
6. `outputs.url.field`のURLをそのまま最終結果として返します。Issueコメントは通常の出力面にしません。

## 変更してよいもの

JSONLにある事業固有の意味だけです。固定UI、renderer、URL codec、公開routeはこの入口から変更しません。

## 完了条件

- 新しい2〜4主体のJSONLが`business-model/1`として通る
- URLが完全にround-tripする
- URL長が`limits.urlChars`以下である
- 実Chromeでbrowser errorと横overflowがともに0である
- 既存2主体HTMLのbyte identityと2・3・4主体E2Eが維持される
- URLを直接返せる
