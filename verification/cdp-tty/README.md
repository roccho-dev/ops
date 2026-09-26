# cdp-tty integration proof

This is the non-runtime verification owner for the test-owned Chromium process,
synthetic cookie, general-CDP fixture controller, fault-injection proxy and PTY
protocol oracle. These capabilities must not enter the attach-only C library or
CLI. The C library caller remains `packages/cdp-tty/tests/probe.c`.

`packages/cdp-tty/default.nix` references this exact Python source as a Nix build
input and copies it into the temporary build tree only during `checkPhase`.
All existing assertions are unchanged. The source is hashed in the retained
proof output, and Python/websocket-client/Chromium are `nativeCheckInputs`, not
viewer runtime dependencies. No copy of this test harness is installed in the
runtime or development output. A missing harness fails the build; a failed or
skipped real-browser proof is not a successful package proof.

Run the package-owned `proof.nix` entrypoint for the same build and proof used by
CI. The standalone Python source is not a deployable package or user command.
The existing runtime purity checker and its package-declaration rules are not
weakened or given a cdp-tty path exemption.

The PTY oracle validates protocol bytes against a real Chrome and native viewer;
it does not prove a physical terminal renderer, Windows, SSH, a user account,
full IME, drag/modifier keys, or atomic interaction with another CDP controller.
Those residuals remain explicitly NOT_RUN in the emitted evidence.
