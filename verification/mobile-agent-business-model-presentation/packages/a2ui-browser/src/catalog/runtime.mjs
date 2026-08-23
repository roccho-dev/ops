const invariant = (condition, message) => {
  if (!condition) throw new Error(`a2ui-catalog: ${message}`);
};

export const isPlainObject = value => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export const assertExactKeys = (value, required, optional, name) => {
  invariant(isPlainObject(value), `${name} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) invariant(Object.hasOwn(value, key), `${name}.${key} is required`);
  for (const key of Object.keys(value)) invariant(allowed.has(key), `${name}.${key} is not allowed`);
};

export const assertStringArray = (value, name) => {
  invariant(Array.isArray(value), `${name} must be an array`);
  invariant(value.every(item => typeof item === "string" && item.length > 0), `${name} must contain non-empty strings`);
  invariant(new Set(value).size === value.length, `${name} contains duplicates`);
};

const normalizeDefinition = definition => {
  invariant(isPlainObject(definition), "component definition must be a plain object");
  invariant(typeof definition.name === "string" && definition.name.length > 0, "component definition name is required");
  invariant(typeof definition.validate === "function", `${definition.name}.validate is required`);
  invariant(typeof definition.render === "function", `${definition.name}.render is required`);
  return Object.freeze({ name: definition.name, render: definition.render, validate: definition.validate });
};

export const createTrustedCatalog = ({ definitions, id }) => {
  invariant(typeof id === "string" && id.length > 0, "catalog id is required");
  invariant(Array.isArray(definitions) && definitions.length > 0, "catalog definitions are required");
  const normalized = Object.freeze(definitions.map(normalizeDefinition));
  const byName = new Map();
  for (const definition of normalized) {
    invariant(!byName.has(definition.name), `duplicate component definition ${definition.name}`);
    byName.set(definition.name, definition);
  }
  const catalog = {
    components: Object.freeze(normalized.map(({ name }) => Object.freeze({ name }))),
    definitions: normalized,
    id,
    renderComponent: ({ component, ...context }) => {
      const definition = byName.get(component.component);
      invariant(definition, `component ${component.component} is not trusted`);
      return definition.render({ component, ...context });
    },
    validateComponent: value => {
      invariant(isPlainObject(value), "component must be a plain object");
      invariant(typeof value.id === "string" && value.id.length > 0, "component.id is invalid");
      invariant(typeof value.component === "string" && value.component.length > 0, "component.component is invalid");
      const definition = byName.get(value.component);
      invariant(definition, `component ${value.component} is not trusted`);
      return Object.freeze(structuredClone(definition.validate(value)));
    },
  };
  return Object.freeze(catalog);
};

export const extendTrustedCatalog = ({ base, definitions, id }) => {
  invariant(base && Array.isArray(base.definitions), "base catalog is invalid");
  return createTrustedCatalog({ definitions: [...base.definitions, ...definitions], id });
};
