# Excalidraw browser tools

Two independently reusable capabilities built with the committed Rollup distribution from `dist/mjs-bundler/bundle.mjs`.

```text
packages/excalidraw/src/html-to-excalidraw/**
  -> dist/excalidraw/html-to-excalidraw.mjs

packages/excalidraw/src/make-excalidraw-url/**
  -> dist/excalidraw/make-excalidraw-url.mjs
```

Each output is one self-contained ESM file with `manifest` and `run`, no external imports, no dynamic chunks, and no runtime code fetch.

```text
node packages/excalidraw/build.mjs
node packages/excalidraw/build.mjs --check
node --test packages/excalidraw/tests/*.test.mjs
```

Browser execution proof is performed at the consumer boundary; no Python or private browser transport is committed in this package.
