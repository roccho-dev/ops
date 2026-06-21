CREATE OR REPLACE TABLE compiled_projection AS
SELECT n.nativeId,
       n.signalId,
       n.modal,
       n.polarity,
       n.scope,
       n.text
FROM native_rows n
JOIN edges e ON e.to = n.nativeId
WHERE e.edgeType = 'projection';

CREATE OR REPLACE TABLE compile_gate AS
SELECT 'native-rows-have-projection-edge' AS gate_id,
       CASE
         WHEN (SELECT count(*) FROM native_rows) = (SELECT count(*) FROM compiled_projection)
         THEN 'pass'
         ELSE 'blocked'
       END AS status,
       CASE
         WHEN (SELECT count(*) FROM native_rows) = (SELECT count(*) FROM compiled_projection)
         THEN NULL
         ELSE 'native row emitted without projection edge'
       END AS blocker;
