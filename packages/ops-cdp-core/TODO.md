# ops-cdp-core TODO

## Keep migration runtime semantics explicit

The `flakes:task/0-9-cdp-access-check` migration source had working Nix app
definitions for the CDP golden route. Moving those files into an `ops` worktree
must not silently change the runtime environment or command contract.

Current candidate state:

- `ops-cdp-core` exposes the golden route commands as package-backed Nix apps.
- `cdp-bridge` currently uses `cdp-bridge.py` as the Nix runtime backend.
- The migrated `cdp-bridge.zig` is kept as source evidence, but it does not
  build with the current nixpkgs Zig 0.16 package.

Open work before treating the bridge backend as fully settled:

- Decide whether the canonical bridge backend is Python or Zig.
- If Zig is preferred, either pin/use a compatible Zig package or update
  `cdp-bridge.zig` for the current Zig stdlib.
- Add a parity gate proving the chosen backend preserves the command contract:
  `version`, `wsurl`, `list`, `new`, `close`, `call`, and `filechooser`.
- Add at least one live or mocked CDP smoke proving `cdp-bridge.py` can perform
  a WebSocket `call` against a browser target, not just print help.
- Keep `flakes` as migration source / compatibility shim only. Do not restore
  a second canonical CDP runtime there.
