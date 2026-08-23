import { createBaseCatalog } from "../catalog/base.mjs";
import { createClientAction, emitClientAction } from "../actions/client-action.mjs";

const invariant = (condition, message) => { if (!condition) throw new Error(`a2ui-render: ${message}`); };

const validateGraph = (components, catalog, rootId) => {
  const index = new Map();
  for (const raw of components) {
    const component = catalog.validateComponent(raw);
    invariant(!index.has(component.id), `duplicate component ${component.id}`);
    index.set(component.id, component);
  }
  invariant(typeof rootId === "string" && index.has(rootId), `root component is missing: ${rootId}`);
  for (const component of index.values()) {
    for (const child of component.children ?? []) invariant(index.has(child), `component ${component.id} references missing ${child}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const walk = id => {
    invariant(!visiting.has(id), `component cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of index.get(id).children ?? []) walk(child);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of index.keys()) walk(id);
  return index;
};

export const renderTrustedSurface = ({
  catalog = createBaseCatalog(),
  components,
  dataModel = {},
  document,
  eventTarget,
  mount,
  onAction = () => {},
  rootId = "root",
  surfaceId = "main",
}) => {
  invariant(document && typeof document.createElement === "function", "document is required");
  invariant(mount && typeof mount.replaceChildren === "function", "mount is required");
  invariant(Array.isArray(components), "components are required");
  invariant(catalog && typeof catalog.renderComponent === "function", "catalog is required");
  invariant(typeof surfaceId === "string" && surfaceId.length > 0, "surfaceId is required");
  const index = validateGraph(components, catalog, rootId);
  const render = id => {
    const component = index.get(id);
    const dispatch = ({ action, context }) => {
      const detail = createClientAction({ action, context, sourceComponentId: component.id, surfaceId });
      onAction(detail);
      if (eventTarget) emitClientAction({ target: eventTarget, detail });
      return detail;
    };
    const element = catalog.renderComponent({ component, dataModel, document, emitAction: dispatch, renderChild: render, surfaceId });
    invariant(element && typeof element.setAttribute === "function", `component ${component.id} did not render an element`);
    element.setAttribute("data-a2ui-id", id);
    element.setAttribute("data-a2ui-component", component.component);
    return element;
  };
  const root = render(rootId);
  mount.replaceChildren(root);
  return Object.freeze({ componentCount: index.size, root, rootId, surfaceId });
};
