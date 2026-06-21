CREATE OR REPLACE TABLE integrity_gate AS
SELECT 'sources-present' AS gate_id,
       CASE WHEN count(*) > 0 THEN 'pass' ELSE 'blocked' END AS status,
       CASE WHEN count(*) > 0 THEN NULL ELSE 'no source files inventoried from policy repo' END AS blocker
FROM sources
UNION ALL
SELECT 'signals-present',
       CASE WHEN count(*) > 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) > 0 THEN NULL ELSE 'no candidate normative signals found' END
FROM signals
UNION ALL
SELECT 'source-spans-present',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'signal references missing or shifted source span' END
FROM signals s
LEFT JOIN sources src ON src.sourceId = s.sourceId
WHERE src.sourceId IS NULL OR s.lineStart IS NULL OR s.lineEnd IS NULL OR s.lineStart > s.lineEnd;
