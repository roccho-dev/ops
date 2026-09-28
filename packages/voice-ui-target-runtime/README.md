# Voice UI consumer: real-environment waiting boundary

## Responsibility

Env supplies an approved non-secret projection receipt and target-native authentication. Apps produces immutable application bytes, a completed Worker and its acceptance/browser runtime. Ops deploys those same bytes, reads both public hosts back, then invokes the app acceptance twice with independent HOME/workspaces. Old credential revocation remains with the credential owner after new-use proof.

Normal execution does not check out envs, start its workflows, invoke envctl/auth exec, fetch auth bundles, decrypt SOPS, rebuild the app, or install packages.

## One provisioned runtime

The Nix `voice-ui-target-runtime` output includes the admitted app artifact, fixed Node/Wrangler, real deploy/readback adapters and the apps-owned Node/Playwright/Chromium runtime. The entire Nix store closure is provisioned and approved before credentials are available. The package does not rely on hashes of arbitrary caller-supplied scripts to authenticate their dependencies.

The app producer is pinned to accepted apps#30 merge `28c1eee878004c87fcef3aaa1955517c31f73829`. Provider receipt layout is based on envs#16; the actual projection SHA and approved receipt digest are run inputs, not frozen to the old schema-reference SHA.

`voice-ui-target-runtime --describe` returns the installed ops/app identities and artifact manifest digest. The normal command is `voice-ui-target-runtime --request approved.json`. The approved request contains only:

- kind `ops.voiceUiTargetRuntimeRequest.v1`;
- expected ops/app identities from the installed package, actual envs SHA, approved projection-receipt and isolation-verdict SHA-256 digests, and target `{provider,accountId,project,branch}`;
- inputs `{projectionReceipt,isolationVerdict}` as local non-secret file paths;
- a new empty output directory.

Expected digests come from approval of the respective producer evidence, not from trusting arbitrary incoming bytes. The installed package selects its own immutable app/runtime/adapters. The user request cannot select executables or override provider hosts.

`voice-ui-isolation-capture` is a build/review-time helper: `--root <exact clean ops checkout> --ops-sha <exact SHA> --output <new JSON>`. Its fixed Node/Git/yq runtime calls the single #436 checker, binding source and workflow-tree identities. Normal consumption receives that evidence as data and does not need the checkout.

## Actual operations

Deploy checks the existing project and production branch, stages exact `site/` bytes plus the already compiled `worker/worker.mjs` as `_worker.js`, and invokes fixed Wrangler with `--no-bundle`. It uses Wrangler's structured output and a fresh API readback of exact deployment ID, source and complete success; terminal text or command exit alone cannot PASS.

Readback has no credential. It verifies every public file on both deployment-specific and stable hosts and checks the Function's invalid-JSON rejection. Only then does the actual app acceptance run. A missing/invalid target, incomplete deploy, changed public byte, missing required app check, previous output or failed second run cannot produce `NEW_PROJECTION_REAL_USE_PROVEN`.

## CI versus real environment

The single ordinary Nix check runs existing destructive/unit tests, real adapter tests and an actual composed runtime proof. The latter uses the installed production code, real Wrangler, actual completed app artifact and real Chromium. Only provider/network transport is a controlled loopback fixture; it checks exact Worker upload bytes, all static-byte readbacks and two independent browser/API starts. The controlled application returns 503, so application RED and absence of overall PASS are required. It is not live Cloudflare/Jev or product-behavior success.

Source readiness requires this exact-candidate check to pass and the source to be reviewed/merged. A mere version command, fixture-only unit PASS or pending CI is insufficient.

After source/CI acceptance, the remaining inputs are physical: approved provider/effect credentials and Environment protection, actual target-native projection and its accepted handoff, then the existing command against live services. Real app success twice is still necessary to close #27/#435; #436 needs its approved live-effect positive. The same live deploy can supply both without resurrecting obsolete transports or adding another runner.
