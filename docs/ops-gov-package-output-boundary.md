# ops gov-package-output boundary

This repo emits non-authority ops evidence for governance joins.

## Boundary

- ADRS owns accepted meaning.
- governance owns final joins and admission.
- ops only emits evidence, residuals, findings, and selected-warning admission rows.
- `ops-gov-package-output` must not claim `organization-active`.

## Merge evidence

- `ops-gov-package-output emit` writes the `govPackageOutput.v1` packet surface.
- `ops-gov-package-output validate` rejects missing packet files, authority overclaim, and missing receipt digest linkage.
- `ops-gov-package-output selftest` proves the negative missing-receipts fixture.
