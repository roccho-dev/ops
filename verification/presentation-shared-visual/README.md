# Presentation shared visual closure

Cross-repository verifier for the historical 12/12 shared-visual proof and its stronger descendants.

It verifies ancestry, one persistent semantic Seq instance, slide/Seq interaction evidence, non-Seq resource compatibility, renderer identity, source-package supersession, and the targeted mobile/UI checks.

This verifier is **not** a repo-local `nix flake check`: it requires exact checked-out mobile-agent and UI repositories. The single `uiops-207-377-exact-tree-set/1` gate invokes it with explicit `--mobile-agent-root`, `--ui-root`, and `--work-root` values. Missing arguments, ambient sibling lookup, an existing work root, or a work root inside either repository are Red.

Before accepting the checked browser receipt, it rebuilds the UI presentation and builds the semantic Seq carrier twice from the current UI state with the current mobile-agent builder. The two carrier byte streams must match, and their SHA-256 and size must match the browser receipt.

The verifier creates the caller-selected fresh work root exclusively, writes both carriers plus `presentation-shared-visual.receipt.json`, and performs no cleanup. Partial or successful evidence remains available to the enclosing gate, which owns later disposal outside this reusable verifier.
