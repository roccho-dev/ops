# Host Git Project Workflow

目的は、同じ ChatGPT Project 内の複数 thread に実装を分担させ、host 側の git repo を正本として更新することです。

この運用では、`Project Sources` は共有背景、`thread artifact` は成果回収、host git repo は正本です。

## 再利用できる command

| command | 役割 |
|---|---|
| `chromium-cdp-source-snapshot-text` | host repo から text snapshot と `SOURCE_MANIFEST.json` を作る |
| `chromium-cdp-upload-project-source-text` | text snapshot / manifest / rules を Project Sources へ upload する |
| `chromium-cdp-upload-project-source-file` | binary zip などの実 file を Project Sources へ upload する |
| `chromium-cdp-create-project-thread` | Project 内に worker thread を作る |
| `chromium-cdp-send-chatgpt` | worker thread へ担当指示を送る |
| `chromium-cdp-wait-artifacts` | worker artifact が出るまで長め間隔で待つ |
| `chromium-cdp-fetch-artifact-strict` | 同名 stale download を隔離してから artifact を回収する |
| `chromium-cdp-downloads-quarantine` | `/home/nixos/Downloads` 等の同名 file を隔離する |
| `chromium-cdp-worker-artifact-validate` | `result.json` と `changes.patch` を検証する |
| `chromium-cdp-worker-apply` | patch を `repo/.worktrees/<worker>` に適用し、test と commit まで行う |
| `chromium-cdp-worker-am-apply` | `git format-patch --stdout` 形式の mbox を `git am --3way` で適用する |
| `chromium-cdp-package-run` | `patch` / `mbox` / `bundle` / `result.json` を host orchestration 側で検出・検証・適用する |
| `chromium-cdp-package-run-state` | `run.json` を正本に package 実装の impl/review/finalize 状態を進める |
| `chromium-cdp-git-ref-health` | `git+file://` 検証前に stale / invalid ref を検出し、`path:$PWD#...` へ寄せる判断材料を出す |
| `chromium-cdp-thread-ledger` | `zeal0/9/thread/1` のように thread URL、prompt文字数、report、retry を測定する |
| `chromium-cdp-worker-merge-queue` | worker branch を host repo の target branch へ順に merge する |
| `chromium-cdp-project-source-reread` | epoch 固有 Project Source を各 thread へ再読込指示する。`--projectUrl` は必須 |
| `chromium-cdp-host-git-two-worker-smoke` | 2 worker 運用の計画 file と worker prompt を生成する |
| `chromium-cdp-host-git-workflow-regression` | 実地で遭遇したブロックのoffline回帰テストをまとめて走らせる |

## 標準 flow

1. host repo から snapshot を作る。

```bash
chromium-cdp-source-snapshot-text \
  --repo /home/nixos/repos/cdp-ops-test/testrepo \
  --outDir /home/nixos/repos/cdp-ops-test/sources \
  --epoch 1 \
  --snapshotName repo-snapshot-epoch-1.txt \
  --manifestName SOURCE_MANIFEST.epoch-1.json
```

2. Project Sources へ text source を upload する。

```bash
chromium-cdp-upload-project-source-text --projectUrl "$PROJECT_URL" --file sources/repo-snapshot-epoch-1.txt
chromium-cdp-upload-project-source-text --projectUrl "$PROJECT_URL" --file sources/SOURCE_MANIFEST.epoch-1.json
chromium-cdp-upload-project-source-text --projectUrl "$PROJECT_URL" --file sources/OPERATING_RULES.md
```

Project Sources は実運用上 append 的に見えることがあります。同名 file を再 upload しても、既存 thread が古い source を読むことがありました。標準運用では `repo-snapshot-epoch-<n>.txt` と `SOURCE_MANIFEST.epoch-<n>.json` のように epoch 固有名を使い、worker prompt でも exact filename を指定します。

3. worker thread を作り、担当 prompt を送る。

```bash
chromium-cdp-create-project-thread --projectUrl "$PROJECT_URL" --text "$(cat thread-a.prompt.txt)"
chromium-cdp-create-project-thread --projectUrl "$PROJECT_URL" --text "$(cat thread-b.prompt.txt)"
```

`chromium-cdp-create-project-thread` は既定で composer の `Extended Pro` pill を確認します。`Extended Pro` でない thread はこの運用の期待状態ではないため、作成前に止めます。

4. 成果 artifact を待ってから strict に回収する。

```bash
chromium-cdp-wait-artifacts \
  --url "$THREAD_A" \
  --name thread-a.result.json \
  --name thread-a.changes.patch \
  --intervalMs 600000 \
  --timeoutMs 1800000

chromium-cdp-fetch-artifact-strict --url "$THREAD_A" --name thread-a.result.json --outDir downloads/thread-a
chromium-cdp-fetch-artifact-strict --url "$THREAD_A" --name thread-a.changes.patch --outDir downloads/thread-a
```

Extended Pro の回答は長く、アカウント保護の観点でも短周期 polling は避けます。標準 interval は 10 分です。

5. artifact を検証し、worktree に適用する。

成果物形式の正本化は thread 側ではなく host orchestration 側の責務です。thread は `result.json` と実体 artifact を返し、host は `chromium-cdp-package-run` で patch / mbox / bundle を検証してから適用します。

```bash
chromium-cdp-worker-artifact-validate \
  --repo "$REPO" \
  --result downloads/thread-a/thread-a.result.json \
  --patch downloads/thread-a/thread-a.changes.patch \
  --expectedBaseRev "$BASE_REV" \
  --worker thread-a

chromium-cdp-worker-apply \
  --repo "$REPO" \
  --worktree "$REPO/.worktrees/thread-a" \
  --branch worker/thread-a \
  --result downloads/thread-a/thread-a.result.json \
  --patch downloads/thread-a/thread-a.changes.patch \
  --expectedBaseRev "$BASE_REV"

# patch / mbox / bundle を1つの host orchestration 入口で扱う場合:
chromium-cdp-package-run \
  --repo "$REPO" \
  --worktree "$REPO/.worktrees/thread-a" \
  --branch worker/thread-a \
  --result downloads/thread-a/thread-a.result.json \
  --patch downloads/thread-a/thread-a.changes.patch \
  --expectedBaseRev "$BASE_REV"
```

複数 commit を worker に作らせる場合は、個別 patch file を複数返させるより、単一 mbox を返させます。
`git am` は patch series の順序とmessageを保ちますが、commit hash はhost側で変わることがあります。merge対象はhost側で作られたworker branchのHEADです。

worker に要求する artifact:

```text
thread-a.series.json
thread-a.series.mbox
```

`thread-a.series.json` の最小内容:

```json
{
  "worker": "thread-a",
  "baseRev": "<SOURCE_MANIFESTのbaseRev>",
  "status": "ready",
  "patchFormat": "git-format-patch-mbox",
  "patchCount": 2,
  "filesChanged": ["src/a.txt", "src/b.txt"]
}
```

host 側での適用:

```bash
chromium-cdp-worker-am-apply \
  --repo "$REPO" \
  --worktree "$REPO/.worktrees/thread-a" \
  --branch worker/thread-a \
  --series downloads/thread-a/thread-a.series.json \
  --mbox downloads/thread-a/thread-a.series.mbox \
  --expectedBaseRev "$BASE_REV"
```

6. 完了 branch を順に merge する。

```bash
chromium-cdp-worker-merge-queue \
  --repo "$REPO" \
  --target main \
  --branch worker/thread-a \
  --branch worker/thread-b
```

7. merge 後に snapshot を更新し、Project Sources へ再 upload する。

新しい epoch 固有名で upload した後、各 thread に必ず再読込を指示します。

```bash
chromium-cdp-project-source-reread \
  --projectUrl "$PROJECT_URL" \
  --url "$THREAD_A" \
  --url "$THREAD_B" \
  --manifest "SOURCE_MANIFEST.epoch-$NEW_EPOCH.json" \
  --epoch "$NEW_EPOCH" \
  --baseRev "$NEW_HEAD"
```

Project Sources の画面に新しい file が見えていても、既存 thread 側の source 解決へ反映されるまで遅れることがあります。thread が `not found` や似た旧名を返した場合は、2-3 分待ってから同じ `chromium-cdp-project-source-reread` を再実行します。message では exact filename を指定し、似た名前や旧 epoch を無視させます。

Project Source に依存する操作では `threadUrl` だけを根拠にしません。`--projectUrl` を必須にし、Project Source 画面で期待 file 名が見えること、対象 thread URL が同じ Project 系であること、送信後に readback で新しい turn / 返答を確認できることを別々の evidence として扱います。CDP の成功コードだけでは semantic success に昇格しません。

## worker runtime bundle policy

過去の `zeal0/9` 実地では、ChatGPT thread 側は Python / pip、Node、Go などをある程度実行できる一方、外部 network から依存を取得できない前提で扱う必要がありました。そのため、本体 repo や `spec.zip` だけを渡しても、依存取得が必要な build は失敗しやすいです。

採用方針は、thread に「こちらの動作環境を提供する upload」を渡す場合、source だけでなく、thread 内で使う architecture 向けの prebuilt 依存を同梱することです。候補は `x86_64-unknown-linux-gnu` / `amd64` 相当です。正確な target triple は、thread 側実地で `uname -m`、`python -c 'import platform; print(platform.platform())'`、`node -p process.platform + ':' + process.arch`、`go env GOOS GOARCH` を確認して固定します。

runtime bundle に入れる最小情報:

- `SOURCE_MANIFEST` と対応する `spec.zip` / source snapshot。
- Python wheels、npm cache または `node_modules`、Go module vendor/cache などの offline 依存。
- 必要なら native binary を thread 側 architecture 向けに build 済みにしたもの。
- `RUNTIME_MANIFEST.json` に architecture、tool versions、file sha256、entrypoint、test command、offline 制約を書く。
- worker prompt には「network install をしない。bundle 内の依存だけを使う」と明記する。

runtime bundle の生成は `parts/devenv-pkgs` の責務に寄せます。現在の標準運用は、Project Sources を共有背景、thread artifact を成果回収、host git repo を正本とする方式です。worker は開始時に runtime bundle の visibility、sha256、`/usr/bin/unzip -q` 展開、verifier proof を返します。

## specs upstream 後の ops 実装開始条件

`repos/specs` の upstream が完成した後に `repos/ops` 実装へ進む時は、先に `specs` 側の契約を正本として扱います。`ops` thread へは「実装してよい package」「check package」「cutover 条件」「禁止 path」を明示し、thread の判断で package 境界を増やさせません。

標準構成:

- `impl thread`: `repos/ops` の package 実装を作る。
- `reviewer thread`: impl の相談相手兼 gate。目的・背景・package 境界・check-as-package 方針を知った状態で、impl から出た成果を批判的に見る。
- `host/gen0`: thread 成果を回収し、git worktree へ適用し、Nix で可能な限り検証し、採用/差し戻しを決める。

開始前に必ず渡すもの:

- 最新 `repos/specs` snapshot または git bundle。
- `packages/check-packages-contract` を含む `specs` の package catalog。
- `repos/ops` 用 task prompt。
- 可能なら Nix runtime / devenv package / offline dependency bundle。
- `RUNTIME_MANIFEST.json`。少なくとも architecture、tool versions、sha256、entrypoint、test command、network 禁止条件を書く。

worker に要求する最小 proof:

- 渡された `specs` と runtime bundle を見えていること。
- sha256 が一致すること。
- `/usr/bin/unzip -q` で展開できること。
- `nix` が使えるなら `nix flake check` または対象 package build を実行した結果。
- `nix` が使えないなら、なぜ使えないか、代替で走らせた構文/単体/スモーク検証。
- `result.json` に `checks[]` と `blocked[]` を必ず書くこと。

reviewer に要求する最小 proof:

- impl が `specs` の package 境界を守っていること。
- acceptance-blocking validation が package-backed check になっていること。
- `checks.<system>.*` が匿名 check ではなく、`checkPackageContract` または aggregate check package に対応していること。
- Nix 検証が未実行の場合、未実行を pass と扱っていないこと。
- host/gen0 が次に何を検証すべきかを明示していること。

reviewer の主責務は、単なる賛否やコード品質ではなく「0 が記憶を失っても同じ成果を再現できる設計になっているか」の確認です。再現設計は抽象論では不十分です。必ず具体的な repo path、package 名、schema 名、artifact 名、thread URL、evidence path、check output、cutover 条件を接続して説明させます。

4原則の扱い:

- KISS: 同じ意味の入口を増やさず、正本 path を1つにする。
- DRY: 同じ契約を docs と code に二重定義しない。docs は正本 schema/package へリンクする。
- SOLID: package ごとの責務を1つにし、reviewer は責務の混線を指摘する。
- YAGNI: future package や planned package は active output にしない。必要になった時だけ昇格条件を満たして active 化する。

reviewer は「ドキュメントがある」だけでは pass にしてはいけません。ドキュメント、schema、package、check、artifact、status ledger が互いにリンクしており、リンク切れ時にどの check が落ちるかまで示せる時だけ pass にします。

### Project Source binary zip dogfood

`zeal0/9/20` で、binary zip を Project Sources に置き、別 thread から実体 file として使えるかを確認しました。

実地で通った形:

- Project Sources 画面で Sources 用 file input に `spec-env-pack-ps-binary-challenge.zip` を upload する。
- 画面上は `spec-env-pack-ps-binary-challenge.zip` として表示される。
- 画面には `File contents may not be accessible` と出るが、worker thread では `/mnt/data/spec-env-pack-ps-binary-challenge.zip` として見えた。
- worker thread で sha256 が期待値と一致した。
- `/usr/bin/unzip -q` で展開できた。
- `python3 verify/verify-env.py --out ENV_PROOF.from-project-source.json` が `ok=true` で通った。
- `PS_BINARY_CHECK.json`、`PS_BINARY_CHECK.txt`、`ENV_PROOF.from-project-source.json` を artifact として回収できた。

固定知見:

- binary zip は Project Sources に置ける。
- Project Sources に置いた binary zip は、少なくともこの実地では worker runtime の `/mnt/data` に materialize された。
- Python の `zipfile.extractall` は executable bit を落とし、同梱 `nix/bin/nix` や `bin/spec-env-tool` が `PermissionError` になることがありました。worker 指示では `/usr/bin/unzip -q` を優先します。
- これで短期運用は「各 thread へ毎回 runtime zip 添付」ではなく、「Project Source に package runtime zip を置き、worker は開始時に visibility / sha256 / unzip / verifier を確認する」へ寄せられます。

### spec-env pack dogfood

`zeal0/9/18` で、`spec.zip` に近い環境定義 zip を thread file として渡す最小試験を実施しました。Project Sources への binary zip 共有ではなく、まず「thread が zip を展開し、最初に環境確認を走らせ、proof artifact を返せるか」を確認したものです。

実地で通った形:

- host 側で Project composer を開く。
- `chromium-cdp-upload-chatgpt-file` で zip を attach する。
- 同じ composer から `chromium-cdp-create-project-thread` で初回 message を送る。
- worker には一意名の artifact を要求する。例: `ENV_PROOF.v3.json`、`ENV_LOG.v3.txt`。
- `chromium-cdp-wait-artifacts` を 10 分間隔で待つ。
- `chromium-cdp-fetch-artifact-strict` で回収する。

試験結果:

- thread 側の platform は `Linux-4.4.0-x86_64-with-glibc2.36`。
- thread 側の Python は `3.11.8`。
- zip は `/mnt/data/spec-env-work-v3` に展開された。
- `python3 verify/verify-env.py --out ENV_PROOF.v3.json` は `ok=true`。
- 同梱 `./nix/bin/nix --version` は `nix (spec-env-pack portable verifier shim) 0.1.0`。
- 同梱 `./nix/bin/nix flake check --offline .` は成功。
- 同梱 `./bin/spec-env-tool --json` は成功。

この dogfood の `nix/bin/nix` は real Nix ではありません。`/nix/store` なしで最初の検証を強制する portable verifier shim です。real Nix が必要な試験は別 contract にします。

重要な固定知見:

- worker 自身に「Extended Pro か」を自己判定させると、本文では `GPT-5.5 Pro` と名乗って止まることがあります。`Extended Pro` gate は host CDP の DOM preflight を正にします。
- zip などの binary は `DataTransfer` text fallback で渡してはいけません。壊れた添付に見えるか、thread 側で file が見えません。
- binary attach は `cdp-bridge filechooser` を使います。ChatGPT の file input は hidden なので、bridge は hidden input の座標クリックではなく `el.click()` を user gesture 付きで実行して `Page.fileChooserOpened` を受ける必要があります。
- 同名 artifact は stale と混ざるため、再試験では `ENV_PROOF.v3.json` のように一意名を使います。

## 将来対応: project/package/thread role

複数 package を同時に回す場合は、`1 Project = 1 package` を標準候補にします。Project Sources にその package の目的、背景、spec、runtime bundle、検証資料を集めることで、impl thread と review thread が同じ前提から始められます。

命名規則の候補:

- Project 名は `<repo>/<package>` にする。
- 例: `flakes/parts-cdp`、`flakes/remote-forge`、`app_toyhobby/api`。
- 探索用に、Project Source の manifest に同じ `repo`、`package`、`projectName`、`epoch`、`baseRev` を入れる。
- thread 名または初回 prompt に role を明記する。例: `role=impl`、`role=review`、`role=merge`、`role=spec-maintainer`。

role の候補:

- `impl`: 担当仕様行を実装し、patch / mbox / result を返す。
- `review`: package の目的、背景、spec、runtime を読んだ上で、impl 方針のぶれ、仕様漏れ、test不足を指摘する。
- `merge`: host が回収した成果を統合するための conflict 方針案を出す。最終 merge 判断は host 側。
- `spec-maintainer`: 実装結果やレビュー結果から `SPEC_MATRIX` / `TASK_QUEUE` の不足を提案する。

`0` は review を担当しません。`0` は review thread にも package の目的と背景を同時に渡し、review の入力条件を揃えます。そのうえで `0` は、review 結果を受理するか、impl へ差し戻すか、merge へ進めるかを判断します。

この方式の利点:

- review thread も検証に必要な環境が Project 内に揃った状態で開始できる。
- impl thread の方針ぶれを、`0` の手動レビューではなく独立 role に寄せられる。
- `<repo>/<package>` で探索しやすく、Project の乱立を後から整理しやすい。

注意点:

- Project が package 単位で増えるため、repo 横断 refactor では複数 Project の manifest を同期する必要があります。
- review thread は実装者と同じ背景を持つ一方、同じ誤前提も共有しやすいです。review prompt には「目的から逆算して反証する」「impl 方針を前提にしない」を入れます。

## thread ledger and prompt compression

`0/N` が複数 ChatGPT thread を使う場合、thread URL は `0/N/thread/<n>` の形で `0/N` が番号管理します。例: `zeal0/9/thread/1`、`zeal0/9/thread/2`。

測定するもの:

- prompt 文字数。
- prompt 回数。
- retry 回数。
- thread からの report 回数。
- artifact 数。
- 成功/失敗。

標準 command:

```bash
chromium-cdp-thread-ledger init \
  --ledger "$RUN_DIR/thread-ledger.json" \
  --owner zeal0/9 \
  --task package-review

chromium-cdp-thread-ledger register \
  --ledger "$RUN_DIR/thread-ledger.json" \
  --owner zeal0/9 \
  --index 1 \
  --role review \
  --url "$THREAD_URL"

chromium-cdp-thread-ledger interaction \
  --ledger "$RUN_DIR/thread-ledger.json" \
  --thread zeal0/9/thread/1 \
  --kind prompt \
  --promptPath review-prompt.md \
  --ok

chromium-cdp-thread-ledger interaction \
  --ledger "$RUN_DIR/thread-ledger.json" \
  --thread zeal0/9/thread/1 \
  --kind report \
  --artifact review.result.json \
  --ok

chromium-cdp-thread-ledger summary --ledger "$RUN_DIR/thread-ledger.json" --json
```

prompt 圧縮の標準形:

```text
role=<impl|review>
targetRevision=<exact>
read=<exact artifact/source names>
fill=<TSV/JSON schema name>
finish=<all rows pass/carried/blocked>
output=<exact artifact names>
```

thread は表を渡されると全行を埋めようとする傾向があるため、長い prose より `REVIEW_GATE.tsv` / `BLOCKERS.tsv` のような短い schema を優先します。`not-run` を許す場合でも、FSM 側では `not-run` を final pass にしません。

実地で見えた効果:

- 長い review 契約 prompt は 3181 文字と 3491 文字で、初回は `not-run` を pass 扱いして retry が必要でした。
- 短縮 prompt は 1524 文字で、`REVIEW_GATE.tsv` と `BLOCKERS.tsv` を渡しただけで全行を埋め、`not-run` を final pass にせず `verdict=fail` を返しました。
- そのため、`0/N -> thread` では「長い説明」より「短い role / target / read / fill / finish / output + 表 schema」を標準候補にします。
- 効果測定は `chromium-cdp-thread-ledger` の `promptChars`、`retryCount`、`reportCount`、`failedEvents` で行います。
- Project Source が append 的に残る場合があるため、epoch 固有名と exact manifest 指定は引き続き必須です。

## 将来対応: canon-tdd spec contract

host と worker thread の双方向やり取りを減らすには、task list と `spec.zip` の質を上げます。worker に小さな都度指示を出し続けるのではなく、最初に「どの仕様行を、どの優先順位で、どのtestで満たすか」を渡します。

`spec.zip` に入れる最小 contract:

- `SPEC_MATRIX.json` または `SPEC_MATRIX.csv`: 仕様行の正本。
- `CANON_TDD.md`: canon-tdd の進め方。
- `TASK_QUEUE.json`: worker に割り当てる仕様行 id と順序。
- `TEST_PLAN.md`: 小さい test で大きい機能を担保する優先順位。
- `RUNTIME_MANIFEST.json`: 実行環境、offline 制約、test command。

`SPEC_MATRIX` の最小列:

- `specId`: 安定した仕様 id。
- `priority`: `P0` / `P1` / `P2`。
- `behavior`: 実現したい振る舞い。
- `acceptance`: 受入条件。
- `testName`: 対応する test 名。
- `testCommand`: host で実行する検証 command。
- `status`: `todo` / `test-red` / `test-green` / `refactored`。
- `evidence`: test log、artifact 名、commit、patch 名。

canon-tdd の worker 指示:

- まず全仕様を matrix として読み、担当範囲を明示する。
- 優先順位は「小さな test で大きな機能を担保できる行」を先にする。
- 仕様行ごとに red test、green 実装、refactor を進める。
- すべての担当仕様行が `refactored` になるまで止めない。
- 完了時は `result.json`、`*.series.mbox` または `changes.patch`、`SPEC_MATRIX.update.json`、`TEST_REPORT.md` を返す。

host 側は常に検証します。ただし、これは重い意味での全手動レビューではありません。基本は機械的で安い gate です。

- `baseRev` が一致するか。
- artifact 名と schema が contract 通りか。
- patch / mbox が適用できるか。
- `SPEC_MATRIX.update.json` の担当行が `refactored` まで進んだか。
- `testCommand` が通るか。
- conflict、schema不一致、test失敗、仕様行の未完了だけを人へ上げる。

この形なら、thread との会話は「タスク一覧を渡す」「成果物を回収する」「失敗時だけ差し戻す」に寄せられます。host は正本 repo と gate を持ち、worker は完成品に近い patch series を返します。

## package-run artifact contract

`cdp/package-run` の責務は、thread 内で成果物を曖昧に実行・適用することではありません。thread artifact は untrusted な出力として扱い、`patch` / `mbox` / `bundle` / `result.json` の受け取り・検証・適用は host orchestration 側の責務です。

標準 contract:

- `result.json` は worker、`baseRev`、status、変更 file、artifact format を宣言する metadata です。host は source manifest の `baseRev` と一致するかを確認します。
- `changes.patch` は単一 commit 相当の差分です。host は `chromium-cdp-worker-artifact-validate` と `git apply --check` で検証し、`chromium-cdp-worker-apply` で worktree に適用します。
- `*.series.mbox` は複数 commit 用です。host は `series.json` の `patchFormat=git-format-patch-mbox` と `baseRev` を確認し、`chromium-cdp-worker-am-apply` で `git am --3way` 適用します。
- `bundle` は thread が任意に実行してよい成果物ではありません。Project Source runtime bundle または thread artifact bundle は、host が sha256、manifest、unzip/verifier proof、offline 制約を確認したうえで次 epoch の Project Source / host repo 操作へ反映します。

したがって、package 単位の run/merge は thread 側の自由形式ではなく、host が strict fetch、schema check、baseRev check、patch/mbox apply check、test command、commit/merge を順に通す orchestration として実行します。

## ブロックと固定対策

| block | 固定対策 |
|---|---|
| CDP port が `9222` へ落ちる | `HQ_CHROME_PORT` または `--port` を必ず指定する |
| Project page が shell/home へ drift する | live project tab の target id を渡す |
| binary zip を Project Sources へ upload したい | `chromium-cdp-upload-project-source-file` を使う |
| Project Source binary zip が worker で使えるか不明 | worker 開始時に visibility / sha256 / `/usr/bin/unzip` / verifier proof を必須にする |
| Python `zipfile.extractall` で executable bit が落ちる | worker 指示では `/usr/bin/unzip -q` を優先する |
| Project Source から host へ download できない | Source は入力専用、成果回収は thread artifact に寄せる |
| 同名 Project Source が古く読まれる | 同名更新を標準にしない。epoch 固有名で upload し、exact manifest 名を指定して `chromium-cdp-project-source-reread` を送る |
| thread 内で外部依存を network 取得できず build が失敗する | `parts/devenv-pkgs` で thread 側 architecture 向けの prebuilt runtime bundle contract を作り、worker 開始時に visibility / sha256 / unzip / verifier proof を必須にする |
| worker への個別指示が増えすぎる | `spec.zip` に仕様matrix、task queue、canon-tdd規約を入れ、成果物 contract を固定する |
| thread 成果物の実体形式が弱い | `patch` / `mbox` / `bundle` / `result.json` の受け取り・検証・適用は host orchestration 側の責務に固定し、thread 側の自由形式 `package-run` にしない |

## package-run state contract

`chromium-cdp-package-run` は成果物の検証と適用を行う実行器です。運用全体の状態管理は `chromium-cdp-package-run-state` に分けます。

`chromium-cdp-package-run-state` は `run.json` を正本にし、次を固定します。

- `init`: package、repo、source zip、baseRev を記録する。
- `collect-impl`: impl thread の `result.json` と `changes.patch` を一意名で回収する。
- `record-timeout`: 15分間隔の待機で成果物が出ない時、待ち続けず timeout state と retry 根拠を記録する。
- `validate-host`: host 側 worktree で patch を適用し、test/check を実行する。
- `retry-impl`: 失敗時の再依頼 prompt と次 attempt 名を作る。
- `review-prompt`: review thread の責務を canon-tdd 品質、CI/spec 品質、必要な検証 evidence の有無に限定する。
- `collect-review`: `targetRevision` と `qualityGate` を受け取り、形式不備と品質 fail を分けて止める。
- `finalize`: host validation と review quality が両方 pass の時だけ完了にする。

### FSM を使わない脱線を禁止する

package thread 運用では、`chromium-cdp-package-run-state` を使います。

手動で `sleep`、`read-thread`、`send-chatgpt`、artifact fetch を直接つなぐと、次の問題が起きます。

- timeout / retry / review の状態が `run.json` に残らない。
- artifact 名が attempt ごとに固定されず、古い成果物と混ざる。
- review が出した retry 条件を、host が口頭で再解釈してしまう。
- `0` が「終わったつもり」になりやすい。
- FSM 自体の wrapper / PATH / script 名の回帰が実運用まで見つからない。

今回の実地では、FSM を使わず手動運用したため、`ops-agent-events` の retry が一度 `run.json` 外で進みました。
その結果、`chromium-cdp-package-run-state retry-impl` 内の `send-chatgpt.mjs` 呼び出し名と `cdp-bridge` PATH の不足が遅れて発覚しました。

今後の原則:

- package thread を作った時点で `init` する。
- artifact がない時は `record-timeout` で止める。
- retry は `retry-impl` が生成する attempt 名と prompt を使う。
- impl 成果物は `collect-impl` で回収する。
- host 検証は `validate-host` に集約する。
- review は `review-prompt` / `collect-review` で進める。
- `finalize` なしに完了扱いしない。

review thread が見る品質 gate は次です。

```text
requirementsDefined
specTableComplete
testsMeasureSpecs
canonTddPriorityOrder
canonTddCycleEvidence
ciGateDefined
implDidNotWeakenTests
workerSourceReadbackValidated
readOnlySourceValidated
nativePathChecksRunOrCarried
updatedTargetHonored
```

review result は `schema=cdp.packageReview.v1` を返します。`verdict=pass` は、全 gate が `pass`、`targetRevision` が最新 attempt と一致、`blockingIssues` が空の時だけ有効です。

- `review-artifacts-ready`: 形式も品質も pass。`finalize` 可能。
- `impl-artifacts-timeout`: 成果物未生成。`retry-impl` で「次はblocked resultでもよいのでstreaming継続しない」と明示する。
- `review-artifacts-timeout`: review成果物未生成。review promptを再生成するか、bounded artifact名で再依頼する。
- `review-quality-failed`: JSON 形式と対象 revision は正しいが、gate が `fail` / `not-run` または blocker がある。`retryInstruction.sendTo` に従って `impl` / `host` / `review` へ戻す。
- `review-format-failed`: schema、`targetRevision`、artifact 名、`blockingIssues` と `verdict` の整合などが壊れている。review thread へ契約を締め直して再依頼する。

実地で確認した review prompt の注意点:

- review thread は、更新 target を明示すれば既存 thread のままでも新しい対象へ追随できました。
- ただし `not-run` を許すだけだと、`readOnlySourceValidated=not-run` のまま `verdict=pass` を返すことがありました。
- Project Sources の collect/find だけでは `workerSourceReadbackValidated=pass` にしません。worker が exact filename、sha256、unzip/extract、verifier proof を返した時だけ pass にします。
- そのため prompt と FSM の両方で「required gate の `not-run` は pass 不可」と固定します。
- host-owned validation evidence が無い時は、review は `HOST_VALIDATION_MISSING` で `verdict=fail` にし、`retryInstruction.sendTo=host` を返します。
| Project Source upload target が `about:blank` のままになる | upload script が実DOMの `location.href` を確認し、必要なら明示 navigate する |
| Project Source upload 直後に file input がまだ無い | upload script が file input の出現を待つ |
| worker thread composer が hidden textarea を拾う | create script が visible contenteditable textbox を優先する |
| project page の composer がまだ出ていない | create script が composer の出現を待つ |
| 生成中 thread を read できず polling に入れない | `--poll-success-condition stop_button_gone` の時だけ生成中 preflight を許可する |
| 新 source が画面上に見えるのに既存 thread が読めない | source indexing delay とみなし、2-3 分後に exact filename で reread を再送する |
| Source upload proof はあるが worker が必須 file を missing と返す | upload proof だけでは pass にしない。exact filename の reread を送り、必要なら該当 TSV 行や hash を host-provided cross-check として本文にも添える。worker は limitation を RESULT_SUMMARY に残す |
| project thread 作成時に prompt が入力済みだが送信されない | `send-chatgpt` 相当で `button[data-testid=send-button]` / `#composer-submit-button` を明示 click する。送信後は `read-thread` で user turn 追加を確認する |
| 入力欄は有効だが stop button が残り、送信できていない | 「入力できる」と「送信完了」を分ける。`send-chatgpt` は既定で stop button 中の送信を拒否する。`--allowGenerating` は診断用に限り、prompt が消えない時は `send_not_confirmed_prompt_not_cleared` として未送信扱いにする |
| 同名 artifact が stale reuse される | `chromium-cdp-fetch-artifact-strict` で既存 download を隔離する |
| `Extended Pro` でない thread が作られる | `chromium-cdp-create-project-thread` が既定で `Extended Pro` pill を確認してから送信する |
| worker artifact 生成に数分かかる | `chromium-cdp-wait-artifacts` で 10 分程度の間隔を空けて待つ |
| worker ごとの artifact 名が衝突する | `thread-a.result.json` のように worker 名を入れる |
| worker 自身のモデル自己申告が `Extended Pro` と一致しない | model gate は host CDP DOM preflight を正にし、worker 自己申告だけで止めない |
| zip 添付が text fallback になり binary が壊れる | `chromium-cdp-upload-chatgpt-file` は `#upload-files` を `cdp-bridge filechooser` で開く。binary では text fallback を拒否する |
| hidden file input の座標クリックで file chooser が開かない | `cdp-bridge filechooser` は `el.click()` を user gesture 付きで実行する |
| Project Sources が 40 file 上限で増やせない | 既存Sourceを勝手に削除しない。必要ファイルは新Projectへ移すか thread 添付へ切替え、添付方式・thread URL・不足物を status に残す |
| Project Sources の 40 file 上限 toast が出ている | CDP helper が toast を確実に読めるとは限らない。upload timeout、対象fileが一覧に出ない、Source数が多い時は上限候補として扱い、新Projectまたはthread添付fallbackへ切替える |
| Extended Pro の重い実装が長時間 streaming のまま本文が増えない | 実装系は最低60分は待つ。60分後も `read-thread` の `textLen` / `preview` が変わらなければ stuck とみなし、stop 後に phase を小さくした prompt で再開する |
| patch 形式が揺れる | `git apply --check` を正にする |
| 複数 patch artifact が揃わない | 単一 `*.series.mbox` を返させ、host が `git am --3way` で適用する |
| `repo/.worktrees` が untracked になる | script が `.git/info/exclude` に `.worktrees/` を自動追加する |

## 成功条件

- 各 worker が一意名の `*.result.json` と `*.changes.patch` を返す。
- 複数 commit の時は、各 worker が一意名の `*.series.json` と `*.series.mbox` を返す。
- host が strict fetch で artifact を回収できる。
- `result.json` の `baseRev` が source manifest と一致する。
- patch が worker worktree に適用できる。
- mbox の `baseRev` が source manifest と一致し、`git am --3way` で worker worktree に適用できる。
- test が通る。
- commit と merge が完了する。
- merge 後の epoch 固有 manifest を upload し、各 thread が明示再読込で新しい `epoch` / `baseRev` を読める。

## 回帰テスト

実地で遭遇したブロックを再発させないため、offline で確認できるものは次でまとめて確認します。

```bash
chromium-cdp-host-git-workflow-regression --json
```

この regression は live ChatGPT には接続しません。
代わりに temp git repo と fake artifacts を作り、次を実コマンドで確認します。

- text snapshot と manifest が current `baseRev` を持つ
- binary file は snapshot から除外される
- 同名 download は quarantine される
- `result.json` と `changes.patch` を検証できる
- `diff --git` header なし patch も `git apply --check` で判定する
- worker worktree へ patch を適用し、test と commit まで行える
- `git format-patch --stdout` mbox を `git am --3way` で適用し、複数 commit を保持できる
- `.worktrees/` は `.git/info/exclude` に入り、host repo を dirty にしない
- worker branch を host repo へ merge できる
- merge 後 snapshot の `baseRev` が更新される
- epoch 固有 Project Source の reread message が生成される
- two-worker plan は worker ごとに一意 artifact 名を要求する
- download default が `/Downloads` ではなく `$HOME/Downloads` である

## source URL merge 知見の更新

以前の未解決メモでは、指定された source URL の会話が `msgCount=0` で読めないと記録していました。r8 再試験では、Project-prefixed URL の既存 tab を対象にして U1 / U2 を再読取できました。

採用する扱い:

- 古い `msgCount=0` は、永続 blocker ではなく「当時の target 解決ミスまたは読み取り条件不足」として扱います。
- source URL merge では、`0` 自身が `original inputs / acquisition / handoff / inclusion / review acceptance` の自己 schema を先に作ります。
- `carried blocker` は完了ではありません。代替 source で通っただけでは、元の source URL merge 達成とは見なしません。
- 最終 pass は、host が zip 実体を直接点検し、review thread の行別判定と一致した時だけです。

## Project Sources collect policy

Project Sources から host へ file を回収する `collect-files` は補助です。過去に find/collect が空出力や hang に見えたため、Project Sources の正本確認には使いません。

採用する扱い:

- Project Sources は input 配布面です。
- 成果回収は thread artifact で行います。
- input が worker に見えていることは、worker 開始時の visibility / exact filename / sha256 / unzip / verifier proof で確認します。
- host 側の完了判定は、upload proof だけでなく worker readback と host validation を合わせて行います。

## git+file flake eval policy

`git+file://` flake eval は local ref の stale 状態で false fail になることがあります。採用する標準は次です。

- host validation の標準は `path:$PWD#...` です。
- `git+file://` を使う時は、stale ref の疑いを blocker として扱い、成功証拠なしに fail 原因へしません。
- stale ref を削除する操作は、必要性と対象 ref が明確な時だけ別 step にします。

## spec repo MR policy

`roccho-dev/spec` へ反映する時は、この端末では push/MR を作りません。ここで許可されるのは clone、worktree、branch、local commit、host validation までです。

MR 前に必ず見る点:

- root 全置換でよいか。
- 削除される docs / CUE / GitHub workflow をそのまま消してよいか。
- `nix flake check path:<worktree>` が通っているか。
- source URL merge evidence が残っているか。
