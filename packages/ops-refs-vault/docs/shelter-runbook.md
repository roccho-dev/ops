# shelter boundary

The canonical `ops-refs-vault` route is not a dirty worktree shelter.

It protects only Git refs that already exist in repo-specific bare SSOT
repositories. If an operator needs to preserve dirty files, untracked files,
ignored files, secrets, build caches, or a content snapshot that is not a Git
ref, use a separate shelter or bundle workflow before running this package.

Canonical refs-vault route:

```text
repo-specific bare SSOT -> single forge backup -> staging bare -> SSOT promotion
```

Non-canonical shelter topics should be opened as separate issues and must not
be silently folded into this package.
