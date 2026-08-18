# shiftleft-admission

Issue #116のV1実装。規約の意味を言語共通の3型へ固定し、言語差はEvidence Providerへ隔離します。

```text
ShiftLeftRule
ShiftLeftObservation
ShiftLeftReceipt
```

## Boundaries

- **このpackage**: exact policy intake、Package契約検査、provider結果の4状態fold、policy/base/candidate tree-bound receipt。
- **shiftleft-python-provider**: Python AST observationとPython fixtureだけを所有する独立runtime package。
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

- JS/Python/Go × good/bad/false-positive/false-negative = 12 language-provider fixtures
- 5 language-neutral rules × good/bad/false-positive/false-negative = 20 executable rule fixtures
- 6 blocker rules全件について、宣言ではなく計32件の実fixtureからcoverage observationを生成
- JS/Python/Goの`SL-CORE-001` status・finding code一致
- exact policy hash検査
- tamper/missing/mutable ref拒否
- public contract、parse boundary、golden/negative route、current consumer検査
- missing tool、unsupported language、skipped required testの非Green化
- clean 2 runの全Observation・Receipt byte一致
- 観測済み`unmet`を`unobserved`へ誤分類しないこと
- policy/base/candidate tree bindingとcandidate mismatch拒否

Pythonの実装・fixtureは`../shiftleft-python-provider`にあり、Go package内へPython sourceを混在させません。

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
