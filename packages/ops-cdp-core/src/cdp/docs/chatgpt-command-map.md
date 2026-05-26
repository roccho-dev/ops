# ChatGPT CDP Command Map

この文書は、`packages/ops-cdp-core/src/cdp` 配下の ChatGPT 向け script の責務と命名を、目的から逆引きするための索引です。

「どの script を使うか分からない」を避けるため、まず surface を分けます。

この layer では、`CDP = 外部操作機構` と見なします。

- 外部操作機構
  - project の共有背景を更新する
  - 各会話へ担当を投げる
  - 完了を回収する
  - merge 順を決める
- 各会話
  - 共有背景を読む
  - 自分の担当だけ進める
  - 完了 / 要約 / 差分を返す

最小仕様はこれです。

- 共有
  - `Project Sources`
- 制御
  - 外部操作機構
- 統合判断
  - 人
- 成果回収
  - thread artifact / thread file
- 配布
  - bundle を配るのではなく、`Project Sources / Instructions / Chats` を共有文脈として使う

- `thread`
  - 個別会話を開く、読む、送る、artifact を回収する
- `project`
  - project 一覧、project への所属変更、新規会話作成
- `project source`
  - project 全体の共有背景として file を見せる

## まずこれだけ

- 既存会話を読む
  - `chromium-cdp-open-thread`
  - `chromium-cdp-read-thread`
- 会話に follow-up を送る
  - `chromium-cdp-send-chatgpt`
- 会話の file を upload する
  - `chromium-cdp-upload-chatgpt-file`
- 会話成果の file を回収する
  - `chromium-cdp-list-artifacts`
  - `chromium-cdp-fetch-artifact`
- project から新規会話を作る
  - `chromium-cdp-create-project-thread`
- project source を触る
  - `chromium-cdp-project-sources-*`
- transport-only 証跡を作る
  - `project-transport-*`
  - `project-source-put`
  - `project-source-list`
  - `project-source-delete`
  - `project-thread-*`
  - `project-artifact-fetch`

## 運用モデル

この repo が狙っている最小運用は、次です。

1. 外部操作機構が `Project Sources` を更新する
2. 各会話に
   - 担当名
   - source 名
   - 版
   - 期待成果
   を投げる
3. 各会話は同じ project の
   - `Project Sources`
   - `Instructions`
   - `Chats`
   を共有文脈として参照する
4. 各会話は成果を会話側に返す
5. 外部操作機構が完了順に 1 件ずつ統合する
6. 統合後に `Project Sources` を更新する

重要なのは、

- `配布 bundle を毎回作る` のではない
- `共有背景は Project Sources`
- `成果回収は thread artifact`
- 同名 source を更新した時は、各会話に「Project Sources を読み直して」と明示する

という分担です。

## 命名規則

- `chromium-cdp-<verb>-thread`
  - 個別 thread を対象にする
- `chromium-cdp-<verb>-artifact`
  - thread 成果物を対象にする
- `chromium-cdp-project-*`
  - project 自体を対象にする
- `chromium-cdp-project-sources-*`
  - project 全体で共有する source を対象にする
- `*-roundtrip`
  - 複数手順をまとめた composite workflow
  - primitive より便利だが、UI drift の影響を受けやすい

## 責務表

| やりたいこと | surface | command | 備考 |
|---|---|---|---|
| ChatGPT session の状態確認 | session | `chromium-cdp-chatgpt-doctor` | 最初に使う |
| 既存会話を開く | thread | `chromium-cdp-open-thread` | URL を live tab に開く |
| 会話本文を読む | thread | `chromium-cdp-read-thread` | `--openIfNeeded` で open を内包できる |
| 会話へ follow-up を送る | thread | `chromium-cdp-send-chatgpt` | 既存会話に追加送信 |
| 会話で生成/添付された file を列挙 | thread artifact | `chromium-cdp-list-artifacts` | output 回収の入口。`textContent` だけに出る inline button と React 内 `sandbox:/mnt/data/...` も見る |
| 会話成果 file を download | thread artifact | `chromium-cdp-fetch-artifact` | output 回収の本線 |
| 会話成果 file を stale 回避で download | thread artifact | `chromium-cdp-fetch-artifact-strict` | 同名 artifact の誤再利用を避ける |
| 会話内の file 名参照と手元DL済み実体を照合して回収 | thread artifact recovery | `chromium-cdp-recover-artifact-set` | 長い会話の scroll-root 仮想化、inline `behavior-btn`、manual DL、統合zip materialize を区別する |
| project 一覧や所属を見る | project | `chromium-cdp-project-inventory` | 棚卸し用 |
| 既存会話を project に入れる | project | `chromium-cdp-projectize-thread` | thread の所属変更 |
| project から新規会話を作る | project | `chromium-cdp-create-project-thread` | project ページ target があると安定 |
| 会話へ file を upload する | thread input | `chromium-cdp-upload-chatgpt-file` | thread input。project source とは別 |
| text file を project source へ upload する | project source | `chromium-cdp-upload-project-source-text` | manifest / rules / text snapshot 用 |
| user turn を project source 化する | project source | `chromium-cdp-project-sources-promote-turn` | thread の file/turn を source に持ち上げる |
| project source 一覧や file を集める | project source | `chromium-cdp-project-sources-collect-files` | 読み取り側 |
| project source の add/read を一気に試す | project source composite | `chromium-cdp-project-sources-roundtrip` | composite。今は UI drift に弱い |
| thread -> source -> read を一気に試す | project source composite | `chromium-cdp-project-sources-turn-roundtrip` | composite。`--removeAfter` が escape hatch |
| 同名source更新後に読み直しを指示する | project source | `chromium-cdp-project-source-reread` | `--projectUrl` 必須。既存threadのcache/古い文脈を避ける |
| host repo snapshot を作る | host git | `chromium-cdp-source-snapshot-text` | Project Sources 用 current snapshot |
| worker成果を検証する | host git | `chromium-cdp-worker-artifact-validate` | `result.json` / `changes.patch` |
| worker patch を worktree へ適用する | host git | `chromium-cdp-worker-apply` | test と commit まで |
| thread/package 成果物を形式別に受け取り・検証・適用する | host orchestration | `chromium-cdp-package-run` | `patch` / `mbox` / `bundle` / `result.json` は thread 側自由形式ではなく host が検証・適用する |
| package 実装運用の状態を進める | host orchestration | `chromium-cdp-package-run-state` | `run.json` を正本に impl/review/finalize を管理する |
| worker branch を順にmergeする | host git | `chromium-cdp-worker-merge-queue` | host repo 正本へ統合 |
| 2worker運用の計画を作る | host git | `chromium-cdp-host-git-two-worker-smoke` | prompt とplan生成 |
| transport runtime を確認する | transport-only | `project-transport-doctor` | CDP / low-level command / wrapper command の存在確認。意味判断しない |
| CDP port を調べる | transport-only | `project-transport-env` | 9222/9223/9224 などを probe する。`project-route-not-verified` は probe 結果であり、同一 run の upload/thread/delayed assistant readback 成功を上書きしない |
| Project Source に置いて見えることを確認する | transport-only | `project-source-put` | auto で text/file 経路を分ける。visible-only は worker-readable 証明ではない |
| Project Source の一覧を確認する | transport-only | `project-source-list` | inventory parse。`count:0` と visible hints が矛盾したら `source-list-unreliable`。`source-list-empty` も worker-readable 不在の証明ではない |
| Project Source から1件削除する | transport-only | `project-source-delete` | exact title、reason、`--allow-remove`、before/after inventory 必須。内容承認しない |
| Project thread を作る | transport-only | `project-thread-create` | short pointer/control text だけを送る |
| 既存 Project thread に送る | transport-only | `project-thread-send` | inline 長文を拒否する |
| Project thread の readback を確認する | transport-only | `project-thread-readback` | 既定では assistant marker だけを合格にする。内容承認しない |
| artifact を回収して hash を出す | transport-only | `project-artifact-fetch` | `ARTIFACTS_MANIFEST.json` を書く |
| transport result を claim JSONL に積む | transport-only | `project-transport-claim` | append-only。claim を approval にしない |
| Project Source -> thread create の通常列を実行する | transport-only | `project-transport-run` | `transport-result.json` と `TRANSPORT_RUN_REPORT.md` を書く |

## thread file と project source の違い

ここを混同しやすいです。

### thread file

- 会話単位の入力や成果物
- upload 先は thread composer
- download は artifact として回収する
- 主用途は output / 回収
- 各会話の完了 / 要約 / 差分を持ち帰る面

使う command:

- `chromium-cdp-upload-chatgpt-file`
- `chromium-cdp-list-artifacts`
- `chromium-cdp-fetch-artifact`

### project source

- project 全体で共有したい背景 file
- 別 thread からも読めることが期待値
- 主用途は input / 共有背景
- upstream 追随後の最新版や担当仕様を共有する面
- 同名 file を再 upload しても、既存会話が自動で最新版を読むとは限らない
- 同名更新後は、担当会話へ「必ず Project Sources から読み直して。過去回答やキャッシュに頼らない」と送る

現在の live UI では、source 化ボタンが安定して見えるのは assistant turn 側です。

- user turn
  - file upload はできる
  - ただし source 化ボタンは見えないことがある
- assistant turn
  - `Add to project sources` が見える
  - `promote-turn` の現実的な本線

使う command:

- `chromium-cdp-project-sources-promote-turn`
- `chromium-cdp-project-sources-collect-files`
- `chromium-cdp-project-source-list`
- `chromium-cdp-project-source-delete`
- `chromium-cdp-project-sources-roundtrip`
- `chromium-cdp-project-sources-turn-roundtrip`

### いまの運用上の線

- `thread file`
  - 実地で安定している
- `project source`
  - helper はある
  - ただし live UI drift があり、composite workflow は未安定

なので当面は、

- output 回収
  - `thread artifact`
- shared background
  - `project source`

の二層で考える。

## 役割の固定

### 外部操作機構がやること

- `project source` を更新する
- 既存会話を開く
- 新規会話を作る
- 各会話に follow-up を送る
- 成果 artifact を download する
- merge 順を決める

### 各会話がやること

- `Project Sources` を読む
- 自分の担当を進める
- 完了 / 要約 / 差分を返す

### 人がやること

- conflict 時の方針判断
- merge の承認

## 安全な一本道

### 既存会話を読む

1. `chromium-cdp-chatgpt-doctor`
2. `chromium-cdp-open-thread --url ...`
3. `chromium-cdp-read-thread --url ... --openIfNeeded --irPath /tmp/thread.json`

#### SPA navigation timeout の復旧

`chromium-cdp-open-thread` や `chromium-cdp-read-thread --openIfNeeded` が
`timeout waiting for ChatGPT SPA navigation` で止まる時は、high-level navigation を
続けて retry しません。

低レベルに落として、target を先に作ってから `--id` 固定で読みます。

```bash
target_json=$(nix run .#cdp-bridge -- new \
  --addr 127.0.0.1 \
  --port 9223 \
  --url "https://chatgpt.com/c/<thread-id>")

target_id=$(printf '%s\n' "$target_json" | jq -r '.id')

nix run .#chromium-cdp-read-thread -- \
  --url "https://chatgpt.com/c/<thread-id>" \
  --id "$target_id" \
  --addr 127.0.0.1 \
  --port 9223 \
  --waitMs 90000 \
  --pollMs 3000 \
  --tail 20 \
  --stabilityRounds 5 \
  --irPath /tmp/thread-ir.json \
  --stats
```

実測ではこの経路で、`open-thread` の SPA navigation timeout 後でも
既存会話の本文と upload chip 一覧を取得できました。

### 会話成果を回収する

1. `chromium-cdp-list-artifacts --irPath /tmp/thread.json`
2. `chromium-cdp-fetch-artifact --irPath /tmp/thread.json --name <artifact> --outDir /tmp/out`

知見:

- 通常の file chip は browser download として回収する。
- 回答本文内の `sandbox:/mnt/data/...` は `<a>` ではなく `button.behavior-btn` として出ることがある。
- その場合、`innerText` では見えず `textContent` や React props 内の `href` からだけ見えることがある。
- `chromium-cdp-list-artifacts` は `kind=sandbox_button`, `match=react_sandbox_href` として列挙する。
- `chromium-cdp-fetch-artifact` は browser download が発生しない時、UI が発火した authenticated interpreter download response をCDP内で捕まえ、zip bytesならbase64復元する。
- backend が `{"status":"retry"}` を返し続ける場合は、CDP認識の問題ではなく、その sandbox file がその時点で materialize されていない扱いにする。

### project から新規会話を作って送る

1. project page を live tab で開く
2. `chromium-cdp-create-project-thread --projectUrl ... --id <target-id> --text ...`
3. `chromium-cdp-send-chatgpt --url <thread-url> --text ...`

### project source を試す

1. `chromium-cdp-project-sources-promote-turn`
2. `chromium-cdp-project-sources-collect-files`
3. 必要なら `*-roundtrip`

`*-roundtrip` は primitive が通ることを確認してから使う。

## 今の用途ごとの推奨

### 会話へ共通背景を渡したい

- `project source`

### 会話の成果を持ち帰りたい

- `thread artifact`

### 会話に次の担当だけ投げたい

- `chromium-cdp-send-chatgpt`

### project 配下に新しい担当会話を増やしたい

- `chromium-cdp-create-project-thread`

## 実地で通った手動オーケストレーション

いま live project で通った最小手順はこれです。

1. writer thread に file を upload する
   - `chromium-cdp-upload-chatgpt-file`
2. assistant に file 中身を言い直させる
   - `chromium-cdp-send-chatgpt`
3. その assistant turn を source 化する
   - `chromium-cdp-project-sources-promote-turn`
4. project page から新規 reader thread を作る
   - `chromium-cdp-create-project-thread`
   - または project page で `send-chatgpt`
5. reader thread で `Project Sources` を読むよう依頼する
   - `chromium-cdp-send-chatgpt`
6. `chromium-cdp-read-thread` で返答を確認する

この flow では、

- writer thread
  - `source-token.txt` を upload
- promoted source
  - assistant turn の token text
- reader thread
  - exact token を返答

まで確認できています。

## まだ不足しているもの

- `project source delete`
  - まだ first-class ではない
- `project source update/replace`
  - rename は不要だが、replace は将来必要
- same-name project source reread helper
  - 同名更新後に各 thread へ再読込指示を送る primitive があると安全
- backend exact model id
  - UI label は取れているが backend exact id は未確定

## 迷った時の判断

- 「会話の中だけで閉じる」なら `thread`
- 「project 全体で共有したい」なら `project source`
- 「一発でやりたい」なら `roundtrip`
- 「まず責務を切って確実に進めたい」なら primitive
