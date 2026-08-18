builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-decision-closure",
  "repoId": "ops",
  "mission": "Prove the immutable Fact Condition Claim authority, engine-neutral query contract, read-only release projections, Decision Packet, and static Decision Room required by Issue #115.",
  "primaryTarget": "packages/ops-decision-closure",
  "requiredOutputs": "packages.<system>.ops-decision-closure",
  "requiredChecks": "checks.<system>.ops-decision-closure",
  "responsibility": "Validate immutable JSONL segments, build SQLite-shard and Frozen-DuckLake candidates, compare canonical query results and fail-closed cases, prove replay and incremental reuse, and generate one engine-neutral Decision Packet plus static human projection.",
  "forbiddenResponsibility": "Does not make generated databases authoritative, cut over the existing DuckDB path, publish a Release, deploy Cloudflare, admit human choices without Git review, claim real decision-economics savings from synthetic runs, or claim independent takeover from the originating thread."
}
''
