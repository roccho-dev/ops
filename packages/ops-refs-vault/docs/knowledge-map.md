# ops-refs-vault knowledge map

`ops-refs-vault` owns selected-ref backup from repo-specific bare SSOT repositories to any Git remote forge.

| knowledge | implemented location |
|---|---|
| recursive bare discovery | `discoverBareRepos` |
| filesystem-schema `repoPath` | `lib/ref-projection.mjs` |
| reversible versioned `repoKey` | `encodeRepoPath` / `decodeRepoKey` |
| heads-first projection | `projectHeadRef` |
| current, legacy, unknown parsing | `parseManagedRemoteRef` |
| managed-root full scan | `observedRows` |
| full outer reconciliation | `lib/ref-reconcile.mjs` |
| source/remote/diverged classification | `classifyRelation` |
| preflight and repo-atomic backup | `assertBackupPreflight` / `pushRepoAtomically` |
| candidate staging and source CAS | `candidate-adopt` |
| exact remote lease discard | `candidate-discard` |
| HEAD/fsck/clone restore proof | `verifyBareIntegrity` |
| separate confirmed promotion | `promote-staging-bare` |
| fine-grained acceptance contract | `requirements/final-requirements.tsv` |

## Boundaries

| topic | owner |
|---|---|
| GitHub API issue/discussion export | external producer, optionally outputting a bare repo |
| wiki | separate wiki bare passed through the same Git transport pipeline |
| Git LFS payloads | separate payload adapter |
| dirty/untracked working-tree shelter | separate filesystem or bundle workflow |
| forge routing and credentials | environment/operator transport configuration |

The remote forge and generated manifest are never authority.
