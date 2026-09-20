# ops-portable-runtime-pack

`ops-portable-runtime-pack` creates and validates compact Linux runtime payloads from explicit executable/file inputs. It remains separate from `ops-src-runtime-pack`, which carries editable source and Nix metadata.

The generic V1 packer currently creates `x86_64-linux` payloads. `ops#374` extends this existing owner—without a second packager—to produce the final semantic-log `amd64` and `arm64` release assets.

## Generic pack

```text
ops-portable-runtime-pack create
  --target-system x86_64-linux
  --tool-spec tool.json
  --out-dir /tmp/portable-runtime

ops-portable-runtime-pack validate
  --pack-dir /tmp/portable-runtime
```

Tool specs are explicit. The packer does not guess plugin paths or claim runtime completeness without evidence.

## Semantic-log verified-dist handoff

The producer-owned contract for `envctl` is:

```text
schemas/semantic-log-verified-dist-v1.schema.json
kind = ops.semantic-log.verified-dist.v1
```

The complete non-operational shape fixture is:

```text
examples/semantic-log-verified-dist-v1.json
```

It binds one release/source/workflow identity; exact `amd64` and `arm64` asset IDs, URLs, hashes and sizes; Caddy/cloudflared versions and hashes; complete payload file inventories; Caddy module/config identity; request/result schemas; persistent JSONL layout and rollback compatibility; credential capabilities without values; and packaged-dist proof receipts.

The example proves the contract shape only. It is not a published asset, Release, attestation, deployment authorization, or production claim. The final generated manifest must replace every fixture identity with read-back release facts and may be consumed by ENVS only after its proof flags are backed by exact packaged-dist observations.
