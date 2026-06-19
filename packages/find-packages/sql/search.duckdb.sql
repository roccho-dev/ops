-- find-packages DuckDB search template.
-- Requires sql/projection.duckdb.sql to define find_packages_normalized.
-- Replace __QUERY__ and __ROLE__ with empty strings when unused.

select repo, kind, pkg, role, count, examples, source, authority
from find_packages_normalized
where ('__QUERY__' = '' or lower(repo || ' ' || kind || ' ' || pkg || ' ' || role || ' ' || examples || ' ' || source || ' ' || authority) like '%' || lower('__QUERY__') || '%')
  and ('__ROLE__' = '' or lower(role) like '%' || lower('__ROLE__') || '%')
order by repo, pkg, source;
