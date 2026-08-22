import { assertExactKeys, assertStringArray, createTrustedCatalog, isPlainObject } from "./runtime.mjs";

export const A2UI_MESSAGE_VERSION = "v0.9";
export const A2UI_SPEC_VERSION = "v0.9.1";
export const BASE_CATALOG_ID = "urn:roccho:a2ui:catalog:base:1";
export const BASE_COMPONENT_NAMES = Object.freeze(["Button", "Card", "Column", "Divider", "Text"]);

const invariant = (condition, message) => {
  if (!condition) throw new Error(`a2ui-catalog: ${message}`);
};

const definitions = [
  {
    name: "Text",
    validate: component => {
      assertExactKeys(component, ["component", "id", "text"], ["variant"], "Text");
      invariant(typeof component.text === "string", "Text.text must be a string");
      if (component.variant !== undefined) invariant(["body", "caption", "h1", "h2"].includes(component.variant), "Text.variant is unsupported");
      return component;
    },
    render: ({ component, document }) => {
      const tag = component.variant === "h1" ? "h1" : component.variant === "h2" ? "h2" : component.variant === "caption" ? "small" : "p";
      const element = document.createElement(tag);
      element.textContent = component.text;
      return element;
    },
  },
  {
    name: "Column",
    validate: component => {
      assertExactKeys(component, ["children", "component", "id"], ["gap"], "Column");
      assertStringArray(component.children, "Column.children");
      if (component.gap !== undefined) invariant(Number.isFinite(component.gap) && component.gap >= 0, "Column.gap must be non-negative");
      return component;
    },
    render: ({ component, document, renderChild }) => {
      const element = document.createElement("div");
      element.setAttribute("data-gap", String(component.gap ?? 0));
      for (const child of component.children) element.append(renderChild(child));
      return element;
    },
  },
  {
    name: "Card",
    validate: component => {
      assertExactKeys(component, ["children", "component", "id"], [], "Card");
      assertStringArray(component.children, "Card.children");
      return component;
    },
    render: ({ component, document, renderChild }) => {
      const element = document.createElement("section");
      for (const child of component.children) element.append(renderChild(child));
      return element;
    },
  },
  {
    name: "Divider",
    validate: component => {
      assertExactKeys(component, ["component", "id"], [], "Divider");
      return component;
    },
    render: ({ document }) => document.createElement("hr"),
  },
  {
    name: "Button",
    validate: component => {
      assertExactKeys(component, ["action", "component", "context", "id", "label"], [], "Button");
      invariant(typeof component.label === "string" && component.label.length > 0, "Button.label is invalid");
      invariant(typeof component.action === "string" && component.action.length > 0, "Button.action is invalid");
      invariant(isPlainObject(component.context), "Button.context must be a plain object");
      return component;
    },
    render: ({ component, document, emitAction }) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = component.label;
      element.addEventListener("click", () => emitAction({ action: component.action, context: component.context }));
      return element;
    },
  },
];

const BASE_CATALOG = createTrustedCatalog({ definitions: [...definitions].sort((left, right) => BASE_COMPONENT_NAMES.indexOf(left.name) - BASE_COMPONENT_NAMES.indexOf(right.name)), id: BASE_CATALOG_ID });

export const createBaseCatalog = () => BASE_CATALOG;
export const validateComponent = value => BASE_CATALOG.validateComponent(value);
