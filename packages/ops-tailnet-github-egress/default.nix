builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-tailnet-github-egress",
  "repoId": "ops",
  "mission": "Run GitHub operations through a tag:github tailnet egress path while keeping local gh and local GitHub API usage forbidden, with git push-tailnet as the human Git entrypoint.",
  "primaryTarget": "packages/ops-tailnet-github-egress",
  "requiredOutputs": "packages.<system>.ops-tailnet-github-egress and packages.<system>.git-push-tailnet",
  "requiredChecks": "ops-tailnet-github-egress.offline-contract, git-push-tailnet offline tests, plus static all-IPv4 snippet guards",
  "responsibility": "Expose policy, live reachability checks, remote GitHub SSH checks, all-IPv4 route-gated local GitHub push, long-transfer App Connector push, single-remote ref restore, remote exec, existing-repo push delegation through the egress path, and the git push-tailnet wrapper.",
  "humanEntrypoint": "git push-tailnet",
  "forbiddenResponsibility": "Does not run gh auth login, does not run gh api on the local terminal, does not create GitHub repos, does not allow local GitHub push unless every resolved github.com IPv4 route is verified through the App Connector, and does not store secrets.",
  "docs": [
    "packages/ops-tailnet-github-egress/docs/app-connector-local-push.md",
    "packages/ops-tailnet-github-egress/docs/git-push-tailnet.md",
    "packages/ops-tailnet-github-egress/docs/troubleshooting.md"
  ],
  "snippets": [
    "packages/ops-tailnet-github-egress/snippets/github-app-connector-git-env.sh",
    "packages/ops-tailnet-github-egress/snippets/github-route-check.sh",
    "packages/ops-tailnet-github-egress/snippets/github-ls-remote-app-connector.sh",
    "packages/ops-tailnet-github-egress/snippets/github-push-local-app-connector.sh",
    "packages/ops-tailnet-github-egress/snippets/github-push-local-app-connector-long.sh",
    "packages/ops-tailnet-github-egress/snippets/github-restore-ref-app-connector-long.sh"
  ]
}
''
