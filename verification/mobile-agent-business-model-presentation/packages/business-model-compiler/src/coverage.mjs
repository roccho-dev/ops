import { BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA } from "./model.mjs";
import { BUSINESS_MODEL_PRESENTATION_PLAN_SCHEMA } from "./profile.mjs";
import { PROFILED_BUSINESS_MODEL_SEQUENCE_SCHEMA } from "./projectors.mjs";

export const BUSINESS_MODEL_PROJECTION_COVERAGE_SCHEMA = "business-model-projection-coverage/1";
const TYPES = Object.freeze(["stages", "actors", "nodes", "exchanges", "activities", "transitions"]);
const fail = message => { throw new Error(`business-model-coverage: ${message}`); };
const invariant = (condition, message) => { if (!condition) fail(message); };
const sorted = values => Object.freeze([...new Set(values)].sort());
const emptyByType = () => Object.fromEntries(TYPES.map(type => [type, []]));
const semanticIds = model => Object.fromEntries(TYPES.map(type => [type, sorted(model.semanticIds[type])]));
const relationIds = records => new Set(records.filter(record => record.type === "relation").map(record => record.id));
const regionIds = records => new Set(records.filter(record => record.type === "region").map(record => record.id));

const a2uiProjected = (model, sequence) => {
  const result = emptyByType();
  result.stages = sequence.stages.map(stage => stage.id);
  for (const stage of sequence.stages) {
    const update = stage.messages.find(message => message.updateComponents);
    invariant(update, `A2UI stage ${stage.id} has no updateComponents`);
    for (const component of update.updateComponents.components) {
      if (component.component === "ProfiledActor") {
        result.actors.push(component.actorRef);
        result.nodes.push(...component.nodeStates.map(item => item.ref));
      }
      if (component.component === "ProfiledExchangeGroup") result.exchanges.push(...component.exchangeStates.map(item => item.ref));
      if (component.component === "ProfiledBusinessModelStatus") result.activities.push(...component.activityRefs);
    }
  }
  return Object.fromEntries(TYPES.map(type => [type, sorted(result[type])]));
};

const seqProjected = (model, records) => {
  const regions = records.filter(record => record.type === "region");
  const relations = relationIds(records);
  const actorSet = new Set(model.actors.map(actor => actor.id));
  const activitySet = new Set(model.activities.map(activity => activity.id));
  const result = emptyByType();
  result.actors = regions.filter(record => record.kind === "actor" && record.id.startsWith("actor-")).map(record => record.id.slice("actor-".length)).filter(id => actorSet.has(id));
  result.activities = regions.filter(record => record.kind === "task").map(record => record.id).filter(id => activitySet.has(id));
  result.exchanges = model.exchanges.filter(exchange => relations.has(`exchange-${exchange.id}`)).map(exchange => exchange.id);
  result.transitions = model.transitions.filter(transition => relations.has(transition.id)).map(transition => transition.id);
  const activityIds = new Set(result.activities);
  result.stages = model.stages.filter(stage => activityIds.has(stage.focusRef)).map(stage => stage.id);
  return Object.fromEntries(TYPES.map(type => [type, sorted(result[type])]));
};

const mapProjected = (model, records) => {
  const regions = regionIds(records);
  const relations = relationIds(records);
  const result = emptyByType();
  result.actors = model.actors.filter(actor => regions.has(actor.id)).map(actor => actor.id);
  result.nodes = model.nodes.filter(node => regions.has(node.id)).map(node => node.id);
  result.exchanges = model.exchanges.filter(exchange => relations.has(exchange.id)).map(exchange => exchange.id);
  return Object.fromEntries(TYPES.map(type => [type, sorted(result[type])]));
};

const projectionReceipt = ({ all, excludedTypes, name, projected }) => {
  const excluded = emptyByType();
  const missing = emptyByType();
  const unknown = emptyByType();
  for (const type of TYPES) {
    const allSet = new Set(all[type]);
    const projectedSet = new Set(projected[type]);
    unknown[type] = sorted([...projectedSet].filter(id => !allSet.has(id)));
    if (excludedTypes.includes(type)) excluded[type] = sorted(all[type]);
    else missing[type] = sorted([...allSet].filter(id => !projectedSet.has(id)));
  }
  const pass = TYPES.every(type => missing[type].length === 0 && unknown[type].length === 0);
  return Object.freeze({ name, pass, projected, excluded, excludedTypes: sorted(excludedTypes), missing, unknown });
};

export const createBusinessModelProjectionCoverage = ({ model, plan, sequence, seqState, mapState }) => {
  invariant(model?.schema === BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA, `model.schema must be ${BUSINESS_MODEL_SEMANTIC_STATE_SCHEMA}`);
  invariant(plan?.schema === BUSINESS_MODEL_PRESENTATION_PLAN_SCHEMA, `plan.schema must be ${BUSINESS_MODEL_PRESENTATION_PLAN_SCHEMA}`);
  invariant(sequence?.schema === PROFILED_BUSINESS_MODEL_SEQUENCE_SCHEMA, `sequence.schema must be ${PROFILED_BUSINESS_MODEL_SEQUENCE_SCHEMA}`);
  invariant(Array.isArray(seqState) && Array.isArray(mapState), "seqState and mapState must be arrays");
  const all = semanticIds(model);
  const projections = Object.freeze({
    a2ui: projectionReceipt({ all, excludedTypes: plan.profile.coverage.a2uiExcludeTypes, name: "a2ui", projected: a2uiProjected(model, sequence) }),
    seq: projectionReceipt({ all, excludedTypes: plan.profile.coverage.seqExcludeTypes, name: "seq", projected: seqProjected(model, seqState) }),
    map: projectionReceipt({ all, excludedTypes: plan.profile.coverage.mapExcludeTypes, name: "map", projected: mapProjected(model, mapState) }),
  });
  const globalUncovered = emptyByType();
  for (const type of TYPES) {
    const union = new Set(Object.values(projections).flatMap(projection => projection.projected[type]));
    globalUncovered[type] = sorted(all[type].filter(id => !union.has(id)));
  }
  const pass = Object.values(projections).every(projection => projection.pass) && TYPES.every(type => globalUncovered[type].length === 0);
  return Object.freeze({
    schema: BUSINESS_MODEL_PROJECTION_COVERAGE_SCHEMA,
    status: pass ? "PASS" : "FAIL",
    pass,
    sourceId: model.id,
    profileId: plan.profile.id,
    semanticIds: all,
    projections,
    globalUncovered,
  });
};

export const assertBusinessModelProjectionCoverage = receipt => {
  invariant(receipt?.schema === BUSINESS_MODEL_PROJECTION_COVERAGE_SCHEMA, `receipt.schema must be ${BUSINESS_MODEL_PROJECTION_COVERAGE_SCHEMA}`);
  invariant(receipt.pass === true && receipt.status === "PASS", `projection coverage failed: ${JSON.stringify(receipt.globalUncovered)}`);
  return receipt;
};
