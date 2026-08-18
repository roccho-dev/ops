# shiftleft-admission

Issue #116のV1実装。規約の意味を言語共通の3型へ固定し、言語差はEvidence Providerへ隔離します。

```text
ShiftLeftRule
ShiftLeftObservation
ShiftLeftReceipt
```

## Boundaries

- **このpackage**: exact policy intake、Package契約検査、provider結果の4状態fold、policy/base/candidate tree-bound receipt。
- **#114**: GitHub write effect。ここでは変更しない。
- **#115**: Rule/Conditionの意味AuthorityとOutcome Fact。ここでは変更しない。
- **#117**: compiled `policyctl`やproof packをPro sandboxへ搬入するtransport。意味判定はこのpackageが担う。

## Commands

```bash
policyctl hash --bundle policy
policyctl observe --bundle policy --fixtures fixtures --out observations.jsonl
policyctl admit --bundle policy --policy-ref <40hex> --policy-sha256 <sha256:...> \
  --base-tree git-tree-sha1:<sha> --candidate-tree git-tree-sha1:<sha> \
  --observations observations.jsonl --out receipt.json
policyctl verify --receipt receipt.json --policy-sha256 <sha256:...> \
  --base-tree git-tree-sha1:<sha> --candidate-tree git-tree-sha1:<sha>
policyctl proof ...
```

`proof`は以下を実行します。

- JS/Python/Go × good/bad/false-positive/false-negative = 12 provider fixtures
- exact policy hash検査
- tamper/missing/mutable ref拒否
- public contract、parse boundary、golden/negative route、current consumer検査
- missing tool、unsupported language、skipped required testの非Green化
- clean 2 run receipt byte一致
- policy/base/candidate tree bindingとcandidate mismatch拒否

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
