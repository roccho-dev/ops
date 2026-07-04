# ops-refs-vault runbook

`ops-refs-vault` copies selected refs from repo-specific bare SSOT repositories to one replaceable Git remote forge.

## Authority and route

```text
working clone
  -> normal Git push
  -> <bareRoot>/<repoPath>.git            data SSOT
  -> ops-refs-vault                       single writer for managed backup refs
  -> any Git remote forge                 generated backup artifact
```

The default source profile is `refs/heads/*`. The package does not claim to back up every Git ref, working-tree state, Git LFS payloads, issue data, secrets, hooks, or build caches.

| data | role |
|---|---|
| repo-specific bare under `bareRoot` | data SSOT |
| generated manifest | non-authoritative run snapshot |
| backup receipt | evidence only |
| local `refs.git` | local forge stand-in / generated backup |
| GitHub or another forge | replaceable remote backup artifact |

For the current hosted backup, `roccho-dev/refs` is this generated remote artifact. Do not create proposal branches, implementation branches, or hand-authored recovery edits in `roccho-dev/refs`; implementation proposals belong in `roccho-dev/ops`, then `ops-refs-vault` regenerates the backup artifact.

## Filesystem-schema identity

Repo identity comes from the bare path relative to `bareRoot` with the final `.git` removed.

```text
/home/nixos/repos/.bare/team/api.git
                         └─ repoPath = team/api
```

The path is encoded into one reversible Git ref component.

```text
repoPath  team/api
repoKey   =r1-team%2Fapi
branch    proposal/x
remoteRef refs/heads/=r1-team%2Fapi/proposal/x
```

The `=r1-` prefix versions the codec. It separates current refs from older unversioned layouts and prevents path/branch boundary collisions.

## Generate a manifest

```bash
export OPS_REFS_VAULT_REMOTE=git@github.com:OWNER/refs.git

ops-refs-vault generate-manifest \
  --bare-root /home/nixos/repos/.bare \
  --out /var/lib/ssot/refs-vault/runs/20260621/manifest.json
```

Discovery is recursive. An exclude file contains `repoPath` values, one per line. Unknown exclusions fail closed.

## Audit before writing

```bash
ops-refs-vault audit --manifest manifest.json
```

Audit scans the complete managed remote root `refs/heads/*`; the manifest does not restrict observation. It performs a full outer comparison between source-derived expected rows and remote-observed rows.

| classification | normal backup action |
|---|---|
| `equal` | no change |
| `missing-remote` | create remote backup ref |
| `source-ahead` | fast-forward remote backup ref |
| `remote-ahead-candidate` | stop; plan adoption, discard, or defer |
| `diverged-candidate` | stop; reconcile in isolated staging/worktree |
| `extra-current-schema` | stop; remote-only candidate |
| `extra-legacy-schema` | stop; migration decision required |
| `unknown-managed-extra` | stop; operator classification required |
| `observation-raced` / `unclassified` | stop and re-observe |

Audit is read-only. It never deletes or rewrites refs.

Candidate state is a reconciliation classification over an observed ref and OID, not a canonical backup success state. A ref is canonical backup only after audit classifies it `equal`; `remote-ahead-candidate`, `diverged-candidate`, `extra-current-schema`, `extra-legacy-schema`, and `unknown-managed-extra` remain candidate/operator-decision states until an explicit adopt, discard, defer, or migration decision completes under exact leases.

## Normal backup

```bash
ops-refs-vault backup-all \
  --manifest manifest.json \
  --receipt-out backup-receipt.json
```

Each selected ref is pushed after a full managed-root preflight. Cross-repository atomicity is not claimed.

`--force` is rejected. `git push --mirror` is not used because it force-updates all refs and deletes remote-only refs.

## Checked SSOT mirror publish

For governed publish paths, use `checked-publish-one` instead of raw `backup-one`.

`checked-publish-one` is the provider path for governance #115 when the selected provider is:

```text
bare repo SSOT + checked mirror publish gate
```

It reads the actual source bare `refs/heads/<branch>` target SHA, verifies a final gate receipt for that exact SHA, and refuses to publish unless all of these are true:

- gate name is `gov-final-scope-purpose-join / gate`;
- gate status is `pass`;
- gate target SHA equals the actual source bare target SHA;
- gate output digest is present, and equals `--expected-output-digest` when supplied;
- an allow or reject audit receipt is emitted.

For current SSOT mirror publish evidence, target `main`:

```bash
ops-refs-vault checked-publish-one \
  --manifest manifest.json \
  --repo-id governance \
  --branch main \
  --gate-receipt /var/lib/ssot/final-gate/runs/<run>/receipt.json \
  --expected-output-digest sha256:<digest> \
  --receipt-out /var/lib/ssot/refs-vault/runs/<run>/governance-main-publish-receipt.json
```

`checked-backup-one` is kept as a compatibility alias, but #115 evidence should call this path a checked publish gate.

The wrapper and its selftests do not close governance #115 by themselves. #115 still requires real `refs/heads/main` mirror publish reject/accept/audit/rollback receipts from the active route.

## Remote candidate flow

Candidate planning may observe any Git source URL. Candidate adoption and discard must run on the SSOT host with a local source bare because source compare-and-swap uses `git update-ref` and local object staging.

Read the exact observed state:

```bash
ops-refs-vault candidate-plan \
  --manifest manifest.json \
  --repo-id team/api \
  --branch main
```

### Adopt a remote-ahead candidate

```bash
ops-refs-vault candidate-adopt \
  --manifest manifest.json \
  --repo-id team/api \
  --branch main \
  --expected-source-oid <observed-source-oid-or-absent> \
  --expected-remote-oid <observed-remote-oid> \
  --staging-bare /tmp/refs-vault-candidate/team-api.git \
  --confirm
```

Adoption:

1. rechecks both observed OIDs;
2. restores the remote candidate into an empty staging bare;
3. checks requested OID, `HEAD`, `git fsck --full`, and normal clone usability;
4. transfers the candidate object to the source bare;
5. updates the source branch with `git update-ref <new> <expected-old>` compare-and-swap.

A diverged candidate cannot be adopted directly.

### Discard a remote-ahead candidate

```bash
ops-refs-vault candidate-discard \
  --manifest manifest.json \
  --repo-id team/api \
  --branch main \
  --expected-source-oid <observed-source-oid-or-absent> \
  --expected-remote-oid <observed-remote-oid> \
  --confirm
```

Discard pushes the immutable observed source OID and uses `--force-with-lease=<remoteRef>:<observedRemoteOid>`. A changed remote candidate is not overwritten. The source ref is checked before and after the operation.

## Restore

```bash
ops-refs-vault restore-bare-one \
  --manifest manifest.json \
  --repo-id team/api \
  --branch main \
  --staging-bare /tmp/restored/team-api.git
```

Restore never writes directly to SSOT. It must pass:

- exact remote/restored OID equality;
- `HEAD` target equality;
- `git fsck --full`;
- a normal clone whose `HEAD` matches the restored OID.

Promotion remains separate:

```bash
ops-refs-vault promote-staging-bare \
  --repo-id team/api \
  --staging-bare /tmp/restored/team-api.git \
  --target-bare /home/nixos/repos/.bare/team/api.git \
  --confirm
```

Promotion checks the staging repo, atomically pushes all staging heads to the target bare, sets target `HEAD`, and checks the target with `fsck`.

## Optional future sources

The core remains Git-transport-only.

| future data | extension path |
|---|---|
| tags or custom refs | add a new explicit ref profile/projector; keep heads default |
| wiki | expose the wiki as another bare repository and use the same pipeline |
| issues/discussions | external producer exports data into a dedicated bare repository; this package transports its refs |
| LFS payloads | separate payload adapter, not a hidden core responsibility |

No GitHub API client belongs in `ops-refs-vault` core.

## Local proof

```bash
node --test \
  packages/ops-refs-vault/tests/test_ref_projection.mjs \
  packages/ops-refs-vault/tests/test_ref_reconcile.mjs \
  packages/ops-refs-vault/tests/e2e.mjs

ops-refs-vault smoke-local
```

The local bare remote is the transport-equivalent stand-in for a Git remote forge. Live forge mutation is a separate integration gate.
