# jsonl-inspect

A small, multi-module, standard-library-only Python capability distributed as one committed `.pyz` for immediate use from the ChatGPT execution environment.

```text
packages/jsonl-inspect/src/**
  -> python3 -m zipapp
  -> dist/jsonl-inspect/jsonl-inspect.pyz
```

The build wrapper performs orchestration only: it copies source to a temporary directory, normalizes modes and timestamps, then invokes Python's standard `zipapp`. It contains no archive or module-bundling implementation.

Commands:

```text
python3 dist/jsonl-inspect/jsonl-inspect.pyz manifest
python3 dist/jsonl-inspect/jsonl-inspect.pyz selftest
printf '%s' '<JSON request>' | python3 dist/jsonl-inspect/jsonl-inspect.pyz run
```

`run` accepts:

```json
{"action":"inspect-jsonl","text":"{\"id\":\"a\"}\n","idKey":"id"}
```

Build and local proof:

```text
packages/jsonl-inspect/build.sh
python3 -m unittest discover -s packages/jsonl-inspect/tests -v
```

`dist` is generated, committed with source, and never authoritative.
