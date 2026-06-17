with raw as (
  select
    json,
    json_extract_string(json, '$.recordedAt') as recordedAt,
    json_extract_string(json, '$.payloadKind') as payloadKind
  from read_ndjson_objects('{{RAW_JSONL}}')
),
surface_config as (
  select
    json_extract_string(json, '$.payload.title') as title,
    coalesce(try_cast(json_extract_string(json, '$.payload.w') as double), 1000) as w,
    coalesce(try_cast(json_extract_string(json, '$.payload.h') as double), 700) as h,
    coalesce(try_cast(json_extract_string(json, '$.payload.cell') as integer), 7) as cell
  from raw where payloadKind = 'need_zoom.surface_config.v1'
  order by recordedAt desc limit 1
),
nodes as (
  select
    json_extract_string(json, '$.payload.id') as id,
    json_extract_string(json, '$.payload.label') as label,
    json_extract_string(json, '$.payload.facet') as facet,
    coalesce(try_cast(json_extract_string(json, '$.payload.lvl') as integer), 0) as lvl,
    coalesce(try_cast(json_extract_string(json, '$.payload.x') as double), 0) as x,
    coalesce(try_cast(json_extract_string(json, '$.payload.y') as double), 0) as y,
    coalesce(try_cast(json_extract_string(json, '$.payload.r') as double), 42) as r,
    json_extract_string(json, '$.payload.parent') as parent,
    json_extract_string(json, '$.payload.summary') as summary
  from raw where payloadKind = 'need_zoom.node.v1'
),
edges as (
  select
    json_extract_string(json, '$.payload.a') as a,
    json_extract_string(json, '$.payload.b') as b,
    json_extract_string(json, '$.payload.k') as k,
    coalesce(try_cast(json_extract_string(json, '$.payload.w') as double), 1) as w
  from raw where payloadKind = 'need_zoom.edge.v1'
),
events as (
  select
    recordedAt,
    json_extract_string(json, '$.payload.type') as type,
    json_extract_string(json, '$.payload.label') as label,
    json_extract_string(json, '$.payload.to') as toRole,
    json_extract_string(json, '$.payload.node') as node,
    json_extract_string(json, '$.payload.message') as message
  from raw where payloadKind = 'need_zoom.event.v1'
),
query_state as (
  select
    coalesce(try_cast(json_extract_string(json, '$.payload.scale') as double), 1) as scale,
    json_extract_string(json, '$.payload.focus') as focus
  from raw where payloadKind = 'need_zoom.ui_query.v1'
  order by recordedAt desc limit 1
),
levels as (
  select coalesce((select scale from query_state), 1.0) as scale,
    case
      when coalesce((select scale from query_state), 1.0) < 0.68 then 0
      when coalesce((select scale from query_state), 1.0) < 1.15 then 1
      when coalesce((select scale from query_state), 1.0) < 1.85 then 2
      else 3
    end as level,
    (select focus from query_state) as focus
),
visible_nodes as (
  select n.* from nodes n, levels l
  where n.lvl <= l.level or n.id = l.focus or n.parent = l.focus
),
pool_counts as (
  select payloadKind, count(*) as count from raw group by payloadKind
),
current_purpose as (
  select label from events where type = 'purpose.set' and label is not null order by recordedAt desc limit 1
)
select json_object(
  'kind', 'need_zoom.voronoi_surface.v1',
  'surface', json_object(
    'title', coalesce((select title from surface_config), 'Need Zoom Voronoi PoC'),
    'world', json_object('w', coalesce((select w from surface_config), 1000), 'h', coalesce((select h from surface_config), 700), 'cell', coalesce((select cell from surface_config), 7)),
    'zoom', json_object('scale', (select scale from levels), 'level', (select level from levels), 'focus', (select focus from levels)),
    'purpose', coalesce((select label from current_purpose), 'unset'),
    'rawCount', (select count(*) from raw)
  ),
  'nodes', (select coalesce(json_group_array(json_object('id', id, 'label', label, 'facet', facet, 'lvl', lvl, 'x', x, 'y', y, 'r', r, 'parent', parent, 'summary', summary)), json('[]')) from nodes),
  'edges', (select coalesce(json_group_array(json_object('a', a, 'b', b, 'k', k, 'w', w)), json('[]')) from edges),
  'visibleNodeIds', (select coalesce(json_group_array(id), json('[]')) from visible_nodes),
  'events', (select coalesce(json_group_array(json_object('recordedAt', recordedAt, 'type', type, 'label', label, 'to', toRole, 'node', node, 'message', message)), json('[]')) from events),
  'pool', json_object(
    'kind', 'need_zoom.raw_pool.v1',
    'rawCount', (select count(*) from raw),
    'byPayloadKind', (select coalesce(json_group_array(json_object('payloadKind', payloadKind, 'count', count)), json('[]')) from pool_counts)
  )
) as projection;
