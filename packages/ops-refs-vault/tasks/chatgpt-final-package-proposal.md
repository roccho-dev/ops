# Future review task

Review only remaining hardening and live-integration backlog for `ops-refs-vault`.

Do not reopen these settled boundaries:

```text
repo-specific bare SSOT
  -> selected refs
  -> versioned filesystem-schema projection
  -> any Git remote forge artifact
  -> staging restore
  -> confirmed SSOT promotion
```

Current local proof consists of:

- `requirements/final-requirements.tsv`;
- Node unit and end-to-end tests;
- `ops-refs-vault smoke-local` proof IDs P01 through P15;
- the Nix check definition that runs those gates when Nix is available.

Future proposals must preserve these obligations or replace them with stricter, demonstrated gates.
