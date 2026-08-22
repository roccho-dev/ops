import { PROFILED_BUSINESS_MODEL_CATALOG_ID, PROFILED_BUSINESS_MODEL_SURFACE_ID } from "./catalog.mjs";
import { PROFILED_BUSINESS_MODEL_SEQUENCE_SCHEMA } from "./projectors.mjs";

const fail = message => { throw new Error(`business-model-profiled-sequence: ${message}`); };
const invariant = (condition, message) => { if (!condition) fail(message); };

export const validateProfiledBusinessModelSequence = value => {
  invariant(value && typeof value === "object" && !Array.isArray(value), "sequence must be an object");
  invariant(value.schema === PROFILED_BUSINESS_MODEL_SEQUENCE_SCHEMA, `schema must be ${PROFILED_BUSINESS_MODEL_SEQUENCE_SCHEMA}`);
  invariant(value.catalogId === PROFILED_BUSINESS_MODEL_CATALOG_ID, `catalogId must be ${PROFILED_BUSINESS_MODEL_CATALOG_ID}`);
  invariant(value.surfaceId === PROFILED_BUSINESS_MODEL_SURFACE_ID, `surfaceId must be ${PROFILED_BUSINESS_MODEL_SURFACE_ID}`);
  invariant(typeof value.sourceId === "string" && value.sourceId.length > 0, "sourceId is required");
  invariant(typeof value.profileId === "string" && value.profileId.length > 0, "profileId is required");
  invariant(Array.isArray(value.stages) && value.stages.length > 0, "stages are required");
  const stages = value.stages.map((stage, index) => {
    invariant(stage && typeof stage === "object" && !Array.isArray(stage), `stages[${index}] must be an object`);
    invariant(typeof stage.id === "string" && stage.id.length > 0, `stages[${index}].id is invalid`);
    invariant(stage.index === index, `stages[${index}].index is invalid`);
    invariant(Array.isArray(stage.messages) && stage.messages.length > 0, `stages[${index}].messages are required`);
    return Object.freeze({ id: stage.id, index, messages: Object.freeze(structuredClone(stage.messages)) });
  });
  invariant(new Set(stages.map(stage => stage.id)).size === stages.length, "stage ids are duplicated");
  invariant(stages.some(stage => stage.id === value.start), "start stage is missing");
  return Object.freeze({
    schema: PROFILED_BUSINESS_MODEL_SEQUENCE_SCHEMA,
    catalogId: PROFILED_BUSINESS_MODEL_CATALOG_ID,
    surfaceId: PROFILED_BUSINESS_MODEL_SURFACE_ID,
    sourceId: value.sourceId,
    profileId: value.profileId,
    start: value.start,
    stages: Object.freeze(stages),
  });
};
