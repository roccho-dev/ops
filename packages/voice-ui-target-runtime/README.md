# voice-ui target runtime

This package owns exact input admission, deployment orchestration, public readback admission, and two independent invocations of the apps-owned acceptance entrypoint. It does not own secret authoring/projection, app behavior, or repository-wide workflow classification.

## Inputs and authority

The approved request binds:

- exact `opsSha`, `envsSha`, `appsSha` and target identity;
- `artifactManifestSha256` for the complete `voice-ui-dist/1` artifact;
- `projectionReceiptSha256` for the accepted provider handoff;
- `isolationVerdictSha256` for the accepted #436 source-isolation verdict;
- SHA-256 identities for the deploy and public-readback adapter entry files.

Expected digests are approved inputs, not authority obtained by hashing an arbitrary incoming receipt. The orchestrator checks every input and both adapter identities before any provider mutation. The caller must provide a trusted, fixed runtime and approved adapter dependency closures; an entry-file hash alone does not authenticate imported code or external tools.

Provider compatibility is reviewed against envs#16 at `d0bfafec05c467c8ebd89ed75c4abe8a6b8c8477`. This is a schema reference, not a requirement that a future real projection use that same commit. The receipt's actual exact projection SHA is supplied in the approved request.

The current `envs.projectionReceipt.v1` has `projector.workflow` and `projector.adapter`. Provider source/workflow/adapter paths are non-executable evidence inside the pinned receipt. Ops neither opens these paths nor hardcodes envs' internal directory layout. The superseded `projector.script` shape is not a fallback.

## Execution and evidence

```text
approved exact inputs
-> admit artifact closure, receipt identities, target and effect capability
-> deploy existing bytes
-> read back every site file and the Function route
-> apps acceptance in fresh process/workspace/HOME #1
-> apps acceptance in fresh process/workspace/HOME #2
-> NEW_PROJECTION_REAL_USE_PROVEN
```

Only the deploy process receives the Cloudflare effect capability. Other children receive an explicit non-secret environment allowlist. Existing HOME, arbitrary token names and loader-injection variables are not inherited. Raw effect-adapter stdout/stderr is not forwarded.

The output directory must be empty. A previous receipt, successful deploy without readback, an incomplete public-file set, empty/duplicate acceptance checks, or a second-run failure cannot create a new overall PASS.

Readback receipts carry `publicBytes.files` as `{path, bytes, sha256}` rows for every `site/` file in the admitted manifest. These are adapter observations, not values to copy from the manifest without reading the target.

Normal execution does not check out envs, use envctl/auth exec, fetch an auth bundle, decrypt SOPS, or read an age identity. An approved receipt is consumed as data, not executable provider code.

## Isolation capture

`capture-isolation.mjs` is build/review-time work, not runtime source checkout. It invokes the existing #436 classifier and records checker/intent/boundary digests plus the workflow Git tree identity. Capture requires exact Git HEAD and clean, tracked source inputs; an archive with a caller-supplied SHA is insufficient.

```console
node packages/voice-ui-target-runtime/capture-isolation.mjs --root . --ops-sha <exact-sha> --output <new-isolation.json>
node packages/voice-ui-target-runtime/run.mjs --request <approved-request.json>
```

#436 static isolation is a pre-effect gate. Its remaining real-effect positive can use the same approved live voice-ui run; no obsolete Seq transport needs to be revived only to obtain a second proof. Source CI or a merged #438/#440 alone does not close #436.

## Verification and remaining physical work

The existing registered Node test entrypoint exercises native subprocess orchestration, current provider receipt shape, exact admission, artifact completeness, secret-input exclusion and destructive negative cases. All effect/acceptance processes in these tests are explicitly offline fixtures. They do not prove a real provider or app.

Real completion additionally needs the configured target-native projection and approved handoff, approved real deploy/readback adapters and their complete runtime, the apps-owned acceptance runtime (including resolvable Playwright and Chromium), #436's required isolation evidence, and two successful real application runs. Missing inputs remain blockers; there is no archive, auth-exec, local mock or runtime-install fallback.
