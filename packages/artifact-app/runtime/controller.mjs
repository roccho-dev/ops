const invariant = (condition, message) => { if (!condition) throw new Error(`artifact-app: ${message}`); };
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, required, optional, name) => {
  invariant(plain(value), `${name} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) invariant(Object.hasOwn(value, key), `${name}.${key} is required`);
  for (const key of Object.keys(value)) invariant(allowed.has(key), `${name}.${key} is not allowed`);
};

const normalizeApp = (value, validateArtifactInvocation) => {
  exactKeys(value, ["action", "codec", "defaultInvocation", "id", "schema", "sourceAuthorities", "title", "version"], ["fixtures", "interfaces", "runtime"], "app");
  invariant(value.schema === "artifact-app/1", "app.schema is unsupported");
  invariant(typeof value.id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value.id), "app.id is invalid");
  invariant(typeof value.version === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.version), "app.version is invalid");
  invariant(typeof value.title === "string" && value.title.length > 0, "app.title is invalid");
  exactKeys(value.codec, ["fragment", "invocationSchema"], [], "app.codec");
  invariant(value.codec.fragment === "invoke", "app.codec.fragment must be invoke");
  invariant(value.codec.invocationSchema === "artifact-invocation/2", "app.codec.invocationSchema is unsupported");
  exactKeys(value.action, ["contextSchema", "event", "history", "name", "version"], [], "app.action");
  invariant(value.action.event === "a2ui-client-action", "app.action.event is unsupported");
  invariant(value.action.name === "artifact.invoke", "app.action.name is unsupported");
  invariant(value.action.contextSchema === "artifact-app-action/1", "app.action.contextSchema is unsupported");
  invariant(value.action.history === "push", "app.action.history is unsupported");
  invariant(/^v[0-9]+\.[0-9]+\.[0-9]+$/u.test(value.action.version), "app.action.version is unsupported");
  invariant(Array.isArray(value.sourceAuthorities) && value.sourceAuthorities.length >= 2, "app.sourceAuthorities must contain at least two sources");
  return Object.freeze({ ...value, defaultInvocation: validateArtifactInvocation(value.defaultInvocation) });
};

const normalizeAction = (detail, app, validateArtifactInvocation) => {
  exactKeys(detail, ["action", "context", "sourceComponentId", "surfaceId", "version"], [], "action");
  invariant(detail.action === app.action.name, `action.action must be ${app.action.name}`);
  invariant(typeof detail.sourceComponentId === "string" && detail.sourceComponentId.length > 0, "action.sourceComponentId is invalid");
  invariant(typeof detail.surfaceId === "string" && detail.surfaceId.length > 0, "action.surfaceId is invalid");
  invariant(detail.version === app.action.version, `action.version must be ${app.action.version}`);
  exactKeys(detail.context, ["nextInvocation", "schema"], [], "action.context");
  invariant(detail.context.schema === app.action.contextSchema, "action.context.schema is unsupported");
  return validateArtifactInvocation(detail.context.nextInvocation);
};

export const createArtifactAppController = ({
  app: appInput,
  createUrlModuleUrl,
  readUrlModule,
  scope = globalThis,
  shell,
  validateArtifactInvocation,
}) => {
  invariant(typeof createUrlModuleUrl === "function", "createUrlModuleUrl is required");
  invariant(typeof readUrlModule === "function", "readUrlModule is required");
  invariant(typeof validateArtifactInvocation === "function", "validateArtifactInvocation is required");
  invariant(shell && typeof shell.execute === "function", "shell.execute is required");
  invariant(scope?.history && typeof scope.history.pushState === "function" && typeof scope.history.replaceState === "function", "History API is required");
  invariant(scope?.location && typeof scope.location.href === "string", "location is required");
  invariant(typeof scope.addEventListener === "function", "event target is required");
  const app = normalizeApp(appInput, validateArtifactInvocation);
  let disposed = false;
  let sequence = Promise.resolve();

  const encode = async (invocation, base = scope.location.href) => createUrlModuleUrl({
    base,
    fragment: app.codec.fragment,
    value: validateArtifactInvocation(invocation),
  });

  const decode = async (input = scope.location.href) => {
    const value = await readUrlModule({ fragment: app.codec.fragment, input });
    return value === null ? null : validateArtifactInvocation(value);
  };

  const execute = async invocation => shell.execute(validateArtifactInvocation(invocation));

  const recordProof = value => {
    scope.artifactAppProof = Object.freeze(value);
    return scope.artifactAppProof;
  };

  const fail = error => {
    const message = String(error?.message ?? error);
    const status = scope.document?.querySelector?.("#status");
    if (status) {
      status.dataset.state = "inconclusive";
      status.textContent = `INCONCLUSIVE · ${message}`;
    }
    recordProof({ app: `${app.id}@${app.version}`, error: message, schema: "artifact-app-proof/1", status: "INCONCLUSIVE" });
    throw error;
  };

  const applyActionNow = async detail => {
    invariant(!disposed, "controller is disposed");
    const previous = await decode(scope.location.href);
    const next = normalizeAction(detail, app, validateArtifactInvocation);
    const url = await encode(next);
    scope.history.pushState(Object.freeze({ app: `${app.id}@${app.version}`, requestId: next.id, schema: "artifact-app-history/1" }), "", url);
    const outcome = await execute(next);
    recordProof({
      action: detail.action,
      app: `${app.id}@${app.version}`,
      fromRequestId: previous?.id ?? null,
      nextRequestId: next.id,
      outcome,
      schema: "artifact-app-proof/1",
      status: outcome?.result?.status ?? "INCONCLUSIVE",
      url,
    });
    return Object.freeze({ next, outcome, url });
  };

  const applyAction = detail => {
    const pending = sequence.then(() => applyActionNow(detail));
    sequence = pending.catch(() => undefined);
    return pending.catch(fail);
  };

  const onAction = event => { applyAction(event.detail).catch(() => undefined); };
  const onPopState = () => {
    const pending = sequence.then(async () => {
      const request = await decode(scope.location.href);
      if (request) await execute(request);
      return request;
    });
    sequence = pending.catch(() => undefined);
    pending.catch(fail);
  };
  scope.addEventListener(app.action.event, onAction);
  scope.addEventListener("popstate", onPopState);

  const boot = async () => {
    const current = await decode(scope.location.href);
    if (current) return current;
    const initial = app.defaultInvocation;
    const url = await encode(initial);
    scope.history.replaceState(Object.freeze({ app: `${app.id}@${app.version}`, requestId: initial.id, schema: "artifact-app-history/1" }), "", url);
    await execute(initial);
    return initial;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scope.removeEventListener?.(app.action.event, onAction);
    scope.removeEventListener?.("popstate", onPopState);
  };

  return Object.freeze({ app, applyAction, boot, decode, dispose, encode, execute });
};
