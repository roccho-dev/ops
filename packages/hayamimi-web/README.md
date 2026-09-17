# hayamimi-web

Portable browser-only Japanese speech recognition release assembled from pinned Hayamimi behavior, pinned sherpa-onnx WebAssembly source, and exact upstream GitHub Release asset identities.

The default live path intentionally keeps Hayamimi's minimum Japanese route: 16 kHz mono PCM -> Silero VAD -> 1.0 s real-audio preroll -> ReazonSpeech Zipformer. Parakeet-ja remains packaged as an optional second opinion but is off by default, matching pinned Hayamimi behavior. ITN, punctuation restoration, replacement dictionaries, and offline/refine-only retry behavior are not part of this minimum browser release.

The repository contains build/test sources only. `dist/` is generated. The published ZIP contains no Python, Node, Dart, or Flutter runtime: only HTML/CSS/JS, WebAssembly, and model data.

Flow: `sources.lock.jsonl -> fetch -> verify sources -> build WASM -> assemble -> verify dist -> real Chromium ASR -> mobile UI -> ZIP/SHA256 -> GitHub Release`.
