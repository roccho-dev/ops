builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "package-architecture-map",
  "repoId": "ops",
  "mission": "Render compact repo/package architecture inventories into Mermaid maps and static viewer output without making generated views authoritative.",
  "primaryTarget": "packages/package-architecture-map",
  "requiredOutputs": "packages.<system>.package-architecture-map",
  "requiredChecks": "package-architecture-map.sample-render",
  "responsibility": "Convert inventory JSON into nested-box Mermaid .mmd files and a small static dist viewer for Caddy/browser inspection.",
  "forbiddenResponsibility": "Does not own architecture truth, does not render on the server, does not run Caddy, does not add approval semantics, and does not make .mmd or HTML authoritative."
}
''
