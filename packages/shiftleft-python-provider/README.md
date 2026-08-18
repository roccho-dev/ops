# shiftleft-python-provider

Python sourceだけを所有する、`shiftleft-admission`向けの薄いEvidence Providerです。

```text
Python source
→ stdlib ast.parse
→ shiftleft-import-report/1 JSON
→ shiftleft-admissionの共通Gate
```

このpackageはrule、合否、Receipt、GitHub writeを所有しません。Python runtime/sourceをGo admission coreへ混在させず、bad / false-negative / false-positive / goodの4 fixtureを実行可能な形で保持します。

```bash
shiftleft-python-imports fixtures/python/good/core.py
```
