# Presentation shared visual closure

Cross-repository verifier for the historical 12/12 shared-visual proof and its stronger descendants.

It verifies ancestry, one persistent semantic Seq instance, slide/Seq interaction evidence, non-Seq resource compatibility, renderer identity, source-package supersession, and the targeted mobile/UI checks.

Before accepting the checked browser receipt, it rebuilds the UI presentation and builds the semantic Seq carrier twice from the current UI state with the current mobile-agent builder. The two carrier byte streams must match, and their SHA-256 and size must match the browser receipt. The carrier is temporary; only the typed receipt is retained.
