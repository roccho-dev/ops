export const BUSINESS_MODEL_SEMANTIC_JSONL_SCHEMA = "business-model-semantic-jsonl/2";
export const BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA = "business-model-semantic-state/2";

const fail = message => { throw new Error(`business-model-semantic: ${message}`); };
const invariant = (condition, message) => { if (!condition) fail(message); };
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, name) => {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} is required`);
  return value.trim();
};
const token = (value, name) => {
  const result = text(value, name);
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result), `${name} is invalid`);
  return result;
};
const integer = (value, name) => {
  invariant(Number.isSafeInteger(value) && value >= 0, `${name} must be a non-negative integer`);
  return value;
};
const stringArray = (value, name, { optional = false } = {}) => {
  if (optional && value === undefined) return undefined;
  invariant(Array.isArray(value) && value.length > 0, `${name} must be a non-empty array`);
  return Object.freeze(value.map((item, index) => text(item, `${name}[${index}]`)));
};
const exactKeys = (record, required, optional, name) => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) invariant(Object.hasOwn(record, key), `${name}.${key} is required`);
  for (const key of Object.keys(record)) invariant(allowed.has(key), `${name}.${key} is not allowed`);
};
const unique = (values, name) => invariant(new Set(values).size === values.length, `${name} are duplicated`);
const deepFreeze = value => {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (plain(value)) {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
};

const recordSchemas = Object.freeze({
  meta: Object.freeze({ required: ["type", "schema", "id", "title", "kicker", "start"], optional: [] }),
  stage: Object.freeze({ required: ["type", "id", "order", "short", "caption", "name", "goal", "change", "evidence", "gate", "focusRef"], optional: [] }),
  actor: Object.freeze({ required: ["type", "id", "role", "label", "detail", "born"], optional: [] }),
  node: Object.freeze({ required: ["type", "id", "owner", "kind", "label", "born"], optional: ["parent", "role", "detail", "items"] }),
  exchange: Object.freeze({ required: ["type", "id", "from", "to", "kind", "label", "born"], optional: ["detail"] }),
  activity: Object.freeze({ required: ["type", "id", "stage", "actor", "label", "summary", "primary"], optional: [] }),
  transition: Object.freeze({ required: ["type", "id", "from", "to", "kind", "label"], optional: [] }),
});

const parseLine = (line, index) => {
  let record;
  try { record = JSON.parse(line); } catch (error) { fail(`line ${index + 1} is invalid JSON: ${error.message}`); }
  invariant(plain(record), `line ${index + 1} must be an object`);
  const type = token(record.type, `line ${index + 1}.type`);
  const schema = recordSchemas[type];
  invariant(schema, `line ${index + 1}.type is unsupported: ${type}`);
  exactKeys(record, schema.required, schema.optional, `line ${index + 1}`);
  return Object.freeze({ ...record, __recordIndex: index });
};

const assertNodeTree = (nodes, actorIds, stageOrders) => {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    invariant(actorIds.has(node.owner), `node ${node.id} references missing owner ${node.owner}`);
    invariant(stageOrders.has(node.born), `node ${node.id} references missing born stage ${node.born}`);
    if (!node.parent) continue;
    const parent = nodeById.get(node.parent);
    invariant(parent, `node ${node.id} references missing parent ${node.parent}`);
    invariant(parent.owner === node.owner, `node ${node.id} parent must have the same owner`);
    invariant(stageOrders.get(parent.born) <= stageOrders.get(node.born), `node ${node.id} is born before its parent`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    invariant(!visiting.has(id), `node parent cycle contains ${id}`);
    visiting.add(id);
    const parent = nodeById.get(id)?.parent;
    if (parent) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
};

export const parseBusinessModelSemanticJsonl = input => {
  invariant(typeof input === "string", "input must be JSONL text");
  const lines = input.split(/\r?\n/u).filter(line => line.trim().length > 0);
  invariant(lines.length > 0, "records are required");
  const rawRecords = lines.map(parseLine);
  const byType = type => rawRecords.filter(record => record.type === type);

  const metas = byType("meta");
  invariant(metas.length === 1, "exactly one meta record is required");
  const meta = metas[0];
  invariant(meta.schema === BUSINESS_MODEL_SEMANTIC_JSONL_SCHEMA, `meta.schema must be ${BUSINESS_MODEL_SEMANTIC_JSONL_SCHEMA}`);
  const id = token(meta.id, "meta.id");
  const title = text(meta.title, "meta.title");
  const kicker = text(meta.kicker, "meta.kicker");
  const start = token(meta.start, "meta.start");

  const stages = byType("stage").map((record, index) => Object.freeze({
    id: token(record.id, `stages[${index}].id`),
    order: integer(record.order, `stages[${index}].order`),
    short: text(record.short, `stages[${index}].short`),
    caption: text(record.caption, `stages[${index}].caption`),
    name: text(record.name, `stages[${index}].name`),
    goal: text(record.goal, `stages[${index}].goal`),
    change: text(record.change, `stages[${index}].change`),
    evidence: text(record.evidence, `stages[${index}].evidence`),
    gate: text(record.gate, `stages[${index}].gate`),
    focusRef: token(record.focusRef, `stages[${index}].focusRef`),
    recordIndex: record.__recordIndex,
  })).sort((a, b) => a.order - b.order);
  invariant(stages.length >= 2, "at least two stages are required");
  unique(stages.map(stage => stage.id), "stage ids");
  invariant(stages.every((stage, index) => stage.order === index), "stage order must be contiguous from zero");
  invariant(stages.some(stage => stage.id === start), "meta.start is missing");
  const stageIds = new Set(stages.map(stage => stage.id));
  const stageOrders = new Map(stages.map(stage => [stage.id, stage.order]));

  const actors = byType("actor").map((record, index) => Object.freeze({
    id: token(record.id, `actors[${index}].id`),
    role: token(record.role, `actors[${index}].role`),
    label: text(record.label, `actors[${index}].label`),
    detail: text(record.detail, `actors[${index}].detail`),
    born: token(record.born, `actors[${index}].born`),
    recordIndex: record.__recordIndex,
  }));
  invariant(actors.length >= 1, "at least one actor is required");
  unique(actors.map(actor => actor.id), "actor ids");
  unique(actors.map(actor => actor.role), "actor roles");
  for (const actor of actors) invariant(stageIds.has(actor.born), `actor ${actor.id} references missing born stage ${actor.born}`);
  const actorIds = new Set(actors.map(actor => actor.id));

  const nodes = byType("node").map((record, index) => {
    const node = {
      id: token(record.id, `nodes[${index}].id`),
      owner: token(record.owner, `nodes[${index}].owner`),
      kind: token(record.kind, `nodes[${index}].kind`),
      label: text(record.label, `nodes[${index}].label`),
      born: token(record.born, `nodes[${index}].born`),
      recordIndex: record.__recordIndex,
    };
    if (record.parent !== undefined) node.parent = token(record.parent, `nodes[${index}].parent`);
    if (record.role !== undefined) node.role = text(record.role, `nodes[${index}].role`);
    if (record.detail !== undefined) node.detail = text(record.detail, `nodes[${index}].detail`);
    if (record.items !== undefined) node.items = stringArray(record.items, `nodes[${index}].items`);
    return Object.freeze(node);
  });
  unique(nodes.map(node => node.id), "node ids");
  assertNodeTree(nodes, actorIds, stageOrders);
  const nodeIds = new Set(nodes.map(node => node.id));

  const exchanges = byType("exchange").map((record, index) => {
    const exchange = {
      id: token(record.id, `exchanges[${index}].id`),
      from: token(record.from, `exchanges[${index}].from`),
      to: token(record.to, `exchanges[${index}].to`),
      kind: token(record.kind, `exchanges[${index}].kind`),
      label: text(record.label, `exchanges[${index}].label`),
      born: token(record.born, `exchanges[${index}].born`),
      recordIndex: record.__recordIndex,
    };
    if (record.detail !== undefined) exchange.detail = text(record.detail, `exchanges[${index}].detail`);
    invariant(actorIds.has(exchange.from), `exchange ${exchange.id} references missing from actor ${exchange.from}`);
    invariant(actorIds.has(exchange.to), `exchange ${exchange.id} references missing to actor ${exchange.to}`);
    invariant(exchange.from !== exchange.to, `exchange ${exchange.id} must cross actors`);
    invariant(stageIds.has(exchange.born), `exchange ${exchange.id} references missing born stage ${exchange.born}`);
    return Object.freeze(exchange);
  });
  unique(exchanges.map(exchange => exchange.id), "exchange ids");

  const activities = byType("activity").map((record, index) => Object.freeze({
    id: token(record.id, `activities[${index}].id`),
    stage: token(record.stage, `activities[${index}].stage`),
    actor: token(record.actor, `activities[${index}].actor`),
    label: text(record.label, `activities[${index}].label`),
    summary: text(record.summary, `activities[${index}].summary`),
    primary: record.primary === true,
    recordIndex: record.__recordIndex,
  }));
  unique(activities.map(activity => activity.id), "activity ids");
  const activityIds = new Set(activities.map(activity => activity.id));
  for (const activity of activities) {
    invariant(stageIds.has(activity.stage), `activity ${activity.id} references missing stage ${activity.stage}`);
    invariant(actorIds.has(activity.actor), `activity ${activity.id} references missing actor ${activity.actor}`);
  }
  for (const stage of stages) {
    const primary = activities.filter(activity => activity.stage === stage.id && activity.primary);
    invariant(primary.length === 1, `stage ${stage.id} requires exactly one primary activity`);
    invariant(primary[0].id === stage.focusRef, `stage ${stage.id}.focusRef must equal its primary activity`);
  }

  const transitions = byType("transition").map((record, index) => Object.freeze({
    id: token(record.id, `transitions[${index}].id`),
    from: token(record.from, `transitions[${index}].from`),
    to: token(record.to, `transitions[${index}].to`),
    kind: token(record.kind, `transitions[${index}].kind`),
    label: text(record.label, `transitions[${index}].label`),
    recordIndex: record.__recordIndex,
  }));
  unique(transitions.map(transition => transition.id), "transition ids");
  for (const transition of transitions) {
    invariant(activityIds.has(transition.from), `transition ${transition.id} references missing from activity ${transition.from}`);
    invariant(activityIds.has(transition.to), `transition ${transition.id} references missing to activity ${transition.to}`);
  }

  const records = rawRecords.map(record => {
    const copy = { ...record };
    delete copy.__recordIndex;
    return Object.freeze(copy);
  });
  return deepFreeze({
    schema: BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA,
    sourceSchema: BUSINESS_MODEL_SEMANTIC_JSONL_SCHEMA,
    id,
    title,
    kicker,
    start,
    records,
    stages,
    actors,
    nodes,
    exchanges,
    activities,
    transitions,
    semanticIds: {
      stages: stages.map(stage => stage.id),
      actors: actors.map(actor => actor.id),
      nodes: nodes.map(node => node.id),
      exchanges: exchanges.map(exchange => exchange.id),
      activities: activities.map(activity => activity.id),
      transitions: transitions.map(transition => transition.id),
    },
  });
};
