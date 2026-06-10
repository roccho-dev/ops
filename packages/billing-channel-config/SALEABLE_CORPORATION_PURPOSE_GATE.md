# Saleable corporation purpose gate for billing-channel-config

Ultimate assumption: **Meta^10 purpose is building a saleable corporation and completing a future sale.**

Decision: **allow as billing-channel subsystem only**. This is **not** a complete saleable-corporation proposal.

## Purpose ladder

| generation | purpose | proposal contribution | saleable-corporation contribution | failure if missing | permission |
|---|---|---|---|---|---|
| Meta^0 | 課金チャネル追加可能な billing-channel-config lib/core-port package を得る | 商品・価格・cadence・provider候補・fallbackをcatalog authorityへ集約し、coreで選択、portでadapter glue可能にする。 | 売れる瞬間に回収口を増やせるため、初期売上・商品検証・請求導線の立ち上げ速度に寄与する。 | 新チャネル追加のたびにLP/API/請求運用へ分散修正が発生し、回収口が属人化する。 | allow_as_billing_subsystem_only |
| Meta^1 | Stripe/PAY.JP/銀行振込/手動請求/future provider を差し替え可能にする | providerをpackage主語にせずchannel catalogの行とし、adapterはport越しのexample/test-root参照に留める。 | 特定決済会社への過度依存を下げ、審査・障害・地域展開・買い手側標準への切替余地を残す。 | Stripe/PAY.JPいずれかの審査落ち・障害・手数料悪化で販売停止または再実装になる。 | allow_as_billing_subsystem_only |
| Meta^2 | 決済停止・審査待ち・高額B2Bの不適切チャネル選択を防ぐ | provider/channel disabled評価、bank-transfer-instructions fallback、cadence/amount/currency/customer guardrailを追加済み。 | 入金機会喪失、請求ミス、顧客摩擦、未収化を減らす。 | 高額B2Bがカードcheckoutへ流れる、recurringがone-shotへ流れる、停止providerが選ばれる。 | allow_as_billing_subsystem_only |
| Meta^3 | 課金ドメイン判断を機械検証可能なoracle/catalog assetにする | validate_catalog/validate_request/add_channelと32件の破壊的ユースケースtestを入れ、generated viewをauthority化しない。 | 買い手が見たときに「請求方針がコードと運用に散らばっていない」状態を作る。 | 商品/請求/LP/adapterのどこが正本かわからず、DD時に運用依存・属人判断になる。 | allow_as_billing_subsystem_only |
| Meta^4 | 人間レビューを未知・例外・契約判断へ限定する | invalid requestをstructured diagnostics化し、secret/url/webhook/runtime leakをcatalog段階で拒否する。 | 少人数運用でも請求チャネル追加・変更のレビューコストを抑え、運用引継ぎしやすくする。 | channel追加ごとに人間が暗黙知で判断し、変更速度が落ち、見落としが増える。 | allow_as_billing_subsystem_only |
| Meta^5 | 少人数で安全に商品追加・請求導線追加を回せる | core/port/adapters/test-root分離により、新チャネル追加はcatalog patch + adapter glue + testsへ限定される。 | 人員増なしで商品実験、アップセル、保守課金、国内カード重視などの分岐を増やせる。 | 商品が増えるほどbilling実装が膨らみ、売上増より運用コストが先に増える。 | allow_as_billing_subsystem_only |
| Meta^6 | 破綻した課金ケースを回帰資産に変える | 破壊的ユースケースD01-D32をtest化し、provider/channel/request/adapter境界の失敗を回帰化した。 | 同じ請求・回収ミスを繰り返さない組織記憶になり、買い手に運用成熟度を示せる。 | 一度潰した請求事故・fallback事故・adapter事故が将来のチャネル追加で再発する。 | allow_as_billing_subsystem_only |
| Meta^7 | billing設定・選択ロジックを自社固有の運用資産にする | 商品別価格帯、B2B/recurring/domestic-card-heavyの選択規則、fallback順を明示資産化する。 | 単なるStripe導入ではなく、事業固有の請求判断資産として買い手が評価可能になる。 | 誰でも作れる決済リンク集で終わり、会社固有の価値や引継ぎ可能性が薄くなる。 | allow_as_billing_subsystem_only |
| Meta^8 | 高信頼な売上回収ソフトウェアを小チームで維持する | coreはpure、adapterはexample/port、runtime secret/webhook/stateは除外という境界で保守性を上げる。 | キーマン依存・属人コード・単一障害点・手動デプロイ依存を下げる方向へ寄与する。 | 担当者退職やprovider変更で請求導線が壊れ、買い手がPMIリスクを高く見る。 | allow_as_billing_subsystem_only |
| Meta^9 | 変更コストを下げ、売上機会への意思決定速度を上げる | channel追加・停止・fallback変更をcatalog/test差分として扱えるため、販売施策の実験速度が上がる。 | 新チャネル、アップセル、クロスセル、値上げ余地、休眠掘起しに対して課金導線の実装待ちを減らす。 | 営業機会に対して決済実装がボトルネック化し、機会損失と手戻りが増える。 | allow_as_billing_subsystem_only |
| Meta^10 | 売却価値のある法人を構築し、買い手に売却できる状態へ近づける | 売上回収口、請求方針の正本、チャネル拡張性、fallback統制、検証証跡を提供する。 | EBITDA改善、再現性、横展開性、買い手価値へ間接寄与する。ただし法人格・株主構成・税務・契約・会計・売上認識・実入金消込までは満たさない。 | このproposalを「売却可能法人の完成」と誤称すると破綻。billing subsystemとしてのみ許可可能。 | allow_as_billing_subsystem_only_not_complete_company |

## Not covered by this proposal

| area | not covered | required next proposal |
|---|---|---|
| corporate_identity | 法人種別、登記情報、定款、事業目的、本店/支店、関連法人 | corporate-governance-dd-pack or company-formation-ledger |
| ownership_structure | 株主/社員/持分、議決権、種類株式、新株予約権、実質所有者 | cap-table-governance-package |
| transaction_structure | LOI/SPA/APA、表明保証、補償、価格調整、運転資本調整、アーンアウト | exit-transaction-dd-pack |
| tax_accounting_revenue_recognition | 税務申告、消費税、インボイス、売上認識、会計仕訳、入金消込、収益レポート | billing-ledger-reconciliation-and-revenue-recognition |
| legal_compliance | 特商法、消費者保護、反社、下請法、返金規約、業法、個人情報、AI利用同意 | billing-legal-compliance-policy-pack |
| runtime_provider_adapter | Stripe/PAY.JP live API、webhook、idempotency、retry、secret manager、invoice/payment state | billing-provider-stripe then billing-provider-payjp if justified |
| management_reporting | 月次売上、商品別売上、顧客別売上、チャネル別売上、LTV、解約率、未収率の実測 | billing-evidence-export-and-kpi-pack |

## Approval gate

- Allow only as `billing-channel-config` subsystem.
- Reject as a complete saleable-corporation proposal.
- Require separate corporate governance, contract, accounting, legal/compliance, provider-runtime, and KPI evidence proposals.
