# hayamimi-web

Portable browser-only Japanese speech recognition release assembled from pinned Hayamimi behavior, pinned sherpa-onnx WebAssembly source, and exact upstream model URLs.

The repository contains build/test sources only. `dist/` is generated. The published ZIP contains no Python, Node, Dart, or Flutter runtime: only HTML/CSS/JS, WebAssembly, and model data.

Flow: `sources.lock.jsonl -> fetch -> verify sources -> build WASM -> assemble -> verify dist -> real Chromium ASR -> mobile UI -> ZIP/SHA256 -> GitHub Release`.
