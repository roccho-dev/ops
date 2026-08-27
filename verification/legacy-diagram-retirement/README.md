# Legacy diagram retirement verification

Cross-repository verifier for a merged bundle set. It proves that the current UI tree and CI no longer contain the retired diagram package, its workspace dependencies, its Nix entry, or `.drawio` artifacts. The original source commit, exact source tree, and provenance merge must remain reachable through Git history. OPS may contain only verification, never the retired implementation.

Run with an extracted UI repository path:

`node verification/legacy-diagram-retirement/verify.mjs <ui-repository>`
