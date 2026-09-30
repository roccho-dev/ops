# Voice UI consumer: real-environment waiting boundary

## Responsibility

Env supplies an approved non-secret handoff and target-native authentication. Apps produces the immutable PRODUCT (the application zip with its declared Worker runtime) and a separate ACCEPTANCE runtime closure, each published as an exact release. Ops provides DEPLOY: this runtime, which deploys the PRODUCT's exact bytes to an existing Cloudflare Worker with static assets and reads the public site back. Application acceptance belongs to apps (apps#27); ops neither runs it nor claims it. Old credential revocation remains with the credential owner after new-use proof.

Normal execution does not check out envs, start its workflows, invoke envctl/auth exec, fetch auth bundles, decrypt SOPS, rebuild or evaluate the app, execute any app code, or install packages.

## One provisioned runtime (DEPLOY)

The Nix `voice-ui-target-runtime` output holds the pinned `cf` CLI and its Build Output library, fixed Node and unzip, and the deploy/readback adapters (`workers.mjs`). It holds no PRODUCT or ACCEPTANCE bytes, no app source or executable, and no Wrangler, Python, envs, SOPS or age; the Nix check refuses a closure that does.

The PRODUCT is a data operand, pinned in `default.nix` as reviewed data from the actual canonical apps release `voice-ui-dist-39dc6df680208ffe3c38b0330db26680022261bf` (apps PR 40, reviewed head `19b466845bfc35641b7181c7307ef1d521a00d20`, Green review 5372940178, merge `39dc6df680208ffe3c38b0330db26680022261bf`, equal tree `351ddcffa4be2b827aaab616359cd2b9cc66236d`): zip sha256 `54222e83…` (62,383,440 bytes), `merged-pr-proof.json` `8f63f2ad…`, `provenance.json` `df736241…`, manifest `db10ad3f…`, compiled Worker `78f988f7…`, and the ACCEPTANCE export's identity (`dae204f3…`, 916,043,600 bytes, 176 paths). The full ACCEPTANCE closure metadata stays in that provenance. A consumer passes a directory holding exactly the release's zip, proof and provenance; `modules/input-contracts.mjs` admits it once: the three digests, the proof's exact reviewed merge, the provenance's producer, source and tree (equal to the proof), zip and acceptance identity, then the fixed unzip, the `voice-ui-dist/2` manifest, its exact declared runtime block (`worker/worker.mjs`, `site/` bound as `ASSETS`, `2026-09-01`, no flags, `JEV_API_KEY` for `jev-api`) and the compiled Worker's digest. There is no other admission. No cross-host byte reproducibility is claimed.

`voice-ui-target-runtime --describe` returns the installed identities, pin and gate entry without running anything. The normal command is `voice-ui-target-runtime --request approved.json`. The approved request contains only:

- kind `ops.voiceUiTargetRuntimeRequest.v2`;
- expected ops/apps identities and manifest digest equal to the installed package, the envs SHA, approved handoff and isolation-verdict SHA-256 digests, and target `{provider: cloudflare-workers, accountId, workerName, url}`;
- inputs `{product, projectionReceipt, isolationVerdict}` as local non-secret paths;
- a new empty output directory.

The target `url` is owner-approved data, a bare https origin with no userinfo, query or fragment, bound by the approved request; it is not a provider-verified route. The user request cannot select executables, supply extra adapters or override provider hosts.

The handoff slot is ops' expectation of an envs-owned output (`envs.projectionReceipt.v1` with target `{provider: cloudflare-workers, account_id, worker_name, secret_name: JEV_API_KEY}` and effect `cloudflare_workers_secret_put`). envs does not produce it today, so a real run is NOT_CONFIGURED and fails before any provider call until the envs owner agrees that output; `tests/fixtures/envs-projection.json` is a never-issued fixture of the expectation, not envs compatibility.

`voice-ui-isolation-capture` is a build/review-time helper: `--root <exact clean ops checkout> --ops-sha <exact SHA> --output <new JSON>`. Its fixed Node/git/yq runtime calls the single #436 checker, binding source and workflow-tree identities. Normal consumption receives that evidence as data and does not need the checkout.

## Actual operations

Deploy, with fixed native `cf` commands only (no manual provider HTTP):

1. `cf workers secrets list --worker <name>` must list every declared secret NAME. A missing Worker or name fails closed before any mutating call. Name presence is not authority, not the value and not projection proof.
2. A Build Output is written by the pinned `@cloudflare/build-output-utils` from the admitted bytes and the declared runtime, and `cf deploy --prebuilt --mode production` deploys it. For the existing Worker the CLI sends `JEV_API_KEY` as `inherit` with no value (C4c below); whether the provider keeps the value is not proven.
3. The native `deploy` event's `version_id` must be the one version of the first listed deployment at 100% (`cf workers deployments list`).

Readback has no credential. It fetches every public site file at the approved URL and compares bytes, and posts invalid JSON to `/api/jev`, which the Worker answers 400 `invalid_json` only when its secret is present (it answers 503 first otherwise). Provider-stored module bytes cannot be read back with the CLI: `storedModuleBytes` is `NO_CAPABILITY_NOT_RUN`. The final receipt's `limits` record that, `NAME_PRESENT_NOT_AUTHORITY` and `inheritPreservation: NOT_PROVEN`. `DEPLOY_READBACK_PASS` covers deploy and readback only, never application acceptance.

## Checks and the fresh-consumer gate

`tests/workers.test.mjs` is one program with one recording loopback provider. The DEPLOY closure carries it unchanged as `bin/voice-ui-target-runtime-gate`, which ordinary entries never run. It admits the PRODUCT with the installed admission, runs C3–C4e below, then the installed runtime (`INSTALLED_ADAPTER_LOOPBACK_HARNESS`): `--describe` and a no-credential `--request` make no provider call, and the installed lib runs the installed adapters through its private spawn seam with the loopback api/fetcher, which no request or environment field can set. The fixture serves the site by executing the uploaded Worker module with `ASSETS` serving the uploaded asset bytes (`FIXTURE_SERVED`), and every provider fetch from the Worker is counted and refused:

- `PRESET_SECRET_FIXTURE`: the name is listed and the Worker holds a never-issued value. The preflight precedes every mutation; the CLI sent exactly the admitted module, all asset bytes, `JEV_API_KEY:inherit`, `ASSETS` and the date (`CLI_SENT_EXACT`); the version matches; readback passes with the Worker's own 400. Valid JSON is refused in this phase, so no Jev call is reachable.
- `PREFLIGHT_SECRET_ABSENT`: no name listed; refused with no mutating call.
- `SECRET_ABSENT_FIXTURE`: the name is listed but the Worker has no value; the probe gets 503 and readback is RED.
- `NO_SECRET_ACCEPTANCE` (gate only): the imported ACCEPTANCE runtime runs the PRODUCT's acceptance entry in its own credential-free process; the page's one same-origin `/api/jev` call gets 503 and the result is `RED_EXPECTED` / `NOT_RUN: jev_unavailable`.

The Nix check runs `tests/run.test.mjs` (admission, target, handoff and before-effect negatives on the real release files) and this program with `--require-isolation`, without acceptance (its closure cannot be imported in a build). `.github/workflows/voice-ui-target-runtime.yml` exports the DEPLOY closure with native path-info provenance (CI_ONLY until published); its `voice-ui-cf-consumer-cleanstart` job, with no checkout and no build, downloads the canonical PRODUCT and ACCEPTANCE anonymously and this run's DEPLOY, imports both closures as root, compares them with their provenance, and runs `sudo voice-ui-target-runtime-gate`, which enters a network namespace with only `lo` and drops to the invoking user. A guarded, Nix-free publish releases DEPLOY (four assets) only by an explicit proposals dispatch; publication is not readiness, and the same gate must pass again on the published canonical tuple.

None of this is live Cloudflare, a real account, token, secret or Jev call, or application success. The remaining inputs are physical: an approved Workers handoff from envs, provider/effect credentials and Environment protection, then the existing command against the live target. #436 needs its approved live-effect positive; real application acceptance (apps#27) remains OPEN.

## cf checkpoint (C3–C4e)

These characterise the pinned `cf deploy --prebuilt` offline with an explicitly NON_PRODUCT Worker config, before the installed stage above.

- `cf.nix` pins `cf@1.0.0-beta.6` through `cf/package-lock.json`: every npm tarball is a fixed-output fetch keyed by its lock integrity. Nothing is resolved or installed at run time, and telemetry is off.
- `tests/workers.test.mjs` builds a Build Output with the pinned `@cloudflare/build-output-utils` writers from the admitted PRODUCT's unchanged `worker/worker.mjs` and `site/`. The Worker metadata (name, compatibility date `2026-09-01`, `ASSETS` and `JEV_API_KEY` bindings) is an explicit `NON_PRODUCT` fixture, not the product's declared requirements. A planted `.env` holds sentinel credentials that must never be used.
  - C3: `cf deploy --prebuilt --dry-run` exits 0 and makes no request at all.
  - C4a: a new Worker that declares the `JEV_API_KEY` secret is refused natively unless the secret value is supplied, and the `.env` is not a source of it; no script is uploaded.
  - C4b: with `--secrets-file` holding a never-issued fixture value, `cf deploy --prebuilt` talks only to a recording loopback provider fixture (`CLOUDFLARE_API_BASE_URL`) with a never-issued account and token. Asserted exactly: the only module is the admitted `worker.mjs` and it is the main module; the bindings are exactly `JEV_API_KEY` (fixture value) and `ASSETS`; the date is the fixture's; the asset manifest names exactly the site files and every uploaded body equals its site file; the native `deploy` event's `version_id` equals the one the fixture issued.
  - C4c: for a Worker that already exists with a preset `JEV_API_KEY`, and no Jev value in the deploy context (no `--secrets-file` or Jev environment variable, C4b's fixture secrets file removed first, and no request carrying its value, all asserted), the CLI sends `JEV_API_KEY` as an explicit `inherit` binding (no value, no `keep_bindings`). This proves only what the CLI sends; whether the provider actually keeps the preset secret under `inherit` is provider behaviour not proven here.
  - C4d: `--keep-vars` does not exist on this path (`Unknown arguments`).
  - C4e: when the existing Worker has no such secret, the CLI still sends `inherit`; it does not check. The fixture accepts it, so its exit 0 is not a positive result, and whether the provider rejects it is not proven here. The adapter therefore runs the secret-name preflight above and fails closed before deploying.
  - Across every run (C3 to C4e), every request carries only the never-issued fixture token, and the planted `.env` is never used or printed.
- The Nix check and the gate run it with `--require-isolation`: it fails unless the kernel shows a loopback-only network namespace (only `lo`, and a TEST-NET-1 connect fails with `ENETUNREACH`). A passing check (`CF_CHECKPOINT_OFFLINE_PASS_ISOLATED`) therefore means no request could leave loopback; an unsandboxed run fails the check. Run directly without the flag, the test grades itself `UNISOLATED`.

Not proven here: live Cloudflare, any real account or token, Workers authority for a real target (the Pages handoff is not Workers authority, and envs does not yet produce a Workers handoff), provider behaviour for `inherit` (keeping a preset secret, or rejecting a missing one), and provider-stored module bytes. A new Worker would need the `JEV_API_KEY` value at deploy time (C4a), so the adapter deploys only to an existing Worker that already lists the secret name. Who presets the secret for a real target is an open credential boundary, not decided here.
