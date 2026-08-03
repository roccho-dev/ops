# dist-runner

One standard-library Python wrapper for already-committed `dist/<feat>` capabilities.

```text
feature name
  -> generated dist/index.jsonl
  -> exact GitHub.fetch_file plan
  -> ChatGPT performs the connector call
  -> blob/bytes/SHA verification
  -> Python, Node, or browser execution
  -> deterministic receipt
```

Each publishing package owns a closed `packages/<feat>/dist.json`. `dist/index.jsonl` is a generated projection and must not be edited by hand.

```text
python3 dist/dist-runner/dist-runner.pyz index --repo-root . --write
python3 dist/dist-runner/dist-runner.pyz audit --repo-root .
```

`audit` regenerates the index and requires byte equality with the committed index. It also rejects missing, extra, duplicate, unsafe, symlinked, or stale executable artifacts.

The GitHub connector and browser remain ChatGPT-owned external boundaries. The runner emits exact connector arguments, accepts the returned envelope, verifies it, and executes or completes the selected capability. Large requests are accepted on stdin to avoid host argument-length limits.

Only executors with real committed consumers are present:

- `python-zipapp` — `jsonl-inspect`;
- `node-esm` — `mjs-bundler` and `make-excalidraw-url`;
- `browser-esm` — `html-to-excalidraw`.

`dist-runner.pyz` is a bootstrap artifact and is intentionally absent from the generated index. No package installation, source checkout at use time, private CDP transport, or feature-specific runner is required.
