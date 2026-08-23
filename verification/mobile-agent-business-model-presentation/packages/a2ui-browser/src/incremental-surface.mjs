import { A2UI_MESSAGE_VERSION, createBaseCatalog } from "./catalog/base.mjs";
import { isPlainObject } from "./catalog/runtime.mjs";
import { renderTrustedSurface } from "./render/trusted-dom.mjs";

const invariant = (condition, message) => {
  if (!condition) throw new Error(`a2ui-incremental: ${message}`);
};

const KINDS = Object.freeze(["createSurface", "deleteSurface", "updateComponents", "updateDataModel"]);

const kindOf = message => {
  invariant(isPlainObject(message), "message must be a plain object");
  invariant(message.version === A2UI_MESSAGE_VERSION, `message version must be ${A2UI_MESSAGE_VERSION}`);
  const kinds = KINDS.filter(kind => Object.hasOwn(message, kind));
  invariant(kinds.length === 1, "message must contain exactly one update kind");
  invariant(Object.keys(message).every(key => key === "version" || kinds.includes(key)), "message has unknown fields");
  return kinds[0];
};

const decodePointer = path => {
  invariant(typeof path === "string" && path.startsWith("/"), "data model path must be a JSON pointer");
  if (path === "/") return [];
  return path.slice(1).split("/").map(token => token.replaceAll("~1", "/").replaceAll("~0", "~"));
};

const setAtPointer = (current, path, value) => {
  const tokens = decodePointer(path);
  if (tokens.length === 0) {
    invariant(isPlainObject(value), "root data model value must be a plain object");
    return structuredClone(value);
  }
  const root = isPlainObject(current) ? structuredClone(current) : {};
  let cursor = root;
  for (const token of tokens.slice(0, -1)) {
    if (!isPlainObject(cursor[token])) cursor[token] = {};
    cursor = cursor[token];
  }
  cursor[tokens.at(-1)] = structuredClone(value);
  return root;
};

const validateComponents = ({ catalog, components, componentLimit, requiredRootIds }) => {
  invariant(Array.isArray(components) && components.length > 0, "components are required");
  invariant(components.length <= componentLimit, `component count exceeds ${componentLimit}`);
  const validated = components.map(component => catalog.validateComponent(component));
  const ids = validated.map(component => component.id);
  invariant(new Set(ids).size === ids.length, "component ids are duplicated");
  for (const rootId of requiredRootIds) invariant(ids.includes(rootId), `required root component is missing: ${rootId}`);
  return Object.freeze(validated.map(component => Object.freeze(structuredClone(component))));
};

const applyMessage = ({ catalog, catalogId, componentLimit, draft, message, requiredRootIds, surfaceId }) => {
  const kind = kindOf(message);
  if (kind === "createSurface") {
    const value = message.createSurface;
    invariant(isPlainObject(value), "createSurface must be an object");
    invariant(!draft.created, "surface is already created");
    invariant(value.surfaceId === surfaceId, `surfaceId must be ${surfaceId}`);
    invariant(value.catalogId === catalogId, `catalogId must be ${catalogId}`);
    invariant(Object.keys(value).every(key => ["catalogId", "sendDataModel", "surfaceId"].includes(key)), "createSurface fields are invalid");
    if (value.sendDataModel !== undefined) invariant(typeof value.sendDataModel === "boolean", "sendDataModel must be boolean");
    draft.created = true;
    draft.deleted = false;
    return;
  }
  invariant(draft.created && !draft.deleted, "surface must be created before updates");
  if (kind === "deleteSurface") {
    const value = message.deleteSurface;
    invariant(isPlainObject(value) && value.surfaceId === surfaceId, "deleteSurface target is invalid");
    invariant(Object.keys(value).length === 1, "deleteSurface fields are invalid");
    draft.deleted = true;
    draft.components = Object.freeze([]);
    draft.dataModel = Object.freeze({});
    return;
  }
  if (kind === "updateDataModel") {
    const value = message.updateDataModel;
    invariant(isPlainObject(value) && value.surfaceId === surfaceId, "data model target is invalid");
    invariant(Object.keys(value).every(key => ["path", "surfaceId", "value"].includes(key)), "updateDataModel fields are invalid");
    draft.dataModel = Object.freeze(setAtPointer(draft.dataModel, value.path, value.value));
    return;
  }
  const value = message.updateComponents;
  invariant(isPlainObject(value) && value.surfaceId === surfaceId, "component target is invalid");
  invariant(Object.keys(value).every(key => ["components", "surfaceId"].includes(key)), "updateComponents fields are invalid");
  draft.components = validateComponents({ catalog, components: value.components, componentLimit, requiredRootIds });
};

export const createIncrementalSurfaceRuntime = ({
  catalog = createBaseCatalog(),
  catalogId = catalog.id,
  componentLimit = 512,
  document,
  eventTarget,
  mount,
  onAction = () => {},
  requiredRootIds = ["root"],
  rootId = requiredRootIds[0],
  surfaceId = "main",
} = {}) => {
  invariant(catalog && typeof catalog.validateComponent === "function" && typeof catalog.renderComponent === "function", "trusted catalog is required");
  invariant(typeof catalogId === "string" && catalogId.length > 0, "catalogId is required");
  invariant(Number.isSafeInteger(componentLimit) && componentLimit > 0, "componentLimit is invalid");
  invariant(document && typeof document.createElement === "function", "document is required");
  invariant(mount && typeof mount.replaceChildren === "function", "mount is required");
  invariant(Array.isArray(requiredRootIds) && requiredRootIds.length > 0, "requiredRootIds are required");
  invariant(new Set(requiredRootIds).size === requiredRootIds.length, "requiredRootIds contain duplicates");
  invariant(requiredRootIds.includes(rootId), "rootId must be one of requiredRootIds");
  invariant(typeof surfaceId === "string" && surfaceId.length > 0, "surfaceId is required");

  let state = Object.freeze({
    components: Object.freeze([]),
    created: false,
    dataModel: Object.freeze({}),
    deleted: false,
    revision: 0,
  });
  let rendered = null;

  const apply = input => {
    invariant(Array.isArray(input) && input.length > 0, "messages are required");
    const draft = {
      components: state.components,
      created: state.created,
      dataModel: state.dataModel,
      deleted: state.deleted,
    };
    for (const message of input) applyMessage({ catalog, catalogId, componentLimit, draft, message, requiredRootIds, surfaceId });

    let nextRendered = rendered;
    if (draft.deleted) {
      mount.replaceChildren();
      nextRendered = null;
    } else if (draft.components.length > 0) {
      nextRendered = renderTrustedSurface({
        catalog,
        components: draft.components,
        dataModel: draft.dataModel,
        document,
        eventTarget,
        mount,
        onAction,
        rootId,
        surfaceId,
      });
    }
    state = Object.freeze({
      components: draft.components,
      created: draft.created,
      dataModel: draft.dataModel,
      deleted: draft.deleted,
      revision: state.revision + 1,
    });
    rendered = nextRendered;
    return Object.freeze({ rendered, state });
  };

  const push = message => apply([message]);
  const read = () => Object.freeze({ rendered, state });
  return Object.freeze({ apply, push, read });
};
