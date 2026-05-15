# ops-cdp-core

`packages/ops-cdp-core/src/cdp` は、ChatGPT / Project Source / artifact
回収の CDP 運用層です。正規 runtime は `repos/ops` の
`ops-cdp-core` です。

この実装は `flakes:task/0-9-cdp-access-check` の `parts/cdp` から移行した
golden route を元にしています。`flakes` は移行元、互換、deprecated route
の明示に留め、同じ CDP 実装を二重に正本化しません。

- 汎用 CDP 呼び出し
- ChatGPT 向け adapter
- CLI 入口
- Nix での実行導線

をここに置きます。

これは `parts/chromedevtoolprotocol.zig` そのものではありません。
`parts/chromedevtoolprotocol.zig` は依存ライブラリ側、
`packages/ops-cdp-core/src/cdp` はこの repo の実運用側です。

## どこに何を置くか

- `lib.mjs`, `connect.mjs`, `fs.mjs`
  - 汎用の CDP 呼び出しと実行補助
- `chatgpt/`
  - ChatGPT 固有の selector, target 解決, navigation, input, IR
- `packages/ops-cdp-core/src/cdp/*.mjs`
  - CLI 入口と組み立て
- `docs/`
  - 補助文書

### 記憶を失っても戻る入口

- ChatGPT 向け command の責務と命名は `docs/chatgpt-command-map.md` を正とします。
- 複数 thread で host git repo を更新する運用は `docs/host-git-project-workflow.md` を正とします。
- 「既存会話」「thread file」「project source」のどれを触るかを、まずこの表で分けます。
- runtime から見たい時は `chromium-cdp-chatgpt-command-map` を使います。
- さらに、この layer では `CDP = 外部操作機構` として扱います。
  - shared background は `Project Sources`
  - 成果回収は `thread artifact`
  - 各会話への担当投入は `send/open/create-thread`
  - 現在の live UI では、source 化の安定導線は `assistant turn -> promote-turn` です
  - 同名の `Project Sources` を更新した後は、会話側へ「必ず読み直して。過去回答やキャッシュに頼らない」と明示します

原則として、ChatGPT 固有の判断は `chatgpt/` に集めます。
CLI 側は引数処理、標準出力、ファイル入出力の薄い層に保ちます。

## 4原則

### KISS

- 正本は少なくする
- ChatGPT では canonical schema を 1 つ決める
- CLI の stdout は canonical の薄い投影にする
- 一時 artifact を正本扱いしない

### SOLID

- `chatgpt/` は ChatGPT 固有ロジックだけを持つ
- top-level CLI は入口だけを持つ
- 汎用 CDP helper は ChatGPT 固有ロジックを持たない
- download target の解決と bytes 取得は別責務にする

### YAGNI

- 取れない値を推測で埋めない
- まだ不要な DB や新しい保存層は足さない
- IR に download bytes を持たせない
- 一時的な説明用ファイルを恒久文書にしない

### DRY

- selector, target 解決, navigation を CLI ごとに重複させない
- schema 定義をコマンドごとに増やさない
- 旧 import 互換を残さず、中の実装は 1 箇所に寄せる

## ChatGPT adapter の境界

ChatGPT 固有の実装は `packages/ops-cdp-core/src/cdp/chatgpt/` を正とします。

- `packages/ops-cdp-core/src/cdp/chatgpt/*.mjs`
  - ChatGPT 固有実装
- `packages/ops-cdp-core/src/cdp/chatgpt/index.mjs`
  - ChatGPT adapter の集約公開面
- `packages/ops-cdp-core/src/cdp/*.mjs`
  - 利用者向け CLI

詳しい契約は `packages/ops-cdp-core/src/cdp/chatgpt/README.md` を見てください。

## Low-access IR

ChatGPT 系 CLI は、fresh な IR がある時は live CDP より IR を優先します。

- cold path
  - live CDP を読む
  - 取得結果を IR に保存する
- warm path
  - IR を読む
  - 追加の live CDP を行わない

`read-thread` と `search-chatgpt` は、warm path で `stats.cdp.* == 0` を確認できる形にしています。
`project-inventory` も fresh IR から再描画できます。

## download の扱い

download は `resolve` と `fetch` に分けます。

- IR が持つもの
  - download target が解決済みであること
  - すぐ fetch できる locator と method
- IR が持たないもの
  - 実ファイル bytes
  - download 完了待ち状態

`resolve` は live CDP で file chip / sandbox link を見つけ、IR に semantic locator を保存します。
`fetch` は resolved target を読み、実際に click して download します。

この方針なら、一度 resolve した後は「どの target を取りに行くか」を毎回 live で探し直しません。

download の方針値は `packages/ops-cdp-core/src/cdp/chatgpt/policies/download.mjs` を正にします。

- ChatGPT 側の materialize 再確認は既定で off
- どうしても必要な時だけ `--waitForMaterialize` で有効化する
- その間隔は 15 秒未満にしない
- 環境変数 override も policy module を通す

## Zig への最終移設先

`.mjs` は暫定実装です。

- 汎用 CDP primitive に収束するもの
  - `parts/chromedevtoolprotocol.zig` 側へ寄せる
- ChatGPT automation や HQ 固有フローに収束するもの
  - `parts/hq.zig` 側へ寄せる

「CDP を使っているから」という理由だけでは移動しません。
最終的な責務で決めます。
