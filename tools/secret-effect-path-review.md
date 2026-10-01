# Secret-effect completion (#436)

One CI intent inventory and one parsed-YAML checker remain. All retained effect jobs and their contributing inputs use the same exact workflow revision. Tools are resolved from the repository's existing nixpkgs lock before any credential is exposed; provider steps use the fixed binaries, not npx/pip at execution time.

## Dispositions

| Entry | Disposition | Evidence / retained responsibility |
|---|---|---|
| artifact-runtime-static-host | Keep and fix | ops#230 owns a distinct content-addressed Artifact Runtime endpoint. Its secret-free PR source parity remains, explicitly separated from owner-command effect. |
| mobile-agent-preset-static-host | Retire active workflow | Its bootstrap exception (ops#233) expired on 2026-09-30 and was not renewed. The owner-commanded exact-Release Pages deploy entry is removed and not replaced. The existing Releases, site and `verification/mobile-agent-preset-app` sources are kept. |
| mobile-agent-url-only-runtime | Retire active workflow | Its bootstrap exception (ops#293) expired on 2026-09-30 and was not renewed. The deploy-once hosted compiler entry is removed, so nothing produces a new `accepted/mobile-agent-public-url` receipt; `mobile-agent-public-url-required` is kept and cannot pass for a new head until a producer exists. `verification/mobile-agent-url-only-runtime` sources and existing Releases are kept. |
| mobile-agent-business-model-public | Retire active workflow | Older one-file publisher overlaps the presentation/test responsibility already executed by URL-only build.py and cannot coexist with its hosted compiler without overwrite. Keep source tests and immutable Release evidence. |
| mobile-agent-seq-comment-ingress | Retire active workflow | One-shot historical comment-chunk transport, not a permanent consumer runtime. Keep Carrier/browser evidence and current preset/runtime paths; do not resurrect it for a safety checkbox. |

Retirement removes entrypoints, not deployed sites, frozen Releases, or evidence. It does not mark old product goals as physically complete.

The unchanged source lock supplies a single Nix tool closure to the retained paths. The new ordinary Nix check starts its real Python/Chromium runtime and Wrangler CLI without secrets. It does not exercise live provider effects.

The bounded workflow checker is not a theorem about arbitrary programs. Exact source review, immutable runtime inputs, physical Environment/ref protection and a real approved effect remain distinct evidence. Unknown workflow forms stay RED. #435 may supply the same approved real deployment used as #436's positive, avoiding a circular wait and duplicated live deployment.
