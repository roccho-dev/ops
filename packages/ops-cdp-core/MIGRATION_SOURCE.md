# ops-cdp-core migration source

`ops-cdp-core` is the canonical CDP runtime package.

The implementation in this branch was migrated from:

- repo: `flakes`
- branch: `task/0-9-cdp-access-check`
- head: `e468c5ffbbdefe8d650fe18e91752184da52e8fd`
- source path: `parts/cdp`

The migrated F branch used `cdp-bridge.zig`. The ops candidate keeps that file
as source evidence, but the Nix runtime uses `cdp-bridge.py` from the existing
ops CDP worktree because the F branch Zig bridge does not build with the current
nixpkgs Zig 0.16 package.

This Python bridge choice is not a final architecture decision. See `TODO.md`
for the required backend parity work before treating Python or Zig as fully
settled.

Do not make `flakes` a second canonical CDP implementation. If `flakes` is
merged later, keep it to a deprecation marker, migration archive, or thin
compatibility wrapper that points users to `ops-cdp-core`.
