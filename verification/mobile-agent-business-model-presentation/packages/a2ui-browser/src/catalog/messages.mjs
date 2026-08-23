import { A2UI_MESSAGE_VERSION, createBaseCatalog } from "./base.mjs";

const invariant = (condition, message) => { if (!condition) throw new Error(`a2ui-messages: ${message}`); };
const updateKinds = ["createSurface", "deleteSurface", "updateComponents", "updateDataModel"];

const kindOf = message => {
  invariant(message && typeof message === "object" && !Array.isArray(message), "message must be an object");
  invariant(message.version === A2UI_MESSAGE_VERSION, `message version must be ${A2UI_MESSAGE_VERSION}`);
  const kinds = updateKinds.filter(key => Object.hasOwn(message, key));
  invariant(kinds.length === 1, "message must contain exactly one update kind");
  invariant(Object.keys(message).every(key => key === "version" || kinds.includes(key)), "message has unknown fields");
  return kinds[0];
};

export const validateMessageBatch = (
  input,
  {
    catalog = createBaseCatalog(),
    catalogId = catalog.id,
    componentLimit = 512,
    requiredRootIds = ["root"],
    surfaceId = "main",
  } = {},
) => {
  invariant(catalog && typeof catalog.validateComponent === "function", "trusted catalog is required");
  invariant(typeof catalogId === "string" && catalogId.length > 0, "catalogId is required");
  invariant(typeof surfaceId === "string" && surfaceId.length > 0, "surfaceId is required");
  invariant(Array.isArray(requiredRootIds) && requiredRootIds.every(id => typeof id === "string" && id.length > 0), "requiredRootIds are invalid");
  invariant(new Set(requiredRootIds).size === requiredRootIds.length, "requiredRootIds contain duplicates");
  invariant(Number.isSafeInteger(componentLimit) && componentLimit > 0, "componentLimit is invalid");
  invariant(Array.isArray(input) && input.length === 3, "batch must contain exactly three messages");

  const kinds = input.map(kindOf);
  invariant(JSON.stringify(kinds) === JSON.stringify(["createSurface", "updateDataModel", "updateComponents"]), "message order is invalid");
  const [createMessage, dataMessage, componentMessage] = input;
  const created = createMessage.createSurface;
  invariant(created?.surfaceId === surfaceId, `surfaceId must be ${surfaceId}`);
  invariant(created?.catalogId === catalogId, "catalogId is invalid");
  invariant(Object.keys(created).every(key => ["catalogId", "sendDataModel", "surfaceId"].includes(key)), "createSurface fields are invalid");
  if (created.sendDataModel !== undefined) invariant(typeof created.sendDataModel === "boolean", "sendDataModel must be boolean");
  invariant(dataMessage.updateDataModel?.surfaceId === surfaceId && dataMessage.updateDataModel?.path === "/", "data model target is invalid");
  invariant(dataMessage.updateDataModel.value && typeof dataMessage.updateDataModel.value === "object" && !Array.isArray(dataMessage.updateDataModel.value), "data model value is invalid");
  invariant(componentMessage.updateComponents?.surfaceId === surfaceId, "component target is invalid");

  const components = componentMessage.updateComponents.components;
  invariant(Array.isArray(components) && components.length > 0, "components are required");
  invariant(components.length <= componentLimit, `component count exceeds ${componentLimit}`);
  const validated = components.map(component => catalog.validateComponent(component));
  const ids = validated.map(item => item.id);
  invariant(new Set(ids).size === ids.length, "component ids are duplicated");
  for (const rootId of requiredRootIds) invariant(ids.includes(rootId), `required root component is missing: ${rootId}`);
  return Object.freeze(input.map(message => Object.freeze(structuredClone(message))));
};
