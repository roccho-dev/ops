# billing-channel-config example adapters

This directory is deliberately `example/poc/example`.

It demonstrates how runtime or provider packages can glue the `billing_channel_config`
core/port library to Stripe, PAY.JP, bank transfer, or manual invoice flows.

Rules:

- examples may import `billing_channel_config` from `src/`;
- `src/` must not import anything from this directory;
- these adapters are dry-run examples only and never call provider APIs;
- provider secrets, webhook handling, invoice state, retries, and network I/O belong in future runtime adapter packages.
