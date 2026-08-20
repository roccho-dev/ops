# Abstract `nix` order → current sandbox proof

## Verdict

`ABSTRACT_ORDER_TO_NIX_2_35_2_CURRENT_SANDBOX_PASS`

The input contained no build URL. The resolver selected the official Nix package manager, followed the live official installer pointer, observed `Linux/x86_64`, sealed Nix `2.35.2` and its official payload SHA, carried the complete binary distribution, and replayed it in the current sandbox.

## Exact result

| Item | Observed |
|---|---|
| Product | Nix package manager |
| Version | `2.35.2` |
| Target | `x86_64-linux` |
| Payload bytes | `27131728` |
| Payload SHA-256 | `0c3960a9792331a22081c3c7a5d8465db9b17c50b3acdf18587fa4c6f2cb1158` |
| Carrier bytes | `36175640` |
| Archive entries | `2280` |
| Artifact ID | `9395914433` |
| Artifact ZIP SHA-256 | `3b4ba91c55769c9af1509b47b2d09e98f0ff85d3f51b4bebf5cfe6b8542f4a48` |
| Runtime command | `/usr/local/bin/nix` |
| Version probe | `nix (Nix) 2.35.2` |
| Offline eval | `40 + 2 → 42` |
| Store add/readback | `/nix/store/rd8wyxjnja6f1l7g8ib8hf1fz8l10g1r-store-proof.current-sandbox.txt` → PASS |
| Offline derivation build | `/nix/store/il9w5860wq8y69ncw5ydzh73sj5nrgp4-nix-carry-offline-build-proof` → PASS |

## Important observation

A crawled public page still showed Nix 2.35.1, while the live official installer resolved 2.35.2. Therefore a product-name resolver must not convert a stale search result directly into an immutable artifact request. It must read the live official pointer, then seal the resulting exact version, platform, URL, and digest before acquisition.

## Boundary

The proof establishes the full path from an abstract order to a usable current-sandbox runtime. It does not make the installation persistent across future conversations and does not prove outbound access to nixpkgs or cache.nixos.org from this sandbox.
