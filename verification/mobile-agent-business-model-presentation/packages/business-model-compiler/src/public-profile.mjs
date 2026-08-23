import { parseBusinessModelProjectionProfile } from "./profile.mjs";

export const PUBLIC_BUSINESS_MODEL_PATTERN = "business-model/1";

const fail = message => { throw new Error(`business-model-public-profile: ${message}`); };
const invariant = (condition, message) => { if (!condition) fail(message); };

const actorById = model => new Map(model.actors.map(actor => [actor.id, actor]));

const deriveActorPath = model => {
  invariant(Array.isArray(model?.actors), "model actors are missing");
  invariant(model.actors.length >= 2 && model.actors.length <= 4, "business-model/1 supports 2 to 4 actors");
  const actors = actorById(model);
  const adjacency = new Map(model.actors.map(actor => [actor.id, new Set()]));
  for (const exchange of model.exchanges) {
    invariant(actors.has(exchange.from) && actors.has(exchange.to), `exchange ${exchange.id} references an unknown actor`);
    adjacency.get(exchange.from).add(exchange.to);
    adjacency.get(exchange.to).add(exchange.from);
  }
  for (const actor of model.actors) {
    const degree = adjacency.get(actor.id).size;
    invariant(degree >= 1 && degree <= 2, `actor ${actor.id} must belong to one exchange path`);
  }
  const endpoints = model.actors.filter(actor => adjacency.get(actor.id).size === 1);
  invariant(endpoints.length === 2, "actor exchange graph must be one path with two endpoints");

  const endpointIds = new Set(endpoints.map(actor => actor.id));
  const endpointInputs = model.exchanges
    .filter(exchange => exchange.kind === "input" && endpointIds.has(exchange.from))
    .sort((left, right) => left.recordIndex - right.recordIndex);
  const start = endpointInputs.length > 0
    ? actors.get(endpointInputs[0].from)
    : [...endpoints].sort((left, right) => left.recordIndex - right.recordIndex)[0];

  const ordered = [];
  const visited = new Set();
  let previous = null;
  let current = start.id;
  while (current !== null) {
    invariant(!visited.has(current), `actor exchange path contains a cycle at ${current}`);
    visited.add(current);
    ordered.push(actors.get(current));
    const next = [...adjacency.get(current)].filter(id => id !== previous);
    invariant(next.length <= 1, `actor exchange path branches at ${current}`);
    previous = current;
    current = next[0] ?? null;
  }
  invariant(ordered.length === model.actors.length, "actor exchange graph is disconnected");
  return Object.freeze(ordered);
};

export const derivePublicBusinessModelProjectionProfile = model => {
  const actors = deriveActorPath(model);
  return parseBusinessModelProjectionProfile({
    schema: "business-model-projection-profile/1",
    id: PUBLIC_BUSINESS_MODEL_PATTERN,
    label: "多主体事業モデル",
    actorRoles: actors.map(actor => actor.role),
    requiredExchangeKinds: ["input", "offer", "payment"],
    view: {
      orientation: "lr",
      exchangeStrategy: "adjacent-pairs",
      stageFocus: "primary-activity",
      nesting: "owner-parent",
    },
    coverage: {
      a2uiExcludeTypes: ["transitions"],
      seqExcludeTypes: ["nodes"],
      mapExcludeTypes: ["stages", "activities", "transitions"],
    },
  });
};
