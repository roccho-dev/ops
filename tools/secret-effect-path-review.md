# Bounded secret-effect path admission (#436)

One CI intent inventory and one checker remain. PR #442's immutable Action pins and workflow-source repairs are preserved; PR #444 supersedes its regex-only checker and carries the remaining completion work. The #442 source history is retained as a merge parent, not merged to proposals.

The checker parses YAML with the existing Nix check's pinned `yq-go` dependency and walks `needs` from visible secret-bearing jobs. It inspects earlier Actions and upstream jobs, not only the step receiving a secret. Unknown source expressions, reusable/local Actions and matrix paths fail closed. A variable named source_sha is not proof of its contents or approval.

This is test-first migration work, not repository-wide PASS. The current legacy effect paths still require either justified retirement or migration to approved fixed executable closures. Do not remove a current consumer's only path solely to make a test Green, and do not weaken the checker to conceal the outstanding migration.

The bounded YAML checker is not a proof of arbitrary called scripts, recursive imports or physical Environment approval/protected-ref configuration. Those remain separate closure conditions. A hash of an entry file is not the dependency-closure identity.

Before merge: resolve the actual rejected paths, retain secret-free verification, bind the actual executable dependencies and target, test deliberate invalid paths, and run the full exact-candidate CI. Before Issue completion: also record the approved live-effect positive. The same voice-ui deployment may supply it; no obsolete Seq transport should be revived solely for a checkbox.
