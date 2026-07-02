# v-o-refresh single policy-entry test, 2026-06-20

## Setup

Agent: `v-o-refresh-find-packages-gen2-single-policy-260620`

Input: only the current `bootstrap.git#policy-entry` output at bootstrap main `4aad224a684cc72e76f286a446a70fe0e1d0f532`.

Task: determine whether a refreshed agent can discover and use `find-packages` as a skill/package from that single policy entry alone.

## Result

Blocked, correctly.

The refreshed agent refused to guess the owning repo from examples. The policy entry provides a host-resolution and flake-consumption pattern, and names `adrs.git` for raw decision intake, but it does not map `find-packages` to an owning SSOT repo or to a package-discovery route.

## Readback

Required missing route:

- capability: `find-packages`
- owning repo: not discoverable from the current single policy entry
- compliant next step after route exists: `git ls-remote ssh://100.124.250.91/home/nixos/repos/.bare/<repo>.git`, then `nix run git+ssh://100.124.250.91/home/nixos/repos/.bare/<repo>.git?ref=<ref>#find-packages`

This evidence proves the package surface builds and exists in this proposal, but current single policy-entry routing is not sufficient for cold discovery.
