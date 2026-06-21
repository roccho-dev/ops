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
WHERE lower(text) LIKE '%policy.git%' AND lower(text) LIKE '%migrated%'
UNION ALL
SELECT 'semantic-diff-must-weakened',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'mandatory source signal weakened in projected candidate' END
FROM signals
WHERE TRIM(BOTH '"' FROM CAST(baselineModal AS VARCHAR)) = 'mandatory'
  AND TRIM(BOTH '"' FROM CAST(modal AS VARCHAR)) <> 'mandatory'
UNION ALL
SELECT 'semantic-diff-deny-to-allow',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'deny source signal changed to allow in projected candidate' END
FROM signals
WHERE TRIM(BOTH '"' FROM CAST(baselinePolarity AS VARCHAR)) = 'deny'
  AND TRIM(BOTH '"' FROM CAST(polarity AS VARCHAR)) = 'allow'
UNION ALL
SELECT 'consumer-migrated-has-diff',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'consumer edge marked migrated without consumer diff evidence' END
FROM edges
WHERE edgeType = 'consumer-migration'
  AND TRIM(BOTH '"' FROM CAST(migrationStatus AS VARCHAR)) = 'migrated'
  AND TRIM(BOTH '"' FROM CAST(consumerDiff AS VARCHAR)) <> 'true'
UNION ALL
SELECT 'graph-records-present',
       CASE
         WHEN (SELECT count(*) FROM sources) > 0
          AND (SELECT count(*) FROM signals) > 0
          AND (SELECT count(*) FROM edges WHERE edgeType = 'source-span') > 0
          AND (SELECT count(*) FROM edges WHERE edgeType = 'projection') > 0
          AND (SELECT count(*) FROM native_rows) > 0
         THEN 'pass'
         ELSE 'blocked'
       END,
       CASE
         WHEN (SELECT count(*) FROM sources) > 0
          AND (SELECT count(*) FROM signals) > 0
          AND (SELECT count(*) FROM edges WHERE edgeType = 'source-span') > 0
          AND (SELECT count(*) FROM edges WHERE edgeType = 'projection') > 0
          AND (SELECT count(*) FROM native_rows) > 0
         THEN NULL
         ELSE 'source-tree byte parity is not enough; graph records must remain present'
       END;

CREATE OR REPLACE TABLE duckdb_gate AS
SELECT 'duckdb-executed' AS gate_id,
       'pass' AS status,
       NULL AS blocker;

CREATE OR REPLACE TABLE cutover_gate AS
SELECT 'semantic-cutover-blocked' AS gate_id,
       'blocked' AS status,
       'candidate artifact validity is not semantic equivalence, cutover approval, deletion approval, or proof of active policy.git dependency 0' AS blocker;

CREATE OR REPLACE TABLE gate_results AS
SELECT * FROM duckdb_gate
UNION ALL SELECT * FROM integrity_gate
UNION ALL SELECT * FROM compile_gate
UNION ALL SELECT * FROM semantic_gate
UNION ALL SELECT * FROM cutover_gate;
