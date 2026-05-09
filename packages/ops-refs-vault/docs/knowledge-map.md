# ops-refs-vault knowledge map

この文書は、push-to-egress 系の会話で得た知見を、恒久 docs、script、task に分けた正本です。
raw 証跡は `repos/cdp-ops-poc/**/RUN_REPORT.md` に残し、この package には毎回使う形だけを残します。

## App Connector 経路の知見

K01-K08, K15, K17 は `ops-tailnet-github-egress` が本拠です。
この package は ref 配置と復元を担当します。GitHub へ実際に push する時は、通常の `git push` を直接呼ばず、`ops-tailnet-github-egress push-local --long-transfer` の route gate に委譲します。

| ID | 状態 | 置き場所 |
|---|---|---|
| K01 | doc 済み | `ops-tailnet-github-egress/docs/app-connector-local-push.md` |
| K02 | script 済み | `ops-tailnet-github-egress route-check` |
| K03 | contract/doc 済み | `ops-tailnet-github-egress` と `AGENTS.md` |
| K04 | snippet 済み | `github-app-connector-git-env.sh` |
| K05 | script 済み | `ops-tailnet-github-egress github-ssh-check-local` |
| K06 | doc 済み | MTU/PMTU proof と long-transfer docs |
| K07 | script 済み | `github-push-local-app-connector-long.sh` |
| K08 | doc 済み | bundle 不要条件は App Connector push doc |
| K15 | script 一部済み | retry snippet。DNS 一時失敗は troubleshooting にも残す |
| K17 | task | egress loop と `accept-routes=false` は troubleshooting へ昇格する |

## refs-vault 知見

K09-K16 と K19-K35 はこの package が本拠です。

| ID | 状態 | 置き場所 |
|---|---|---|
| K09 | script 済み | `ops-refs-vault adopt`, `push-all` |
| K10 | script 済み | `ops-refs-vault adopt --push-tags` |
| K11 | script 済み | `ops-refs-vault materialize` |
| K12 | script 済み | `push-all` と `materialize` は manifest `localPath` を使う |
| K13 | smoke 済み | `ops-refs-vault smoke-local` |
| K14 | smoke 対象 | remote ref 前進と再復元は追加 smoke 予定 |
| K16 | 修正済み | `materialize` は欠損 branch を default fail にする |
| K19-K23 | task/script 一部 | shelter inventory と no-force 方針 |
| K24-K26 | task/doc | shallow/snapshot/held-out repo の扱い |
| K27-K28 | script 一部 | `inventory`, `verify-ref` |
| K29 | snippet 済み | `snippets/manual-restore.sh` |
| K30-K35 | task/doc | shelter と core/main 分離の正式化 |

## 重要な線引き

- `roccho-dev/refs` は hot backup です。cold backup ではありません。
- 守れるのは commit 済みで push 済みの Git object だけです。
- dirty/untracked/ignored/secret/build cache は別管理です。
- missing branch の main fallback は危険なので default 禁止です。
- GitHub へ出る通信経路は `ops-tailnet-github-egress` が gate します。
- `push-all` は GitHub remote を検出したら `ops-tailnet-github-egress push-local --long-transfer` を使います。
- `adopt` / `materialize` は GitHub remote に `remote.<name>.push` を設定しません。plain `git push refs-vault` で egress gate を迂回させないためです。
- local bare remote smoke は GitHub 不使用のまま残し、non-GitHub remote だけ direct push refspec を設定できます。
- default は no-force、tags は opt-in です。
