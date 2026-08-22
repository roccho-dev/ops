export {
  A2UI_MESSAGE_VERSION,
  A2UI_SPEC_VERSION,
  BASE_CATALOG_ID,
  BASE_COMPONENT_NAMES,
  createBaseCatalog,
  validateComponent,
} from "./catalog/base.mjs";
export {
  assertExactKeys,
  assertStringArray,
  createTrustedCatalog,
  extendTrustedCatalog,
  isPlainObject,
} from "./catalog/runtime.mjs";
export { validateMessageBatch } from "./catalog/messages.mjs";
export { createClientAction, emitClientAction } from "./actions/client-action.mjs";
export { renderTrustedSurface } from "./render/trusted-dom.mjs";

import { createBaseCatalog } from "./catalog/base.mjs";
export const createBaseRuntime = () => {
  const catalog = createBaseCatalog();
  return Object.freeze({
    catalog,
    renderComponent: catalog.renderComponent,
    validateComponent: catalog.validateComponent,
  });
};
