# cdp-tty

`cdp-tty` is the human-facing projection adapter for an already-running Chrome target.

Authority and design source: roccho-dev/adrs#423.

## Purpose

The package will attach to an explicitly selected existing Chrome CDP target and bridge only:

- page pixels / geometry -> terminal image output;
- terminal mouse / key / committed text -> CDP input;
- connection-local identity, frame generation, geometry mapping, reconnect and cleanup.

Chrome remains the authority for browser lifecycle, profile, cookies, login, tabs and viewport.

## Boundary

Owned here:

- explicit attach to an existing CDP endpoint / target;
- frame acquisition;
- terminal image projection;
- mouse / key / committed-text input;
- DPR / scale / letterbox coordinate mapping;
- stale-frame and reconnect safety;
- restoration of terminal state owned by this process.

Forbidden here:

- Chrome discovery, install, launch, kill or restart;
- profile, cookie, password, sync or auth ownership;
- target creation or closure;
- viewport / UA / emulation mutation;
- navigation policy;
- agent coordination;
- SSH implementation;
- browser engine, GUI toolkit, remote desktop or mux ownership.

The initial implementation is intentionally a small native core plus a thin CLI. A separately versioned public library ABI is not required until there is a concrete second caller.

## Repository boundary

- `adrs`: accepted meaning and constraints.
- `ops/packages/cdp-tty`: implementation source and proof.
- `ops/packages/ops-cdp-core`: browser automation runtime; may be a reference source but is not a dependency requirement.
- `envs`: exact package binding / OCI placement after this package is proven.
- `gosh`: optional consumer only.
- `hq`: not an execution owner.

## Required proof before Ready

The PR is not Ready until the implementation proves, at minimum:

1. existing-target attach without creating or closing a target;
2. frame display over a real supported terminal path;
3. DPR / scaling / letterbox coordinate correctness;
4. mouse, key and UTF-8 committed-text input;
5. stale-frame / navigation / reconnect input suppression;
6. viewer exit and SSH loss do not terminate Chrome or mutate profile/auth state;
7. concurrent independent CDP connection with agent / DevTools does not require shared session ownership;
8. bounded frame / input queues under slow transport;
9. terminal state restoration;
10. explicit rejection or absence of forbidden browser-state mutation methods;
11. Linux/OCI integration proof;
12. final Windows terminal -> SSH -> OCI -> authenticated existing Chrome E2E.

The final Windows-to-SSH E2E may require the follow-up `envs` binding PR. This implementation PR must retain that residual explicitly rather than claiming #423 complete early.
