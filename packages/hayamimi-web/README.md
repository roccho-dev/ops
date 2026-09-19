# hayamimi-web

Portable browser-only Japanese speech recognition runtime assembled from pinned Hayamimi behavior, pinned sherpa-onnx WebAssembly source, and exact upstream GitHub Release asset identities.

Responsibility ends at `voice -> text`. The public boundary is `src/api/hayamimi.mjs`. This package does not own Jev decisions, application composition, or a product/UI renderer. `web/index.html` is only a blank browser integration harness used to prove the public API against the packaged runtime.

The default live path intentionally keeps Hayamimi's minimum Japanese route: 16 kHz mono PCM -> Silero VAD -> 1.0 s real-audio preroll -> ReazonSpeech Zipformer. Parakeet-ja remains packaged as an optional second opinion but is off by default, matching pinned Hayamimi behavior. ITN, punctuation restoration, replacement dictionaries, and offline/refine-only retry behavior are not part of this minimum browser release.

The repository contains build/test sources only. `dist/` is generated. The published ZIP contains no Python, Node, Dart, or Flutter runtime: only the browser harness, runtime JavaScript, WebAssembly, model data, manifest, and notices.

Flow: `sources.lock.jsonl -> fetch -> verify sources -> build WASM -> assemble -> verify dist -> ZIP/SHA256 -> unpack exact ZIP -> verify dist -> real Chromium ASR -> GitHub Release`.
