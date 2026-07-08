#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d .git ]]; then
  git init >/dev/null
fi

git checkout -B main >/dev/null
# Avoid committing transient binaries or local build outputs if present.
cat > .gitignore <<'GITIGNORE'
/bin/
/tmp/
.DS_Store
GITIGNORE

git add .
if git diff --cached --quiet; then
  echo "main already clean"
else
  git commit -m "baseline: current append-only contract proof as main" >/dev/null
  echo "main baseline commit created"
fi
