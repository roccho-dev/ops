# Jev iteration laboratory

Migrated from roccho-dev/envs#115.

Ownership is intentionally split:

- ops owns the Jev implementation, arbitrary iteration input, validation and retained discussion;
- envs owns only secret material and the authenticated live-run boundary.

The canonical mutable input is `iteration.json`.

This branch/PR is the long-lived iteration laboratory. Keep it open while experiments continue. Normal iteration changes only `iteration.json`; each commit is one candidate/evaluation step, and exact live Jev evidence remains externalized through the envs-owned authenticated runner.

Do not merge merely because one candidate becomes the current champion. Continue generating challengers, null options, and alternative economic-event connections until the experiment itself is intentionally closed.

The local/CI validation here never requires a Jev secret.

Live Jev execution must use the envs-owned authenticated runner; no `JEV_API_KEY` or decrypt capability belongs in ops.
