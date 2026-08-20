import assert from "node:assert/strict";
import { createArtifactAppController } from "../runtime/controller.mjs";

const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const validateArtifactInvocation = value => {
  if (value?.schema !== "artifact-invocation/2") throw new Error("request.schema must be artifact-invocation/2");
  if (typeof value.id !== "string") throw new Error("request.id is invalid");
  if (typeof value.intent !== "string") throw new Error("request.intent is invalid");
  if (!Array.isArray(value.inputs)) throw new Error("request.inputs is invalid");
  assert.deepEqual(value.constraints, { allowedRuntimes: ["browser"], noUpload: true });
  return freeze(structuredClone(value));
};
const createUrlModuleUrl = async ({ base, fragment, value }) => {
  const url = new URL(base);
  url.hash = `${fragment}=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
  return url.href;
};
const readUrlModule = async ({ fragment, input }) => {
  const url = new URL(input);
  const token = new URLSearchParams(url.hash.slice(1)).get(fragment);
  return token === null ? null : JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
};
const request = id => ({
  constraints: { allowedRuntimes: ["browser"], noUpload: true },
  id,
  inputs: [],
  intent: "render",
  schema: "artifact-invocation/2",
});
const stateA = request("request.state-a");
const stateB = request("request.state-b");
const app = {
  action: { contextSchema: "artifact-app-action/1", event: "a2ui-client-action", history: "push", name: "artifact.invoke", version: "v0.9.1" },
  codec: { fragment: "invoke", invocationSchema: "artifact-invocation/2" },
  defaultInvocation: stateA,
  id: "artifact-runtime.interactive",
  schema: "artifact-app/1",
  sourceAuthorities: [{ repository: "roccho-dev/ui" }, { repository: "roccho-dev/ops" }],
  title: "Interactive Artifact Runtime",
  version: "1",
};
const listeners = new Map();
const historyCalls = [];
const scope = {
  addEventListener(name, listener) { listeners.set(name, listener); },
  removeEventListener(name) { listeners.delete(name); },
  history: {
    pushState(state, _title, href) { historyCalls.push({ kind: "push", state, url: String(href) }); scope.location.href = String(href); },
    replaceState(state, _title, href) { historyCalls.push({ kind: "replace", state, url: String(href) }); scope.location.href = String(href); },
  },
  location: { href: "https://example.invalid/app/" },
};
const executed = [];
const shell = { execute: async value => {
  const invocation = validateArtifactInvocation(value);
  executed.push(invocation.id);
  return freeze({ result: { status: "PASS" }, request: invocation });
} };
const controller = createArtifactAppController({ app, createUrlModuleUrl, readUrlModule, scope, shell, validateArtifactInvocation });

assert.deepEqual([...listeners.keys()].sort(), ["a2ui-client-action", "popstate"]);
assert.equal((await controller.boot()).id, stateA.id);
assert.deepEqual(executed, [stateA.id]);
assert.equal(historyCalls.length, 1);
assert.equal(historyCalls[0].kind, "replace");
assert.equal((await controller.decode()).id, stateA.id);
assert.equal(await controller.encode(stateA), historyCalls[0].url);

const action = {
  action: "artifact.invoke",
  context: { nextInvocation: stateB, schema: "artifact-app-action/1" },
  sourceComponentId: "next",
  surfaceId: "main",
  version: "v0.9.1",
};
const applied = await controller.applyAction(action);
assert.equal(applied.next.id, stateB.id);
assert.equal(historyCalls.at(-1).kind, "push");
assert.equal((await controller.decode()).id, stateB.id);
assert.deepEqual(executed, [stateA.id, stateB.id]);
assert.equal(scope.artifactAppProof.fromRequestId, stateA.id);
assert.equal(scope.artifactAppProof.nextRequestId, stateB.id);
assert.equal(scope.artifactAppProof.status, "PASS");

const previousUrl = historyCalls[0].url;
scope.location.href = previousUrl;
listeners.get("popstate")({ type: "popstate" });
await new Promise(resolve => setImmediate(resolve));
assert.equal(executed.at(-1), stateA.id);

const callCount = historyCalls.length;
await assert.rejects(controller.applyAction({ ...action, version: "v9.9.9" }), /action.version/);
assert.equal(historyCalls.length, callCount);
await assert.rejects(controller.applyAction({ ...action, context: { ...action.context, extra: true } }), /not allowed/);
assert.equal(historyCalls.length, callCount);
await assert.rejects(controller.applyAction({ ...action, context: { ...action.context, nextInvocation: { id: "bad" } } }), /schema/);
assert.equal(historyCalls.length, callCount);

controller.dispose();
assert.equal(listeners.size, 0);
await assert.rejects(controller.applyAction(action), /disposed/);
console.log(JSON.stringify({ schema: "artifact-app-controller-test/1", status: "PASS", positive: 8, negative: 4 }));
