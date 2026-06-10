# billing-channel-config destructive use cases and hardening

This table was created before and during the destructive refactor. The package goal is: `いつでも課金チャネルを追加できるlib package` while keeping adapters as glue/examples.

| id | class | 破壊的ユースケース | 破綻の仕方 | 解決/リファクタ | covering_test |
|---|---|---|---|---|---|
| D01 | catalog-authority | catalog.kind が別物/欠落 | 別schemaを正本として読んで誤選択する | validate_catalog が invalid-catalog-kind で停止 | test_default_catalog_validates |
| D02 | catalog-authority | generatedIsAuthority=true のLP/生成物が混入 | projectionが正本化され、価格/導線が逆流する | generated-authority leakをcatalog/actionで拒否 | test_generated_views_are_rejected_as_authority / test_validate_prepared_action_rejects_generated_authority |
| D03 | runtime-leak | secret/apiKey/token/webhookがcatalogに入る | lib packageがsecret保管庫化し再配布不能になる | runtime-secret-or-io-key検知を強化 | test_runtime_secrets_or_urls_are_rejected_from_core_catalog |
| D04 | runtime-leak | paymentLinkUrl/endpoint/http URLがcatalogに入る | 決済URLが正本化され失効・漏洩・環境混線する | URL/endpoint-like key/valueを拒否 | test_runtime_secrets_or_urls_are_rejected_from_core_catalog |
| D05 | provider-state | provider.status=disabled でもchannelが選ばれる | Stripe/PAY.JP審査落ち・障害時に販売導線が死ぬ | provider availabilityをselection前に評価 | test_provider_disabled_is_not_available_even_if_channel_active |
| D06 | channel-state | channel.status=disabled でもdefaultが選ばれる | 停止した決済口へ誘導する | channel availabilityをselection前に評価しfallback | test_channel_disabled_falls_back |
| D07 | catalog-ref | channel.provider が未宣言 | adapter glue先が存在せず実行不能になる | validate_catalogでunknown-channel-provider | test_default_catalog_validates |
| D08 | catalog-ref | default/fallback/cadenceChannelが未知channel | 商品catalogが壊れても起動してしまう | validate_catalogでchannel参照を検証 | test_default_catalog_validates |
| D09 | catalog-ref | cadenceChannelがそのcadenceをsupportしない | recurring商品をone-shot決済へ流す | supportedCadencesとcadenceChannelsの整合を検証 | test_retainer_recurring_uses_recurring_invoice |
| D10 | request-shape | request mappingに未知fieldが入る | typoを無視して意図しないdefaultに落ちる | unknown-request-fieldでinvalid-request | test_invalid_request_mapping_returns_structured_failure |
| D11 | request-shape | amountが文字列/真偽値/0/負数 | 金額判定が壊れ、閾値やmin/maxをすり抜ける | positive int以外をinvalid-request | test_invalid_request_mapping_returns_structured_failure / test_negative_or_boolean_amount_is_invalid_request |
| D12 | request-shape | provider_blocked='stripe' scalar文字列 | set('stripe')化でprovider blockが効かない/壊れる | sequence以外はinvalid-request | test_provider_blocked_string_is_invalid_not_character_set |
| D13 | request-shape | provider_blockedのtypo stripee | 障害providerをblockしたつもりで通ってしまう | unknown-blocked-providerでinvalid-request | test_unknown_blocked_provider_is_invalid |
| D14 | request-shape | preferred_channelが未知channel | typoを無視してdefaultへ戻る | unknown-preferred-channelでinvalid-request | test_unknown_preferred_channel_is_invalid |
| D15 | policy-escape | preferred_channelが他商品のchannel | product policyを越えてPAY.JP/手動へ逃げる | product-declared channel set外のpreferenceを拒否 | test_declared_but_product_undeclared_preferred_channel_is_rejected |
| D16 | policy-escape | domestic_card_heavyがbusiness invoiceを上書き | 高単価B2Bがカードcheckoutへ流れて手数料/請求書要件を壊す | business/high-value guardrailを候補順の前段に維持 | test_business_high_value_audit_uses_invoice |
| D17 | capability | skill-pack recurring + domestic_card_heavy | PAY.JP one-time checkoutに月額を流す | product allowedCadences と channel supportedCadencesを導入 | test_recurring_skill_pack_does_not_accidentally_use_payjp |
| D18 | capability | USD等の未対応currency | JPY前提の請求/表示で通貨ミスが発生 | supportedCurrenciesでchannel選択前に除外 | test_unsupported_currency_rejects_all_default_channels |
| D19 | capability | 商品min/max外のamount | 診断1,000円や納品900,000円など価格帯を逸脱 | product minAmount/maxAmountを導入 | test_product_amount_bounds_are_enforced |
| D20 | capability | channel maxAmount超えでもcard processor選択 | PAY.JP/Payment Link上限・運用範囲を超える | channel minAmount/maxAmountで候補除外 | test_channel_amount_bounds_are_enforced_before_selection |
| D21 | fallback | Stripe blocked時にmanualしか残らない | B2B一括請求で銀行振込導線が弱い | bank-transfer-instructions channelを追加 | test_blocked_stripe_for_build_uses_bank_transfer_before_manual |
| D22 | fallback | 全候補がdisabled/block/incompatible | None/例外ではなく失敗理由が必要 | no-available-channelを構造化diagnostic化 | test_unsupported_currency_rejects_all_default_channels |
| D23 | adapter-boundary | srcがexample adapterをimport | exampleが正本化されpackage境界が崩れる | src -> example importを禁止テスト | test_src_does_not_import_examples |
| D24 | adapter-boundary | srcがStripe/PAY.JP SDKやrequestsをimport | core/port libがruntime package化する | ASTでprovider/runtime IO importを禁止 | test_src_does_not_import_runtime_io_or_provider_sdks |
| D25 | adapter-support | adapter.supportsがprovider_idだけでtrue | 未来のStripe channelを既存adapterが誤処理する | example adaptersをexact channel_id + mode supportへ変更 | test_example_adapter_exact_channel_support_prevents_provider_wildcard |
| D26 | adapter-contract | adapter.prepareがdict等を返す | glue後のaction contractが壊れる | BillingPreparedAction以外をinvalid-adapter-action | test_glue_prepare_rejects_non_action_return |
| D27 | adapter-contract | adapterが別channel/providerのactionを返す | 選択結果のauthorityをadapterが上書きする | validate_prepared_action(selection)で境界一致を検査 | test_glue_prepare_rejects_action_channel_provider_mismatch |
| D28 | adapter-contract | adapter action generated_is_authority=true | adapter outputがcatalog正本化する | generated action authority leakを拒否 | test_validate_prepared_action_rejects_generated_authority |
| D29 | adapter-failure | adapter.supportsが例外 | 1つの壊れたadapterでglue全体が落ちる | support例外をdiagnostic化し継続/ missing-adapter | test_glue_prepare_adapter_support_exception_is_data_not_crash |
| D30 | adapter-failure | adapter.prepareが例外 | provider runtime障害がcore callerをクラッシュさせる | adapter-prepare-errorをprovider-neutral action化 | test_glue_prepare_adapter_prepare_exception_is_data_not_crash |
| D31 | extension | future provider/channel追加がcore改修必須 | 課金チャネル追加のたびlibを壊す | add_channelでcatalog data + provider candidate注入 | test_new_channel_can_be_added_as_catalog_data_without_core_change |
| D32 | extension | add_channel実験がbase catalogをmutate | 失敗実験がcanonical catalogを汚染する | deep copy patchingへ変更 | test_add_channel_deep_copy_prevents_failed_experiment_mutating_base |

## Refactor summary

- Core remains catalog/request pure data: no provider SDK, no network, no environment, no filesystem dependency.
- Catalog now describes provider/channel/product capability envelopes: cadence, currency, product amount range, channel amount range, provider/channel availability.
- Port validates adapter output and converts adapter failure into provider-neutral diagnostics.
- Example adapters are test-root referenced glue only and support exact channel ids/modes.
- `bank-transfer-instructions` is added as a provider-independent fallback for Stripe-blocked one-shot B2B flows.
