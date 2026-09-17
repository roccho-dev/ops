# WSLC storage reclaim

Recover physical Windows disk space without deleting persistent development state or mistaking logical free space inside Linux for host free space.

## Operating boundary

- Start read-only. Measure C: free bytes, the current WSLC `storage.vhdx` path and physical length, session/container state, named volumes, and large paths inside the storage filesystem.
- Do not infer safety from age, naming, `Mounts: []`, or a stopped container alone.
- Preserve repositories, registered worktrees, named volumes, `dev-home`, credentials/config, state, saved plans, receipts, proof/evidence, and current runtime data unless the user explicitly puts an exact target in scope.
- Never run broad prune, Nix GC, zero-fill, filesystem repair, VHD conversion/recreation, or `Optimize-VHD` under this runbook.
- Existing authorization is target- and attempt-specific. Reconfirm before a new deletion set, session shutdown, or elevated compact attempt.

## Per-attempt inputs have no defaults

Historical proof is evidence only. Never copy a device, mountpoint, VHDX path, container set, size, or timestamp from this runbook or its proof into a new operation.

Before rendering any state-changing command, discover and record the current values for `CURRENT_VHDX`, `PROVEN_BACKING_DEVICE`, `PROVEN_TRIM_MOUNT`, and `ENTRY_RUNNING_CONTAINERS`. Each value must come from the current host and current WSLC session. An unresolved, stale, or ambiguous value is a stop condition.

Angle-bracket tokens are deliberately non-executable placeholders. Do not run a command while any token remains. Fixed tool paths in this document identify tools, not operation targets, and still require the stated verification.

## Cleanup workflow

1. Distinguish Windows files, the WSLC VHDX physical size, live filesystem use, and reclaimable deleted blocks.
2. Inventory candidates with `path`, measured size, evidence, classification, and expected recovery.
3. Mark a target deletion-ready only when all are evidenced:
   - it resolves below the intended inspected root;
   - it is not a mountpoint, named-volume root, repository, or registered worktree;
   - no running process references it;
   - it is reproducible cache/test output, or the user independently confirmed it is disposable;
   - required state, plan, receipt, lock, and proof files have been separated and preserved.
4. Present the exact literal deletion set. Before every recursive deletion, revalidate the resolved targets and ask the user to confirm that exact operation. Do not use globs, unresolved variables, or a broad parent directory.
5. Measure immediately after deletion. Logical free space inside ext4 is not yet equivalent to physical free space on C:.

Use these classifications:

- `削除可能断定`: every deletion-ready condition is evidenced for the exact path.
- `要再評価`: provenance, active reference, persistence, or reproducibility is not proven.
- `保全`: source, state, plan, receipt, proof, credential/config, named volume, or active work.

Old Terraform/OpenTofu providers and old test fixtures can be candidates, but names and age are not proof. Separate preserved state, plan, receipt, and proof from surrounding duplicate providers first.

## Proven WSLC VHDX compaction

Discover every target identity from the current host and session. Do not obtain operation inputs from historical proof.

### Baseline

Record C: free bytes, VHDX physical bytes, every running WSLC container and process tree, named volumes, relevant repo HEAD/status, container mountinfo, and the session-host mount/device/filesystem/discard identity.

Require one unambiguous relation from the current VHDX to an ext4 backing device with discard support and its current trim mountpoint. Active builds, tests, editors, provider operations, or unexplained writes are blockers.

### Exact order

1. Capture the entry-running container set. Gracefully stop only those containers; never remove or recreate them.
2. Confirm writer-zero and flush with `sync`.
3. Verify `/usr/sbin/fstrim` is the expected regular ELF. Invoke it once on the proven mountpoint through a PTY and `/bin/sh -lc`, capturing discard counters before and after. The proven shape is:

   ```text
   wslc system session run /bin/sh -lc 'sync; echo BEFORE; cat /sys/class/block/<PROVEN_BACKING_DEVICE>/stat; /usr/sbin/fstrim -v <PROVEN_TRIM_MOUNT>; rc=$?; echo FSTRIM_RC=$rc; echo AFTER; cat /sys/class/block/<PROVEN_BACKING_DEVICE>/stat; exit $rc'
   ```

   With Codex host execution, set `tty: true`. A direct non-PTY call produced `ERROR_INVALID_HANDLE` with unchanged discard counters on 2026-09-17. Do not mistake it for successful trim or automatically repeat a genuinely executed or ambiguous trim.
4. Terminate the WSLC session with `wslc system session terminate`.
5. Before compacting, require related processes absent, `Get-DiskImage` reporting `Attached=False`, and an exact VHDX read/write open with `FileShare.None` succeeding.
6. Create a temporary DiskPart command file containing exactly:

   ```text
   select vdisk file="<CURRENT_VHDX>"
   compact vdisk
   exit
   ```

   Do not add `attach vdisk readonly`, `detach vdisk`, or `Optimize-VHD`.
7. Run `%SystemRoot%\System32\diskpart.exe /s <command-file>` through a tiny PowerShell wrapper and capture its full log. Elevate only that wrapper with `Start-Process -Verb RunAs -WindowStyle Hidden -Wait -PassThru`.
8. Exit code zero is insufficient. Require the official DiskPart success text, no remaining DiskPart process, coherent VHDX/C: measurements, `Attached=False`, and a fresh exclusive-open pass. Japanese success evidence is:

   ```text
   DiskPart により、仮想ディスク ファイルは正常に圧縮されました。
   ```
9. Restart exactly the entry-running containers. Verify runtime access, volumes, repo state, config paths, and preserved evidence.
10. Remove only the exact validated temporary command, wrapper, and log files.

### Failure handling

- UAC cancellation, attached VHDX, failed exclusive open, missing official success text, active-work ambiguity, or identity mismatch: stop without automatic retry.
- If trim output is ambiguous but discard counters prove it occurred, do not run it again.
- If invocation fails before trim is established and counters are unchanged, restore the original container state, diagnose the invocation surface, and obtain or confirm authority for a fresh attempt.
- Restore the exact entry-running set when safe after any failed gate.

### Historical evidence

Observed identities and outcomes live only in [the bounded proof](../proof/wslc-storage-reclaim-20260917.json). They demonstrate that the procedure worked for that attempt; they are never defaults or execution inputs for another attempt.

Trim output and physical recovery need not match one-for-one because compaction returns already-discarded sparse extents to Windows.
