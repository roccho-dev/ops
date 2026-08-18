# shiftleft-admission

Issue #116のV1実装。規約の意味を言語共通の3型へ固定し、実装・言語・実行環境の差はEvidence Providerへ隔離します。

```text
ShiftLeftRule
ShiftLeftObservation
ShiftLeftReceipt
```

## Boundaries

- **このpackage**: exact policy intake、Package契約検査、provider結果の4状態fold、policy/base/candidate tree-bound receipt、live worktreeとの再照合。
- **structured-diagnostic**: 独立した`diagnostic/1`実装契約とruntime。#116へ依存しない。
- **このpackageのdiagnostic provider**: executable boundaryを外部実行し、primary outputとdiagnostic streamを独立観測する。runtime機能は提供しない。
- **#114**: GitHub write effect。既存のcheck contractから`policyctl verify-worktree`を呼び、非0ならeffect planを生成しない。
- **#115**: Rule/Conditionの意味AuthorityとOutcome Fact。ここでは変更しない。
- **#117**: compiled `policyctl`やproof packをPro sandboxへ搬入するtransport。意味判定はこのpackageが担う。

依存方向は一方向です。

```text
structured-diagnostic runtime
  └─ #116へ依存しない

#116 assurance
  └─ contractと実行結果を観測する
```

#116がなくても`structured-diagnostic`は動きます。#116が追加するのは「動作する」ことではなく、exact policy・candidate tree・実行証拠へ結び付いた規約準拠Receiptです。

## Commands

```bash
policyctl hash --bundle policy
policyctl observe --bundle policy --fixtures fixtures --out observations.jsonl
policyctl admit --bundle policy --policy-ref <40hex> --policy-sha256 <sha256:...> \
  --base-tree git-tree-sha1:<sha> --candidate-tree git-tree-sha1:<sha> \
  --observations observations.jsonl --out receipt.json
policyctl verify --receipt receipt.json --policy-sha256 <sha256:...> \
  --base-tree git-tree-sha1:<sha> --candidate-tree git-tree-sha1:<sha>
policyctl verify-worktree --receipt receipt.json --policy-sha256 <sha256:...> \
  --repo <git-worktree>
policyctl proof ...
```

`verify-worktree`は、temporary Git indexで`HEAD tree`と`git add -A`後のcandidate treeを計算し、Receiptのpolicy/base/candidate binding、digest、PASS状態を照合します。worktree・ref・networkは変更しません。

#114 requestでは、次を通常checkとして渡します。

```text
id: shiftleft-admission
command:
  policyctl verify-worktree
  --receipt <receipt>
  --policy-sha256 <policy-hash>
  --repo <candidate-worktree>
```

正Receiptだけがexit 0になります。wrong tree、tamper、missing receipt、非PASS Receiptは非0になり、#114は`CHECK_FAILED`としてeffect planを作りません。

## Evidence providers

| Provider | 観測対象 | 現在のprofile |
|---|---|---|
| `language-import-provider` | Coreがeffect adapterをimportしていないか | Go、JavaScript、Python |
| `diagnostic-process-provider` | primary output分離、`diagnostic/1`適合、host-owned field非偽造 | JavaScript process boundary |

`diagnostic-process-provider`は`structured-diagnostic`のvalidatorをimportしません。隣接するexact `contract.json`を読み、対象programを別processとして実行し、stdout・stderrを外部観測します。したがって、対象実装の自己申告をそのままPASSへ変換しません。

## Proof

`proof`と統合testは以下を実行します。

- JS/Python/Go × good/bad/false-positive/false-negative = 12 language-import provider fixtures
- diagnostic process × good/bad/false-positive/false-negative = 4 executable fixtures
- 5 language-neutral rules × good/bad/false-positive/false-negative = 20 executable rule fixtures
- 7 blocker rules全件について、宣言ではなく計36件の実fixtureからcoverage observationを生成
- 同じruleを担当するprovider profile間のstatus・finding code一致
- primary outputへ`diagnostic/1`を混ぜたcaseの拒否
- top-level host-owned fieldを偽造したcaseの拒否
- messageやfield valueに`event_id`等の文字列があるだけのcaseを誤拒否しないこと
- exact diagnostic contract SHAをprovider identityとEvidenceへ結ぶこと
- exact policy hash検査
- tamper/missing/mutable ref拒否
- public contract、parse boundary、golden/negative route、current consumer検査
- missing tool、unsupported language、skipped required testの非Green化
- clean 2 runの全Observation・Receipt byte一致
- 観測済み`unmet`を`unobserved`へ誤分類しないこと
- policy/base/candidate tree bindingとcandidate mismatch拒否
- 正Receiptで#114 prepareがeffect planを生成すること
- wrong candidate tree／missing receiptでは#114 prepareが`CHECK_FAILED`となりeffect planを生成しないこと
- effect plan確定後にも同じpolicy/base/candidateでReceiptを再verifyできること

## Terminal states

```text
PASS
BLOCKED_RULE
BLOCKED_PACKAGE_CONTRACT
BLOCKED_GOLDEN_ROUTE
BLOCKED_TEST_EVIDENCE
UNSUPPORTED_REQUIRED_ADAPTER
REVIEW_REQUIRED
```
