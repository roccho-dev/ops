# bare SSOT vault FSM

This is the operational state model for `ops-refs-vault`.

```text
local-working-clone
  -> ssot-update-requested
  -> ssot-bare-updated
  -> generated-manifest-recorded
  -> forge-backup-requested
  -> forge-backup-verified
  -> orphan-audit-verified
  -> restore-requested
  -> staging-bare-restored
  -> staging-bare-verified
  -> ssot-promotion-approved
  -> ssot-bare-promoted
```

Terminal success for backup is `forge-backup-verified`, not `pushed`.
For a full bare-root backup run, terminal success is
`orphan-audit-verified`: a generated manifest was recorded, every source ref
was verified in the forge backup, and no extra forge refs were present.
Terminal success for restore is `ssot-bare-promoted`, not `staging-bare-restored`.

Stop conditions:

| state | stop reason |
|---|---|
| `ssot-update-requested` | local working clone has uncommitted/unpushed state that the operator expects Git backup to protect |
| `ssot-bare-updated` | source bare branch is missing |
| `generated-manifest-recorded` | generated manifest was not preserved with the run receipt |
| `forge-backup-requested` | forge remote is missing, inaccessible, or has a diverged ref and no explicit force approval |
| `forge-backup-verified` | source bare hash and forge hash differ |
| `orphan-audit-verified` | forge backup has missing or extra `refs/heads/repos/*` refs relative to the generated snapshot |
| `restore-requested` | requested `refs/heads/repos/<repoId>/<branch>` is missing |
| `staging-bare-restored` | staging hash and forge hash differ |
| `ssot-promotion-approved` | approval is missing or target bare has conflicting refs |

The package never treats the single forge backup as SSOT. It only preserves
Git refs that were already committed and present in repo-specific bare SSOT
repositories.
