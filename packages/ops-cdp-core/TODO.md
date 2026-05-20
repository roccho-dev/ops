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

## Promote profile bootstrap lifecycle into ops-cdp-core

Current route gate status:

- `project-transport-*` wrappers now prove the requested Project URL, not just
  generic ChatGPT auth or a reachable CDP port.
- Compact evidence exists for an authenticated positive route and a fresh
  unauthenticated negative route:
  `packages/ops-cdp-core/evidence/profile-route-gate-20260520/`.

Remaining gap:

- The reusable profile bootstrap lifecycle is still migration knowledge in the
  deprecated `flakes/parts/chrome` tree.
- `ops-cdp-core` does not yet expose a canonical `seed profile -> login verify
  -> published snapshot -> runtime copy -> Project route proof` command set.

Do not call the deprecated `flakes` route a normal actor instruction. Use it as
migration evidence until `ops-cdp-core` owns the lifecycle.

Canonical target behavior:

- start a headful bootstrap lane with an explicit seed profile;
- verify CDP and VNC liveness;
- check `login-complete` without collecting credentials or OTP values;
- stop the bootstrap lane cleanly;
- publish the approved seed into the snapshot path;
- use a runtime copy of the snapshot for Project Source transport;
- prove the requested Project URL with `project-transport-env` or
  `project-transport-doctor` before upload/thread/readback.
