# Mobile Agent business-model presentation — fixed UI + JSONL

The accepted two-actor business-presentation layout is the immutable base. Three- and four-actor variants only add alternating actor/exchange columns inside the existing scene.

```text
JSONL -> business-model compiler -> A2UI Slides + Actor Seq -> one HTML
```

## Examples are the E2E fixtures

There is no duplicate fixture data. The exact same JSONL files serve as documentation examples and browser-test inputs.

| Input | Meaning | Expected HTML SHA-256 |
|---|---|---|
| `examples/2-actors.jsonl` | Original two-actor baseline | `fcee971464e3ee465e25c180f0bd1c0ac39d0936b81583649de48303929c7307` |
| `examples/3-actors.jsonl` | Existing layout + one actor | `ed3a5dbdd60ea0cb9b3a8026e2586782772a747f82b59cd7c827d926af5a1306` |
| `examples/4-actors.jsonl` | Existing layout + two actors | `faf0d73a8fe3eb743ca6877d784ccbb8c9a6dac03eba94989b52447aa41f8443` |

`tests/e2e/fixtures.json` binds each example to one fixed UI profile and its exact expected HTML. The JSONL remains the only example-specific semantic input; profiles live under `profiles/` as fixed UI policy. Both the builder and E2E test consume the same manifest.

## Run

```text
npm run build           # original 2-actor HTML -> dist/index.html
npm run build:examples  # 2/3/4 actor HTML -> dist/layout-samples/
npm run check           # original byte-exact regression
npm run test:e2e        # real Chromium interaction + layout preservation
npm test                # all of the above
```

The E2E test verifies:

- exact HTML SHA for all three examples;
- all timeline stages are operable;
- Actor Seq opens and closes;
- actor/exchange columns remain `actor | exchange | actor | ...`;
- header and timeline rectangles remain identical across 2/3/4 actors;
- the page itself does not gain horizontal overflow;
- no browser page error occurs.

Python Playwright and Chromium are required only for `npm run test:e2e`. `CHROMIUM_PATH` may override the detected browser executable.

## Repository boundary

This directory is a self-contained source candidate for the Mobile Agent App. It does not modify the accepted `graph/1`, `map/1`, or `seq/1` maxGraph runtime. A later admission step may move these source paths into the dedicated Mobile Agent source repository and bind the resulting exact commit/tree into the Ops Carrier manifest.

The variable semantic inputs are only `examples/*.jsonl`. Theme, renderer, profiles, and validation remain fixed UI policy.
