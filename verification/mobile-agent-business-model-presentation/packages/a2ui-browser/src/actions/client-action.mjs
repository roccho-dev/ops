import { A2UI_SPEC_VERSION } from "../catalog/base.mjs";

const invariant = (condition, message) => { if (!condition) throw new Error(`a2ui-action: ${message}`); };

export const createClientAction = ({ action, context, sourceComponentId, surfaceId = "main" }) => {
  invariant(typeof action === "string" && action.length > 0, "action is required");
  invariant(context && typeof context === "object" && !Array.isArray(context), "context is required");
  invariant(typeof sourceComponentId === "string" && sourceComponentId.length > 0, "sourceComponentId is required");
  invariant(typeof surfaceId === "string" && surfaceId.length > 0, "surfaceId is invalid");
  return Object.freeze({ action, context: structuredClone(context), sourceComponentId, surfaceId, version: A2UI_SPEC_VERSION });
};

export const emitClientAction = ({ target, detail }) => {
  invariant(target && typeof target.dispatchEvent === "function", "event target is required");
  const event = typeof CustomEvent === "function"
    ? new CustomEvent("a2ui-client-action", { detail })
    : Object.freeze({ detail, type: "a2ui-client-action" });
  target.dispatchEvent(event);
  return detail;
};
