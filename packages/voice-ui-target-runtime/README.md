# Voice UI consumer: real-environment waiting boundary

## Responsibility

Env supplies an approved non-secret projection receipt and target-native authentication. Apps produces immutable application bytes and a completed Worker, published as an exact release. Ops deploys those same bytes and reads both public hosts back. Application acceptance belongs to apps (apps#27); ops neither runs it nor claims it. Old credential revocation remains with the credential owner after new-use proof.

Normal execution does not check out envs, start its workflows, invoke envctl/auth exec, fetch auth bundles, decrypt SOPS, rebuild or evaluate the app, execute any app code, or install packages.

## One provisioned runtime

The Nix `voice-ui-target-runtime` output includes the admitted app artifact as data, fixed Node/Wrangler and the real deploy/readback adapters. It contains no app source and no app executable or browser runtime. The entire Nix store closure is provisioned and approved before credentials are available. The package does not rely on hashes of arbitrary caller-supplied scripts to authenticate their dependencies.

The app artifact is the exact apps release `voice-ui-dist-e5506cd0e4b08464ab96b9365aa1259ea9154dd5`, fetched at build time by locator and pinned by digest: zip sha256 `18a324d6ef6a10cba695eadd691d7a0c2bf7e4d2081103972969a1b1eca33cc2`, `merged-pr-proof.json` sha256 `940c306f666595b2eec1cd18d43f837bfc6210cb2b73ebac3f9de0e6fc10d544`, `provenance.json` sha256 `a67b0cfe1b5d5bf86d2fe535869197046b2b3978089cfbdd58e32d2354d0dd75`. Before the zip is staged, the proof must match apps PR 33, reviewed head `c8e1e1fb2df1ceace9709c9c01ad2b38257744c2`, Green review 5350294364, merge `e5506cd0e4b08464ab96b9365aa1259ea9154dd5` and equal tree `e3de3068f8af36ddddc4e6cd95318bbb23cadbde`. The producer's provenance must name that same source commit and tree, the release workflow on `proposals`, the exact locator, and the zip's actual sha256 and size, so the pinned bytes are bound to the proof's merge. No cross-host byte reproducibility is claimed. Provider receipt layout is based on envs#16; the actual projection SHA and approved receipt digest are run inputs, not frozen to the old schema-reference SHA.

`voice-ui-target-runtime --describe` returns the installed ops/app identities and artifact manifest digest. The normal command is `voice-ui-target-runtime --request approved.json`. The approved request contains only:

- kind `ops.voiceUiTargetRuntimeRequest.v1`;
- expected ops/app identities from the installed package, actual envs SHA, approved projection-receipt and isolation-verdict SHA-256 digests, and target `{provider,accountId,project,branch}`;
- inputs `{projectionReceipt,isolationVerdict}` as local non-secret file paths;
- a new empty output directory.

Expected digests come from approval of the respective producer evidence, not from trusting arbitrary incoming bytes. The installed package selects its own immutable app artifact and adapters. The user request cannot select executables, supply extra adapters or override provider hosts.

`voice-ui-isolation-capture` is a build/review-time helper: `--root <exact clean ops checkout> --ops-sha <exact SHA> --output <new JSON>`. Its fixed Node/Git/yq runtime calls the single #436 checker, binding source and workflow-tree identities. Normal consumption receives that evidence as data and does not need the checkout.

## Actual operations

Deploy checks the existing project and production branch, stages exact `site/` bytes plus the already compiled `worker/worker.mjs` as `_worker.js`, and invokes fixed Wrangler with `--no-bundle`. It uses Wrangler's structured output and a fresh API readback of exact deployment ID, source and complete success; terminal text or command exit alone cannot PASS.

Readback has no credential. It verifies every public file on both deployment-specific and stable hosts and checks the Function's invalid-JSON rejection. A missing/invalid target, incomplete deploy, changed public byte or previous output cannot produce `DEPLOY_READBACK_PASS`. That claim covers deploy and readback only, never application acceptance.

## CI versus real environment

The single ordinary Nix check runs existing destructive/unit tests, real adapter tests and an actual composed runtime proof. The latter uses the installed production code, real Wrangler and the actual pinned app artifact. Only provider/network transport is a controlled loopback fixture; it checks exact Worker upload bytes and all static-byte readbacks, and that nothing but the package's deploy and readback adapters is started. It is not live Cloudflare/Jev or product-behavior success.

Source readiness requires this exact-candidate check to pass and the source to be reviewed/merged. A mere version command, fixture-only unit PASS or pending CI is insufficient.

After source/CI acceptance, the remaining inputs are physical: approved provider/effect credentials and Environment protection, actual target-native projection and its accepted handoff, then the existing command against live services. #436 needs its approved live-effect positive. Real application acceptance twice (apps#27) remains OPEN: it must obtain an apps acceptance-runtime artifact artifact-only, run in a separate credential-free process tree and correlate to this exact deploy/readback receipt. This runtime does not execute that join.

## cf checkpoint (Workers path, not yet the deploy path)

The deploy path above is still Pages through Wrangler. The coming path is Cloudflare Workers with static assets, deployed by the `cf` CLI with `cf deploy --prebuilt`. This checkpoint proves only what the pinned CLI does offline; the adapter, product metadata and delivery come later.

- `cf.nix` pins `cf@1.0.0-beta.6` through `cf/package-lock.json`: every npm tarball is a fixed-output fetch keyed by its lock integrity. Nothing is resolved or installed at run time, and telemetry is off.
- `tests/workers.test.mjs` builds a Build Output with the pinned `@cloudflare/build-output-utils` writers from the admitted artifact's unchanged `worker/worker.mjs` and `site/`. The Worker metadata (name, compatibility date `2026-09-01`, `ASSETS` and `JEV_API_KEY` bindings) is an explicit `NON_PRODUCT` fixture, not the product's declared requirements. A planted `.env` holds sentinel credentials that must never be used.
  - C3: `cf deploy --prebuilt --dry-run` exits 0 and makes no request at all.
  - C4a: a new Worker that declares the `JEV_API_KEY` secret is refused natively unless the secret value is supplied, and the `.env` is not a source of it; no script is uploaded.
  - C4b: with `--secrets-file` holding a never-issued fixture value, `cf deploy --prebuilt` talks only to a recording loopback provider fixture (`CLOUDFLARE_API_BASE_URL`) with a never-issued account and token. Asserted exactly: the only module is the admitted `worker.mjs` and it is the main module; the bindings are exactly `JEV_API_KEY` (fixture value) and `ASSETS`; the date is the fixture's; the asset manifest names exactly the site files and every uploaded body equals its site file; the native `deploy` event's `version_id` equals the one the fixture issued.
  - C4c: for a Worker that already exists with a preset `JEV_API_KEY`, and no Jev value in the deploy context (no `--secrets-file` or Jev environment variable, C4b's fixture secrets file removed first, and no request carrying its value, all asserted), the CLI sends `JEV_API_KEY` as an explicit `inherit` binding (no value, no `keep_bindings`). This proves only what the CLI sends; whether the provider actually keeps the preset secret under `inherit` is provider behaviour not proven here.
  - C4d: `--keep-vars` does not exist on this path (`Unknown arguments`).
  - C4e: when the existing Worker has no such secret, the CLI still sends `inherit`; it does not check. The fixture accepts it, so its exit 0 is not a positive result, and whether the provider rejects it is not proven here. The future adapter must read the Worker's settings and fail closed when the secret is absent.
  - Across every run (C3 to C4e), every request carries only the never-issued fixture token, and the planted `.env` is never used or printed.
- The Nix check runs it with `--require-isolation`: it fails unless the kernel shows a loopback-only network namespace (only `lo`, and a TEST-NET-1 connect fails with `ENETUNREACH`). A passing check (`CF_CHECKPOINT_OFFLINE_PASS_ISOLATED`) therefore means no request could leave loopback; an unsandboxed build fails the check. Run directly without the flag, the test grades itself `UNISOLATED`.

Not proven here: live Cloudflare, any real account or token, Workers authority for a real target (the existing Pages handoff is not Workers authority), provider behaviour for `inherit` (keeping a preset secret, or rejecting a missing one), product metadata, and a delivered runtime. Deploying a new Worker needs the `JEV_API_KEY` value at deploy time (C4a). For an existing Worker the CLI asks to inherit the secret without any value in the deploy context (C4c), but does not check it exists (C4e), so the future adapter needs its own settings check before deploying. Which applies to a real target, and who presets the secret, is an open credential boundary, not decided here.
