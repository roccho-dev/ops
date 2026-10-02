# Jev CLI

## S1 source-only named Choice model evidence

The existing `src/batch.mjs` owner accepts optional execution settings `model`
(default `jev-latest`) and `includeEvidence` (default `false`). Omitted settings
preserve the existing request, result `{answers}`, closed errors, and
optional/subset finite-probability contract.

The opt-in requires an explicit `jev-<digits>.<digits>.<digits>` model and returns:

```js
{
  answers,
  evidence: {
    modelRequested,  // sent version, never substituted for observation
    modelObserved,   // returned version-shaped string, or null
    code             // null | model_missing | model_unbound | model_mismatch
  }
}
```

Missing model property gives `model_missing`. Blank, wrong-type, alias or
unsupported model metadata gives `model_unbound` with observed=null. A supported
but different version is retained with `model_mismatch`; an exact match gives
code=null. This proves syntax/binding only, not that the real model exists or
executed. Typed answers remain available despite model evidence defects, but
invalid answers still fail through the same shared validator. No raw model-field
object/text, confidence threshold, retry, second transport, or credential
acquisition is added.

This opt-in source contract has offline tests only. Past Releases and
`named-choices/2` consumer evidence do not prove this new path; no new Release,
real-provider identity, D acceptance, or quality improvement is claimed.

## CLI usage

Ask Jev a question about text. The CLI reads one JSON request on stdin and writes one JSON line.

Intentionally narrow subset: string `text` and `question` fields; choice questions support 2-255 string-valued options; score questions support 2-10 string-valued levels. The underlying API may support richer data types; CLI constrains input to string values only.

```sh
nix build .#jev
```

## Legacy compatibility usage

The envctl examples below document the older auxiliary interface, not current
normal application acceptance. The target owner supplies an opaque credential
through its approved one-child entry; this package does not acquire or decrypt it.

Set `ENVS_BUNDLE`, `SOPS` and `AGE_KEY_FILE` to absolute paths for the envs auth bundle, sops executable and age identity:

### Noul

```sh
printf '%s\n' '{"type":"noul","text":"A lamp is on.","question":"Is the lamp on?"}' |
  envctl auth exec -bundle "$ENVS_BUNDLE" -environment local \
    -artifact "$PWD/result/share/jev/artifact.jsonl" \
    -sops "$SOPS" -age-key-file "$AGE_KEY_FILE" -- "$PWD/result/bin/jev"
```

Response: `{"model":"...","noul":0.99}` (noul in [0,1]).

### Choice (2-255 options)

```sh
printf '%s\n' '{"type":"choice","text":"...","criteria":{"a":"option a","b":"option b"},"question":"Pick one"}' |
  envctl auth exec ... -- "$PWD/result/bin/jev"
```

Response: `{"model":"...","choice":{"type":"choice","choice":"a","probabilities":{"a":0.8,"b":0.2},"confidence":0.9}}`.

### Score (2-10 levels)

```sh
printf '%s\n' '{"type":"score","text":"...","criteria":["low","medium","high"],"question":"Rate it"}' |
  envctl auth exec ... -- "$PWD/result/bin/jev"
```

Response: `{"model":"...","score":{"type":"score","score":1.05,"legend":{"0":"low","1":"medium","2":"high"},"probabilities":{"0":0.1,"1":0.85,"2":0.05},"confidence":0.92}}`. Score is fractional [0, levels-1]; legend and probabilities keys are 0-indexed.

## Exit codes

- 0: success
- 1: input error (invalid JSON, missing fields, invalid types)
- 2: authentication error (missing or empty JEV_API_KEY)
- 3: provider error (unreachable, HTTP error including transient 503, unparseable response; no automatic retry)
- 4: contract error (invalid response structure)
- 5: internal error (fatal)

## Credentials

The installed artifact requires `jev-api`; the selected envs environment must supply its binding. `envctl` injects `JEV_API_KEY` into the CLI child process. Installing or merging this package does not provision a credential. Pass no key in arguments or stdin.

## Worker-compatible named-choice provider

CLI and Worker adapters share one credential-bound auth/HTTP core. The
`jev-worker-esm` output is a self-contained completed ES module, not the CLI.
`bindJev({apiKey, fetch?})` is the only binder: a frozen capability with
non-secret `available` and `post`. Each target composition binds once; normal
operations carry no key. Availability is not real authentication success.
The old exported client per-call key interface remains a compatibility bridge;
the CLI normal path does not use it. Legacy calls retain their absence of a
new deadline; the batch adapter selects its existing ten-second deadline.
Known raw transport exception details are not reflected by either adapter.
The old CLI request/response shape and its strict probability validation remain
unchanged. It has no application slot/action constants and no apps source input.

`judgeNamedChoices({request, provider, signal?})` receives:

- `request.state`: an object supplied by the caller.
- `request.questions`: a nonempty map of neutral names to
  `{instruction: string, options: {key: string}}` descriptors (2–255 choices).
- The pre-bound capability and optional cancellation signal; no per-call key.

It performs one POST for the whole named batch, with one ten-second deadline
covering headers and body. The normalized result is
`{answers: {name: {choice, confidence, probabilities?}}}`: no wire `type`,
raw model, endpoint, header or credential is returned. Apps must independently
check its own exact slot/choice meaning and retain its existing low-confidence
no-change threshold; a confidence below 0.5 is not a provider contract error.
Top-level provider extras and any model string remain accepted; unknown answer
fields are refused. Probabilities remain optional/subset finite values,
including finite values outside [0,1], independently of the unchanged CLI.

Errors contain only a closed code: `auth_missing`, `input_invalid`,
`provider_unavailable`, `provider_http_error`, `provider_invalid_response`,
`provider_contract_error`, `provider_timeout`, or `cancelled`.
No retry occurs. Fixture tests are mechanical evidence, not live Jev success.

### Exact artifact handoff

`nix build .#jev-worker-esm` produces one deterministic ZIP containing only
`batch.mjs` (producer-bundled core and adapter) and a manifest
(`jev-provider/1`, `named-choices/2`, entry,
exports, empty import closure and the entry's byte length/SHA256).
Consumers verify locator/digest/contract/merged proof before import; refusal
must not fall back to source checkout, ambient resolution or a credential read.
Source input digests, the completed ESM digest, and a later app Worker digest
are distinct. Provenance records the core, batch adapter and assembly definition
as source inputs, never claims that bundled bytes equal source bytes. Old
`named-choices/1` assets are retained and are not silently accepted as /2.

The narrow `jev-provider-release.yml` verifies the actual ZIP entry, preserves
old CLI tests, and reuses unchanged reviewed-merge proof/selftest/workflow lint.
Only an explicit proposals publish dispatch can create
`jev-provider-<exact-merge-SHA>` with exactly four assets:

- `jev-provider.zip`
- `jev-provider.zip.sha256`
- `merged-pr-proof.json`
- `provenance.json`

Publication requires the current canonical push nix-check, latest nondismissed
exact-head Green review and equal reviewed/merged trees. Its write job performs
no Nix build and compares a re-download byte-for-byte; existing assets are never
overwritten. This is unsigned, shared-principal review/provenance evidence,
not a provider signature or host immutability guarantee. A PR build is not
formal supply. Old artifacts/real receipts do not transfer to a new identity.
