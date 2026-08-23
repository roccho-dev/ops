# Mobile Agent business-model presentation — fixed UI + JSONL

The accepted two-actor business-presentation layout is the immutable base. Three- and four-actor variants only add alternating actor/exchange columns inside the existing scene.

```text
semantic JSONL
→ business-model/1 compiler
→ fixed A2UI Slides + Actor Seq
→ one HTML or #presentation URL
```

## Examples are the E2E fixtures

There is no duplicate fixture data. The exact same JSONL files serve as documentation examples and browser-test inputs.

| Input | Meaning | Expected HTML SHA-256 |
|---|---|---|
| `examples/2-actors.jsonl` | Original two-actor baseline | `fcee971464e3ee465e25c180f0bd1c0ac39d0936b81583649de48303929c7307` |
| `examples/3-actors.jsonl` | Existing layout + one actor | `ed3a5dbdd60ea0cb9b3a8026e2586782772a747f82b59cd7c827d926af5a1306` |
| `examples/4-actors.jsonl` | Existing layout + two actors | `faf0d73a8fe3eb743ca6877d784ccbb8c9a6dac03eba94989b52447aa41f8443` |

`tests/e2e/fixtures.json` binds each example to one fixed UI profile and its exact expected HTML. The JSONL remains the only example-specific semantic input; profiles, theme, renderer, and validation remain fixed UI policy.

## Run

```text
npm run build           # original 2-actor HTML -> dist/index.html
npm run build:examples  # 2/3/4 actor HTML -> dist/layout-samples/
npm run build:public    # business-model/1 host HTML -> dist/public/index.html
npm run generate:url -- <semantic.jsonl> [baseUrl] [receipt.json]
npm test                # byte regression + browser E2E + URL roundtrip
```

The E2E tests verify:

- exact HTML SHA for all three examples;
- all timeline stages are operable;
- Actor Seq opens and closes;
- actor/exchange columns remain `actor | exchange | actor | ...`;
- header and timeline rectangles remain identical across 2/3/4 actors;
- page overflow and browser errors remain zero;
- each generated URL decodes and renders in real Chromium;
- URL length stays within 8,192 characters.

## Public Mobile Agent projection

The public App revision is assembled without rebuilding the accepted Mobile Agent App.

```text
accepted immutable one-HTML Carrier
→ exact /app/index.html
+ generated /business-model/index.html
→ content-addressed Release
→ explicit Cloudflare Pages deployment
```

The accepted App HTML is fixed at:

```text
SHA-256 3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6
bytes   2412388
```

The combined browser proof re-runs `graph/1`, `map/1`, and `seq/1`, then renders the 2-, 3-, and 4-actor `business-model/1` URLs.

The old 54-file bootstrap workflow is retired. Its historical Release is absent and its mutable public bootstrap no longer matches the fixed file manifest. The exact accepted one-HTML Carrier is now the only base used by this publication path.

## Repository boundary

This directory remains a self-contained source candidate until a dedicated Mobile Agent source repository exists. It does not rewrite the accepted maxGraph App, add a backend, add a database, or introduce a second URL codec.
