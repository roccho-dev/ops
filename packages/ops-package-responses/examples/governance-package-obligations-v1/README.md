# Governance package-obligation golden example

This package-owned example copies the exact provider-neutral obligation bytes and
materialization receipt produced by the local Governance merge train.

The example closes three selected packages and represents every other current Ops
package explicitly as `out-of-scope`. It proves contract execution with a fake Nix
adapter in the package test and is re-run with the real Governance worktree in the
cross-repository lane. It does not replace real Nix, accepted ADRS authority, a
published release, final merge admission, or `organization-active` state.
