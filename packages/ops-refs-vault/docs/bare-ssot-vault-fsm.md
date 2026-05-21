# bare SSOT vault FSM

This is the operational state model for `ops-refs-vault`.

```text
local-working-clone
  -> ssot-update-requested
  -> ssot-bare-updated
  -> forge-backup-requested
  -> forge-backup-verified
  -> restore-requested
  -> staging-bare-restored
  -> staging-bare-verified
  -> ssot-promotion-approved
  -> ssot-bare-promoted
```

Terminal success for backup is `forge-backup-verified`, not `pushed`.
Terminal success for restore is `ssot-bare-promoted`, not `staging-bare-restored`.

Stop conditions:

| state | stop reason |
|---|---|
| `ssot-update-requested` | local working clone has uncommitted/unpushed state that the operator expects Git backup to protect |
| `ssot-bare-updated` | source bare branch is missing |
| `forge-backup-requested` | forge remote is missing, inaccessible, or has a diverged ref and no explicit force approval |
| `forge-backup-verified` | source bare hash and forge hash differ |
| `restore-requested` | requested `refs/heads/repos/<repoId>/<branch>` is missing |
| `staging-bare-restored` | staging hash and forge hash differ |
| `ssot-promotion-approved` | approval is missing or target bare has conflicting refs |

The package never treats the single forge backup as SSOT. It only preserves
Git refs that were already committed and present in repo-specific bare SSOT
repositories.
