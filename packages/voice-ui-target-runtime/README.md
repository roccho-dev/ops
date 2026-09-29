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

## Runtime carrier (closed-network provisioning)

`cache.nixos.org` does not serve `wrangler-4.62.0` for this repository's nixpkgs pin, and building it needs `registry.npmjs.org`. A consumer on a closed network therefore cannot provision this runtime from the official cache alone. `.github/workflows/voice-ui-target-runtime-carrier.yml` publishes exactly the paths the official signed cache cannot supply as an unsigned native `file://` binary cache.

`tools/voice-ui-target-runtime-carrier.py` is a release helper only; it is not part of the runtime output or closure.

- **Missing set.** Eight derivations are classified local by exact name: the apps fetches `voice-ui-dist.zip`, `merged-pr-proof.json` and `provenance.json`; the roots `check-voice-ui-release.py`, `voice-ui-dist-release`, `voice-ui-target-runtime` and `voice-ui-target-runtime-boundary`; and the nixpkgs wrapper `nodejs-24.14.1` (drv `8l6p07vmrcj7lsry0jz2ayp1rmpyjdai`, out `785jidgnryzj566s25s3rb262d4g5znb`), which sets `allowSubstitutes` false. Any other local-only input derivation is a STOP. After that classification, the external inputs absent from the official signed cache must be exactly `{wrangler-4.62.0}`, the lock-pinned `nixpkgs#wrangler.outPath`, and every reference of it must be signed on the official cache.
- **Carrier.** `nix copy --to file://…?compression=zstd&compression-level=19&parallel-compression=false` of that path, pruned by its parsed narinfo to exactly `nix-cache-info`, the carried narinfo and the NAR named by its `URL:`. StorePath, References, NarHash/NarSize, FileHash/FileSize and the absence of `Sig:` are checked; no listing, log, debug info, realisation or other narinfo may survive. It is packed into one deterministic tar that must be below 2,147,483,648 bytes, or the run stops.
- **Release.** Tag `voice-ui-target-runtime-carrier-<full merge sha>` with exactly `voice-ui-target-runtime-carrier.tar`, its `.sha256`, `provenance.json` and `merged-pr-proof.json`. The provenance records the source commit and tree, the `flake.lock` digest, the Nix version, the eight local derivations, the carried path and narinfo, every external reference with its official signature and NarHash, the archive digest and the locator, with `cross_host_bytes_reproducible: false`. The proof requires the latest non-dismissed review on the exact PR head to carry exactly one `ROUND_<n>_GREEN` token and no `ROUND_<n>_CORRECTIONS` token, with equal reviewed and merge trees. Publication runs only from an explicit proposals dispatch, in a job that runs no Nix.

### Consumer contract

Run as root or a single-user Nix owner, with `NIX_CONFIG` unset and every option on the command line; no global Nix configuration is changed. Record the Nix version.

1. Fetch the four assets anonymously and require their pinned sha256 digests. Run `tools/voice-ui-target-runtime-carrier.py verify <dir> --sha <merge sha> --repository roccho-dev/ops` from that exact source commit; it checks the asset set, archive digest and size, the exact archive members, the narinfo fields, FileHash/FileSize, the provenance and the proof without Nix or network. Extract the archive to `$CARRIER`.
2. **Phase A** realises exactly the carried path; no build or fallback is possible:

   ```sh
   nix-store --realise /nix/store/4wg6l17z27a2hpw6wz21pxy7cm43zj8l-wrangler-4.62.0 \
     --option max-jobs 0 --option fallback false --option require-sigs true \
     --option substituters "https://cache.nixos.org file://$CARRIER?trusted=true" \
     --option trusted-public-keys "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
   ```

   `trusted=true` exempts only that pinned local store from signature checks; Nix still checks the carried NAR against its NarHash, and every other path must carry the official signature. Then compare `nix path-info --json` NarHash/NarSize with the provenance and run the content-only `nix store verify --no-trust` on the carried path. (`--sigs-needed 0` still reports an unsigned path as untrusted and exits non-zero.)
3. **Phase B** runs `nix build --dry-run` of `github:roccho-dev/ops/<sha>#voice-ui-target-runtime` and `#checks.x86_64-linux.voice-ui-target-runtime` with the same substituters, keys, `require-sigs true` and `fallback false`, and checks it with `tools/voice-ui-target-runtime-carrier.py dry-run-check --log <stderr>`. `will be built` must be exactly the seven other local derivations and may additionally contain the exact `nodejs-24.14.1` wrapper, nothing else. `will be fetched` may contain only paths signed on the official cache. Neither `wrangler-4.62.0` nor `wrangler-pnpm-deps` may appear. Then build with the same options and sandboxing; the boundary check must report `CI_BOUNDARY_PASS` / `LIVE_PROVIDER_NOT_RUN`, and only allowlisted hosts may be contacted, with no npm or DNS attempt.

Plain `nix copy --from file://…` is informational only and never selects the consumer path. The producer runs the same Phase A and Phase B in fresh stores, and rejects a flipped NAR, an extra narinfo, an omitted carrier, an omitted official key and an omitted `trusted=true`. The authoritative proof is a fresh clean OCI.
