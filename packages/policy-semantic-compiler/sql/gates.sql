CREATE OR REPLACE TABLE semantic_gate AS
SELECT 'mandatory-signals-have-activation-edge' AS gate_id,
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END AS status,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'mandatory signal missing activation edge' END AS blocker
FROM signals s
LEFT JOIN edges e ON e.from = s.signalId AND e.edgeType = 'activation'
WHERE s.modal = 'mandatory' AND e.edgeId IS NULL
UNION ALL
SELECT 'review-signals-have-review-edge',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'review signal has no required-review edge' END
FROM signals s
LEFT JOIN edges e ON e.from = s.signalId AND e.edgeType = 'required-review'
WHERE s.modal = 'review' AND e.edgeId IS NULL
UNION ALL
SELECT 'no-wildcard-role-scope',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'role widened to wildcard scope' END
FROM native_rows
WHERE scope = '*' OR scope LIKE '%wildcard%'
UNION ALL
SELECT 'no-stale-policy-git-migration-claim',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'stale direct policy.git reference claimed migrated' END
FROM signals
WHERE lower(text) LIKE '%policy.git%' AND lower(text) LIKE '%migrated%';

CREATE OR REPLACE TABLE duckdb_gate AS
SELECT 'duckdb-executed' AS gate_id,
       'pass' AS status,
       NULL AS blocker;

CREATE OR REPLACE TABLE gate_results AS
SELECT * FROM duckdb_gate
UNION ALL SELECT * FROM integrity_gate
UNION ALL SELECT * FROM compile_gate
UNION ALL SELECT * FROM semantic_gate;
