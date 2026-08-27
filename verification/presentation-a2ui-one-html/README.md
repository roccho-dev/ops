# Presentation A2UI one-HTML verification

This verification pins the UI-owned one-HTML artifact and proves that the existing generic `artifact-assembly` package can reproduce it from a file lock. The page contract remains renderer-free: a module manifest selects an adapter, while OPS adds neither a presentation-specific assembler nor a renderer.

The locked proof additionally covers a pre-overwrite source-to-generated-output consistency gate, signed publication policy, exact customer-domain audience and tenant binding, exact inline/reference artifact-digest binding, mandatory target authorization, canonical authorized iframe sources, external-module origin authorization before network access, `reference + SHA-256`, a signed enterprise-value URL accepted by the real one-HTML shell, and multiple customer URLs without rebuilding the static application.

- `locks/presentation-a2ui-one-html.jsonl`: exact UI revision and artifact SHA-256.
- `evidence/ui-proof-receipt.json`: non-authority UI build/browser facts.
- `evidence/publication-fixtures.json`: signed-policy and inline/reference URL fixtures.
- `evidence/enterprise-value-example.*`: signed runtime-consumable customer publication proof.
- `evidence/assembly-receipt.json`: generic assembly receipt.
- `data/jsonl/criteria.jsonl` and `status.jsonl`: blocking repository gates and current projection.
- `data/jsonl/open-gates.jsonl`: external infrastructure and compatibility gates that remain explicitly open.
- `verify.mjs check`: fail-closed internal consistency and stale report check.
- `verify.mjs reproduce <index.html>`: rebuild in a temporary directory and compare the receipt.

`46 / 46 PASS` means the repository-scoped proposal is internally complete. It does **not** claim product completion while the external gates remain `OPEN`.
