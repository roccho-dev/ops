# billing-channel-config product-scope purpose contribution

Principle: product must know and serve the upper purpose, but only through its product scope.

Product scope: billing-channel-config selects billing channels, validates catalog/request constraints, exposes an adapter port, and proves example glue from test-root.

| generation | purpose | contribution | type | boundary | failure if missing |
|---|---|---|---|---|---|
| Meta^0 | 課金チャネル追加可能なlibを得る | 商品、金額、cadence、provider状態から課金channelを選ぶcoreを持つ。 | direct | billing-channel selection / validation / adapter port only | 課金口追加がLP、API、手動運用へ分散し、属人化する。 |
| Meta^1 | Stripe/PAY.JP/銀行振込/手動請求を差し替える | providerをcatalog行にし、adapterはportの外へ置く。 | direct | provider choice is data; runtime integration is outside | 決済会社の審査、障害、手数料変化で販売停止しやすい。 |
| Meta^2 | 商品に合う請求口を安全に選ぶ | amount/currency/cadence/customer/provider blockを選択前に検査する。 | direct | eligibility guard only; no live payment state | 高額B2Bが不適切なcheckoutへ流れ、未収や手戻りが増える。 |
| Meta^3 | 課金判断を型化する | 判断を会話や画面ではなくcatalog + pure core + testsへ置く。 | direct | catalog authority only; generated views are projections | 何が正本かわからず、DDや引継ぎで説明できない。 |
| Meta^4 | 少ないメンタルモデルで運用する | coreは選択、portは契約、adapterはglue、exampleは非正本に分ける。 | direct | core/port split; no secret/webhook/network | billing変更ごとに人間判断が増え、低コスト運用が壊れる。 |
| Meta^5 | 商品実験と課金導線追加を速くする | 新channelをcatalog patch + adapter glue + testで追加できる。 | direct | extension contract; runtime promotion is separate | 新商品や新価格の実験速度が決済実装に縛られる。 |
| Meta^6 | 破壊的ケースを回帰資産にする | D01-D32の破綻をtest/diagnosticに固定する。 | direct | billing-channel failures only | 同じ請求、fallback、adapter事故が再発する。 |
| Meta^7 | 低コスト・高利益率software productにする | 課金口追加と請求ミス削減により、粗利を守る。 | indirect | billing leverage only; product-market fit is outside | 売上が伸びても運用費や請求事故が先に増える。 |
| Meta^8 | software設計を組織設計へ接続する | CFO/COO/CTO境界をbilling core、port、adapter、evidenceに分ける。 | indirect | billing organization slice only | 責務が混ざり、少人数でCXO機能を回しにくい。 |
| Meta^9 | 高価値法人を構築する | 回収導線の再現性、移管性、provider optionalityを作る。 | indirect | billing DD evidence only | 買い手が課金導線を属人運用・単一障害点と見る。 |
| Meta^10 | 高価値法人を売却し流動性を作る | 課金channelが追加、停止、移行可能である証跡として間接寄与する。 | indirect | does not complete corporation, DD, accounting, legal, or exit transaction | 売却価値への寄与を過剰主張するか、逆に目的非接続な技術作業になる。 |

## Not in product scope

- corporate identity, ownership, capital table, board governance
- LOI, SPA, APA, valuation, price adjustment, earnout
- tax filing, accounting ledger, revenue recognition, reconciliation
- legal compliance policies, refund policies, privacy, regulated-industry review
- live Stripe/PAY.JP SDK, secrets, webhooks, idempotency, retry, provider state
- management KPI exports such as revenue, churn, LTV, unpaid receivables

## Reject if

- claims product is purpose-ignorant
- claims this package completes high-value corporation or sale readiness
- moves CEO/owner objective, legal, accounting, or DD workflow into billing-channel core
- moves secrets/webhooks/live invoice state into lib catalog
- lets provider adapter override selected channel/provider authority
- treats generated LP/admin UI as billing authority
