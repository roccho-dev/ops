# chatgpt adapter

`parts/cdp/chatgpt/` は ChatGPT 固有の CDP adapter です。

ここでは ChatGPT だけに依存する処理を持ちます。

- selector
- target 解決
- navigation
- session probe
- input helper
- artifact locator
- IR helper

CLI ごとの引数処理や標準出力の都合は、なるべくここに持ち込みません。

## 置き方

- `shared.mjs`
  - URL からの ID 抽出など、軽い共通関数
- `target.mjs`
  - ChatGPT page target の選択と生成
- `navigation.mjs`
  - ChatGPT 内の移動
- `input.mjs`
  - prompt 入力や submit 補助
- `artifacts.mjs`
  - artifact locator
- `session.mjs`
  - login / session 周り
- `ir.mjs`
  - canonical schema と sidecar の read/write 補助
  - `threads[]`, `thread{artifacts[]}` の正本
- `project-sources.mjs`
  - Project Sources URL / target / wait expression の正本
- `index.mjs`
  - adapter の集約公開面。旧 top-level façade ではない

新しい実装の正本は責務別 module 側です。CLI は必要な module か `chatgpt/index.mjs` から読みます。

## 4原則

### KISS

- 会話の正本 shape は ChatGPT export に合わせる
- 取れない値は空のままにする
- CLI 用の派生 JSON を正本にしない

### SOLID

- selector と navigation を CLI に散らさない
- IR の read/write は `ir.mjs` に寄せる
- session probe は session 境界に閉じる
- download resolve と download fetch は別責務にする

### YAGNI

- `mapping` を fake chain で作らない
- `current_node` を推測で埋めない
- download bytes を IR に持たせない
- Zig 側 ingest の都合を先回りで入れすぎない

### DRY

- thread / search / inventory ごとに別々の schema 直書きを増やさない
- ChatGPT 固有 selector を top-level CLI に重複させない
- 旧 façade を残さず、実装は責務別 module に 1 箇所だけ置く

## canonical と sidecar

現在の thread 正本は次です。

- `threads[]`
  - 一覧だけを持つ軽い index
- `thread{artifacts[]}`
  - 指定 thread の detail
  - export shape に寄せた会話本体と `artifacts[]` を同居させる
- sidecar
  - CDP でしか取れていない暫定情報を `_cdp` に置く

thread detail では、少なくとも次を正本として扱います。

- `id`
- `title`
- `create_time`
- `update_time`
- `default_model_slug`
- `gizmo_type`
- `is_archived`
- `is_starred`
- `mapping`
- `current_node`
- `moderation_results`
- `artifacts`

まだ CDP で正確に取れないものは埋めません。

- `mapping` は未取得なら空のまま
- `current_node` は未取得なら `null`

`_cdp` には今のところ主に次を置きます。

- `_cdp.visible_messages`
- `_cdp.read_thread`
- `_cdp.stats`

search と inventory は export そのものではないので、別 schema を持ちます。
ただし方針は同じです。canonical を小さく保ち、CDP 固有の観測は `_cdp` に寄せます。

## 低アクセス原則

ChatGPT へのアクセス数を減らすため、CLI は次の順で動きます。

1. fresh な IR があれば IR を返す
2. fresh でなければ live CDP を読む
3. live 結果を IR に保存する

証明は warm path の stats で行います。

- `read-thread`
  - `stats.cdp.* == 0`
- `search-chatgpt`
  - `stats.cdp.* == 0`
- `project-inventory`
  - fresh IR から再描画できる

## download の境界

download はまだ完全には整理し切っていません。
ここでの目標境界だけ先に固定します。

- IR が持つもの
  - artifact 名
  - thread / project URL
  - semantic locator
  - method
  - expected filename
- IR が持たないもの
  - 実ファイル bytes
  - download 完了待ち状態

つまり、IR は「すぐ fetch に渡せる状態」までを責務とします。

実装上は次の 2 段に分ける。

- `download-resolve.mjs`
  - semantic locator を作る
- `download-fetch.mjs`
  - resolved target から bytes を取る

download の方針値は `chatgpt/policies/download.mjs` に集約する。

- materialize 待ちは既定で off
- 例外的に download のためだけ `--waitForMaterialize` を許可する
- ChatGPT 側の再確認間隔は 15 秒未満にしない

## Thread / Artifact 完成状態

| ID | 完成状態 | 仕様 | canon-tdd |
|---|---|---|---|
| T-ART-1 | `threads[]` がある | 一覧は thread summary を flat に持つ | ✅ |
| T-ART-2 | `thread{artifacts[]}` が正本 | thread detail に artifacts を同居させる | ✅ |
| T-ART-3 | `read-thread` 1 回で artifacts まで保存できる | `--irPath` へ thread detail を書く | ✅ |
| T-ART-4 | `download-chatgpt-artifacts` は thread IR を直接読める | `--irPath` が thread detail でも fetch できる | ✅ |
| T-ART-5 | warm path は live CDP を叩かない | fresh IR では `stats.cdp.* == 0` | ✅ |
| T-ART-6 | ChatGPT 側ポーリングは例外扱い | `--waitForMaterialize` の時だけ許可し、15 秒未満にしない | ✅ |

## Session Flow 完成状態

| ID | 完成状態 | 仕様 | canon-tdd | refactored |
|---|---|---|---|---|
| UX-1 | 認証済み session を自動発見できる | localhost の CDP port 群を見て、ChatGPT の auth 状態つきで列挙する | `doctor lists sessions and auth state` | ✅ |
| UX-2 | 推奨 session を 1 つ返せる | `logged-in` を最優先し、`recommended` を 1 つだけ返す | `doctor recommends logged-in session over unauthenticated session` | ✅ |
| UX-3 | port を手で掘らなくてよい | `9222` と `39xxx` を人が見分けなくても doctor/open/list が進める | `auto session selection avoids manual port choice` | ✅ |
| UX-4 | doctor で前提不足を切り分けられる | session 一覧と auth 状態を返し、使う port を決められる | `doctor returns recommended and sessions[]` | ✅ |
| UX-5 | thread URL をそのまま開ける | `/c/...` と `/g/.../c/...` の両方を開ける | `open-thread opens thread url in recommended session` | ✅ |
| UX-6 | read-thread が open を内包できる | `--openIfNeeded` で別の `curl /json/new` を不要にする | `read-thread opens target when requested` | ✅ |
| UX-7 | thread を読んだら artifacts まで入る | `read-thread --irPath` が `thread{artifacts[]}` を保存する | `read-thread writes thread detail with artifacts` | ✅ |
| UX-8 | artifacts を一覧できる | URL か thread IR から `artifacts[]` を返せる | `list-artifacts returns normalized artifact list` | ✅ |
| UX-9 | fetch は thread IR だけ見ればよい | `--irPath <thread>` + `--name` で download できる | `fetch-artifact works from thread ir` | ✅ |
| UX-10 | warm fetch は live CDP を使わない | fresh IR と既存 download があれば `stats.cdp.* == 0` | `thread ir fetch warm path uses no live cdp` | ✅ |
| UX-11 | inspect まで CLI で完結する | zip は一覧、text/json は preview を返す | `inspect-artifact handles zip and text artifacts` | ✅ |
| UX-12 | help が一本道を示す | `doctor -> open/read -> list -> fetch -> inspect` の順を help に出す | `help advertises recommended flow` | ✅ |

### 推奨フロー

1. `chromium-cdp-chatgpt-doctor`
2. `chromium-cdp-open-thread --url ...`
3. `chromium-cdp-read-thread --url ... --openIfNeeded --irPath /tmp/thread.json`
4. `chromium-cdp-list-artifacts --irPath /tmp/thread.json`
5. `chromium-cdp-fetch-artifact --irPath /tmp/thread.json --name <artifact> --outDir /tmp/out`
6. `chromium-cdp-inspect-artifact --path /tmp/out/<artifact>`
