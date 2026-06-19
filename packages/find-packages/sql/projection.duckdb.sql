-- find-packages DuckDB projection template.
-- Replace __PROJECTION_PATH__ with an adrs package projection JSON/JSONL file path.
-- This is a read model only; it is not package authority.

create or replace view find_packages_raw as
select json
from read_json_objects('__PROJECTION_PATH__');

create or replace view find_packages_normalized as
select
  coalesce(json_extract_string(json, '$.repo'), json_extract_string(json, '$.repository'), json_extract_string(json, '$.repoId'), json_extract_string(json, '$.ownerRepo'), '') as repo,
  coalesce(json_extract_string(json, '$.kind'), json_extract_string(json, '$.type'), json_extract_string(json, '$.recordKind'), json_extract_string(json, '$.category'), '') as kind,
  coalesce(json_extract_string(json, '$.pkg'), json_extract_string(json, '$.package'), json_extract_string(json, '$.packageName'), json_extract_string(json, '$.name'), json_extract_string(json, '$.output'), json_extract_string(json, '$.target'), json_extract_string(json, '$.targetRef'), json_extract_string(json, '$.tool'), json_extract_string(json, '$.skill'), '') as pkg,
  coalesce(json_extract_string(json, '$.role'), json_extract_string(json, '$.capability'), json_extract_string(json, '$.responsibility'), json_extract_string(json, '$.whenToUse'), json_extract_string(json, '$.tags'), '') as role,
  coalesce(json_extract_string(json, '$.count'), json_extract_string(json, '$.hits'), json_extract_string(json, '$.n'), json_extract_string(json, '$.total'), '') as count,
  coalesce(json_extract_string(json, '$.examples'), json_extract_string(json, '$.example'), json_extract_string(json, '$.summary'), json_extract_string(json, '$.description'), json_extract_string(json, '$.title'), json_extract_string(json, '$.note'), json_extract_string(json, '$.message'), json_extract_string(json, '$.path'), '') as examples,
  coalesce(json_extract_string(json, '$.source'), json_extract_string(json, '$.path'), json_extract_string(json, '$.file'), json_extract_string(json, '$.ref'), json_extract_string(json, '$.branch'), json_extract_string(json, '$.raw_id'), json_extract_string(json, '$.id'), '') as source,
  coalesce(json_extract_string(json, '$.authority'), json_extract_string(json, '$.status'), json_extract_string(json, '$.state'), json_extract_string(json, '$.proofState'), json_extract_string(json, '$.acceptance'), '') as authority
from find_packages_raw
where coalesce(json_extract_string(json, '$.pkg'), json_extract_string(json, '$.package'), json_extract_string(json, '$.packageName'), json_extract_string(json, '$.name'), json_extract_string(json, '$.repo'), json_extract_string(json, '$.repository'), json_extract_string(json, '$.summary'), json_extract_string(json, '$.description'), json_extract_string(json, '$.title'), '') <> '';
