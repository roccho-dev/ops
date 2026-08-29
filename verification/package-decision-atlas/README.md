# Package Decision Atlas — draft under ADRS #318

This draft preserves the proven human-view direction without claiming repository or provider completion.

```text
one package decision JSONL
  -> map.semantic.jsonl       -> existing Mobile Agent map/1
  -> relations.semantic.jsonl -> existing Mobile Agent graph/1
  -> history.semantic.jsonl   -> existing Mobile Agent seq/1
  -> three exact Mobile Agent HTML artifacts
  -> one vertical composite HTML
```

## Subject model

- Stable `package_id` is the identity.
- Responsibility and published artifacts belong to the package.
- Repository is a current `carrier` attribute, not the identity.
- UI output is a disposable, deterministic projection; it is never authority.

## Current status

| Boundary | Status |
|---|---|
| Sample decision JSONL -> three semantic projections | implemented in this draft |
| Three existing Mobile Agent HTML files -> one vertical HTML | implemented in this draft |
| Local real-Chromium sample proof | historical PASS receipt included |
| Production package-decision schema | OPEN; depends on governance #205 evolution |
| Mobile Agent exact-source binding in ordinary CI | OPEN |
| Authenticated protected JSONL | OPEN; ui #169 |
| gosh publication/current pointer/readback | OPEN; ops #327 |
| authority change / cutover | false |

## Commands

```sh
python3 verification/package-decision-atlas/project_package_decisions.py \
  --input verification/package-decision-atlas/fixtures/package-decisions.sample.jsonl \
  --out-dir /tmp/package-decision-atlas

# Build map/graph/seq HTML with the existing Mobile Agent builder, then:
python3 verification/package-decision-atlas/compose_mobile_agent.py \
  --source verification/package-decision-atlas/fixtures/package-decisions.sample.jsonl \
  --map-html /tmp/map.html \
  --relations-html /tmp/relations.html \
  --history-html /tmp/history.html \
  --output /tmp/index.html \
  --receipt /tmp/composite-receipt.json

python3 -m unittest discover -s verification/package-decision-atlas/tests -v
```

The generated HTML and screenshots are proof artifacts and are intentionally not committed as source or authority.
