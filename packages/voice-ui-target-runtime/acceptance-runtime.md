# Approved acceptance runtime

The request now requires `adapters.acceptance: {path, sha256}` in addition to deploy/readback. This is an already-provisioned executable command that accepts the artifact's runtime script as its first argument. It is admitted before deploy and used for both independent invocations; there is no bare-Node fallback.

The intended producer is apps#29's `voice-ui-acceptance-runtime` Nix output. The approved request must name the executable from that exact provisioned store closure and its digest. Its hash identifies the launcher only: approval/provisioning must bind the complete Nix closure as well. Do not claim that hashing an arbitrary shell script proves its dependencies, and do not fill missing dependencies by npm install at runtime.

Each invocation receives the existing non-secret environment allowlist and a fresh HOME/TMPDIR/workspace. The launcher sets its own fixed Playwright/Chromium paths. The aggregate receipt records the launcher digest.

Tests prove missing/altered/relative launchers are rejected before any effect and that the selected executable—not the orchestrator's process.execPath—starts both acceptance runs. The test launcher and app are explicitly offline fixtures. Actual apps runtime consumption, approved real deploy/readback adapter closures, full #436 isolation and live results remain required; this hook alone does not complete #435.
