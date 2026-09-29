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
