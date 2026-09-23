# Jev iteration laboratory

Migrated from roccho-dev/envs#115.

Ownership is intentionally split:

- ops owns the Jev implementation, arbitrary iteration input, validation and retained discussion;
- envs owns only secret material and the authenticated live-run boundary.

The canonical mutable input is `iteration.json`. Edit it on this PR/branch to create the next semantic-evaluation candidate. The local/CI validation here never requires a Jev secret.

Live Jev execution must use the envs-owned authenticated runner; no `JEV_API_KEY` or decrypt capability belongs in ops.
