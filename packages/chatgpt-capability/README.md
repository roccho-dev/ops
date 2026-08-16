# Capforge — Go-only Pro Capability Projection Platform

`decisions/*.jsonl`を規範主張、Go source directoryを実装事実として扱い、Go製`capforge`が両者を突合してCloudflare Pages向け`dist/`を生成します。

## 固定した責務

```text
decisions/<id>.jsonl       # 人・承認agentが追記する「こうする」
capabilities/<id>/         # Go実装＋最小fixture
capabilities/<id>/projection.json # 任意。実装自身がdist投影を生成する宣言
capforge                   # build・観測・突合・carrier・全Projection生成
registry-search.wasm       # 人向けUIの最小検索意味。Goから一度だけbuild
app.mjs                    # fetch・WASM host・DOMだけ
dist/                      # 全生成物。手編集禁止
```

## 追加差分

```text
decisions/<new-id>.jsonl
capabilities/<new-id>/main.go
capabilities/<new-id>/fixture.json
```

中央Registry、UI、agent入口、carrier pathは変更しません。

`projection.json`を持つCapabilityだけは、fixture成功後に同じbuild済み実装を
projectorとして実行します。Publisherはschema固有の意味を持たず、宣言された
入力とdist出力のSHA-256だけを観測します。`inputs`へ宣言したledger等は
projection-only inputとしてpayload build digestから外れるため、appendしても
validator binaryは再buildされません。出力は隔離stageで生成し、宣言外fileや
既存dist fileとの衝突を拒否してから公開treeへ移します。

## 一度だけのplatform build

```text
go run ./cmd/platform-build
```

これは`registry-search.wasm`と`capforge-linux-amd64`を2回ずつbuildしてbyte一致を確認します。通常のCapability追加では実行しません。新規・変更Go CapabilityだけはGo toolchainで1回buildし、未変更Capabilityは同梱cacheから復元します。

## 通常の追加・投影

```text
./build/capforge-linux-amd64 add \
  --root . \
  --id go-demo \
  --title "Go Demo" \
  --purpose "Pro拡張の説明" \
  --message "demo"

./build/capforge-linux-amd64 publish --root . --dist dist
```

`publish`はproject・verify・packageを一度に行い、JSTの現在時刻を使って次の2ファイルを既定生成します。

```text
<yymmddhhmmss>.6a819b1d-0d40-83e8-855a-00e20dd48e56.bundle
<yymmddhhmmss>.6a819b1d-0d40-83e8-855a-00e20dd48e56.dist.zip
```

`.bundle`はGit bundle、`.dist.zip`はCloudflareへ配置する決定的ZIPです。`--timestamp`で再現試験用のJST時刻、`--id`で明示的な上書きも可能ですが、通常は指定しません。

`project`はsource digest cacheを使います。未変更Capabilityは再buildせず、新規・変更Capabilityだけをbuildします。`project`と`verify`は低水準操作として引き続き利用できます。

## distの入口

```text
dist/
├─ index.html                         # 人向けミニマルUI
├─ agent.html                         # JavaScript不要のagent入口
├─ ADD.md                             # 人向け追加手順
├─ agent-add.txt                      # Agent向けexact手順
├─ .well-known/
│  ├─ bootstrap.json                  # Capforgeとsource kitのcarrier参照
│  ├─ decisions.jsonl                 # reduce済み意思決定主張
│  ├─ implementations.jsonl           # 外部観測した実装主張
│  ├─ registry.jsonl                  # 両者の突合結果
│  ├─ build.json                      # 投影receipt
│  └─ verify.json                     # carrier・実行検査receipt
├─ cap/v1/                            # Pro向け標準Base64 carrier
├─ contracts/                         # Capability自身が生成した公開contract投影
├─ raw/wasm/                          # browser用検索WASM
├─ assets/wasm_exec.js                # Go WASM host
└─ kit/<sha>.source.zip(.b64.txt)     # exact deploymentを継続するsource kit＋cache
```

## 状態

`active / planned / drift / unadopted / unobserved / retired`の6状態です。実装があるだけでも、意思決定があるだけでも`active`にはなりません。

## Append-only contract schema

`contract-schema` Capabilityは、opsの`cue-append-contract-core`で固定した
`schema / field / edge / query / fixture / deprecation / authority rule`の
append-only JSONL契約を引き継ぎます。

この環境ではCUE CLIを必須にせず、同じ`meta.cue`を参照契約として残したうえで、
Go製validatorが次をfail-closedで検査します。

```text
行shape・unknown field
event_idの一意性
既存ledgerのexact prefix保持（rewrite拒否）
schema / field / query / fixture参照
acyclic edge
deprecation影響と解消query
catalog / index / JSON Schema / manifestの決定的生成
```

公開distでは`contracts/contract-schema/`からledgerと生成物を直接読め、
同じvalidator binaryはcontent-addressed carrierからPro localへ復元できます。
