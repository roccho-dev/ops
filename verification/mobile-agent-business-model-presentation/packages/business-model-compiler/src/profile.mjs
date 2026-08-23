import { BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA } from "./model.mjs";

export const BUSINESS_MODEL_PROJECTION_PROFILE_SCHEMA = "business-model-projection-profile/1";
export const BUSINESS_MODEL_PRESENTATION_PLAN_SCHEMA = "business-model-presentation-plan/1";

const fail = message => { throw new Error(`business-model-profile: ${message}`); };
const invariant = (condition, message) => { if (!condition) fail(message); };
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, name) => { invariant(typeof value === "string" && value.trim().length > 0, `${name} is required`); return value.trim(); };
const token = (value, name) => {
  const result = text(value, name);
  invariant(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(result), `${name} is invalid`);
  return result;
};
const exactKeys = (record, required, optional, name) => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) invariant(Object.hasOwn(record, key), `${name}.${key} is required`);
  for (const key of Object.keys(record)) invariant(allowed.has(key), `${name}.${key} is not allowed`);
};
const tokenArray = (value, name) => {
  invariant(Array.isArray(value) && value.length > 0, `${name} must be a non-empty array`);
  const result = value.map((item, index) => token(item, `${name}[${index}]`));
  invariant(new Set(result).size === result.length, `${name} contains duplicates`);
  return Object.freeze(result);
};
const deepFreeze = value => {
  if (Array.isArray(value)) { value.forEach(deepFreeze); return Object.freeze(value); }
  if (plain(value)) { Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
  return value;
};
const SEMANTIC_TYPES = Object.freeze(["stages", "actors", "nodes", "exchanges", "activities", "transitions"]);
const exclusionTypes = (value, name) => {
  const result = tokenArray(value, name);
  for (const item of result) invariant(SEMANTIC_TYPES.includes(item), `${name} contains unsupported semantic type ${item}`);
  return result;
};

export const parseBusinessModelProjectionProfile = input => {
  let value = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input); } catch (error) { fail(`profile is invalid JSON: ${error.message}`); }
  }
  invariant(plain(value), "profile must be an object");
  exactKeys(value, ["schema", "id", "label", "actorRoles", "requiredExchangeKinds", "view", "coverage"], [], "profile");
  invariant(value.schema === BUSINESS_MODEL_PROJECTION_PROFILE_SCHEMA, `profile.schema must be ${BUSINESS_MODEL_PROJECTION_PROFILE_SCHEMA}`);
  invariant(plain(value.view), "profile.view must be an object");
  exactKeys(value.view, ["orientation", "exchangeStrategy", "stageFocus", "nesting"], [], "profile.view");
  invariant(value.view.orientation === "lr", "profile.view.orientation must be lr");
  invariant(value.view.exchangeStrategy === "adjacent-pairs", "profile.view.exchangeStrategy must be adjacent-pairs");
  invariant(value.view.stageFocus === "primary-activity", "profile.view.stageFocus must be primary-activity");
  invariant(value.view.nesting === "owner-parent", "profile.view.nesting must be owner-parent");
  invariant(plain(value.coverage), "profile.coverage must be an object");
  exactKeys(value.coverage, ["a2uiExcludeTypes", "seqExcludeTypes", "mapExcludeTypes"], [], "profile.coverage");
  return deepFreeze({
    schema: BUSINESS_MODEL_PROJECTION_PROFILE_SCHEMA,
    id: token(value.id, "profile.id"),
    label: text(value.label, "profile.label"),
    actorRoles: tokenArray(value.actorRoles, "profile.actorRoles"),
    requiredExchangeKinds: tokenArray(value.requiredExchangeKinds, "profile.requiredExchangeKinds"),
    view: {
      orientation: value.view.orientation,
      exchangeStrategy: value.view.exchangeStrategy,
      stageFocus: value.view.stageFocus,
      nesting: value.view.nesting,
    },
    coverage: {
      a2uiExcludeTypes: exclusionTypes(value.coverage.a2uiExcludeTypes, "profile.coverage.a2uiExcludeTypes"),
      seqExcludeTypes: exclusionTypes(value.coverage.seqExcludeTypes, "profile.coverage.seqExcludeTypes"),
      mapExcludeTypes: exclusionTypes(value.coverage.mapExcludeTypes, "profile.coverage.mapExcludeTypes"),
    },
  });
};

const nodeDepth = (node, nodeById) => {
  let depth = 0;
  let current = node;
  while (current.parent) {
    depth += 1;
    current = nodeById.get(current.parent);
    invariant(current, `node parent is missing while planning ${node.id}`);
  }
  return depth;
};

export const compileBusinessModelPresentationPlan = (model, profileInput) => {
  invariant(model?.schema === BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA, `model.schema must be ${BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA}`);
  const profile = profileInput?.schema === BUSINESS_MODEL_PROJECTION_PROFILE_SCHEMA ? profileInput : parseBusinessModelProjectionProfile(profileInput);
  const actorByRole = new Map(model.actors.map(actor => [actor.role, actor]));
  const actualRoles = [...actorByRole.keys()].sort();
  const expectedRoles = [...profile.actorRoles].sort();
  invariant(JSON.stringify(actualRoles) === JSON.stringify(expectedRoles), `actor roles mismatch: expected ${expectedRoles.join(",")}, got ${actualRoles.join(",")}`);
  const actorOrder = profile.actorRoles.map(role => actorByRole.get(role));
  const actorIndex = new Map(actorOrder.map((actor, index) => [actor.id, index]));
  const kinds = new Set(model.exchanges.map(exchange => exchange.kind));
  for (const required of profile.requiredExchangeKinds) invariant(kinds.has(required), `required exchange kind is missing: ${required}`);
  for (const exchange of model.exchanges) {
    const from = actorIndex.get(exchange.from);
    const to = actorIndex.get(exchange.to);
    invariant(Number.isSafeInteger(from) && Number.isSafeInteger(to), `exchange ${exchange.id} references actor outside profile order`);
    invariant(Math.abs(from - to) === 1, `exchange ${exchange.id} is not between adjacent profile actors`);
  }

  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const nodesByActor = Object.fromEntries(actorOrder.map(actor => [actor.id, model.nodes
    .filter(node => node.owner === actor.id)
    .map(node => Object.freeze({ ...node, depth: nodeDepth(node, nodeById) }))
    .sort((a, b) => a.depth - b.depth || a.recordIndex - b.recordIndex)]));

  const columns = [];
  const exchangeGroups = [];
  actorOrder.forEach((actor, index) => {
    columns.push(Object.freeze({ id: `actor-column-${actor.id}`, kind: "actor", actorRef: actor.id }));
    if (index === actorOrder.length - 1) return;
    const right = actorOrder[index + 1];
    const exchangeRefs = model.exchanges
      .filter(exchange => new Set([exchange.from, exchange.to]).size === 2 && [exchange.from, exchange.to].includes(actor.id) && [exchange.from, exchange.to].includes(right.id))
      .sort((a, b) => a.recordIndex - b.recordIndex)
      .map(exchange => exchange.id);
    invariant(exchangeRefs.length > 0, `no exchange exists between adjacent actors ${actor.id} and ${right.id}`);
    const group = Object.freeze({
      id: `exchange-group-${actor.id}-${right.id}`,
      kind: "exchange",
      leftActorRef: actor.id,
      rightActorRef: right.id,
      exchangeRefs: Object.freeze(exchangeRefs),
    });
    exchangeGroups.push(group);
    columns.push(group);
  });

  return deepFreeze({
    schema: BUSINESS_MODEL_PRESENTATION_PLAN_SCHEMA,
    modelId: model.id,
    profile,
    actors: actorOrder,
    nodesByActor,
    exchangeGroups,
    columns,
    stageIds: model.stages.map(stage => stage.id),
  });
};
