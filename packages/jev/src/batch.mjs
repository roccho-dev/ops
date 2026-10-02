// Worker-compatible named-choice transport. Application meaning stays with callers.
import { bindJev, JevTransportError } from "./core.mjs";
export { bindJev } from "./core.mjs";
const MODEL = "jev-latest";
const VERSION = /^jev-\d+\.\d+\.\d+$/;
const DEADLINE_MS = 10_000;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const finite = value => typeof value === "number" && Number.isFinite(value);

export class JudgeProviderError extends Error {
  constructor(code, upstreamStatus, diagnostic) {
    super(code); this.name = "JudgeProviderError"; this.code = code;
    if (code === "provider_http_error" && Number.isInteger(upstreamStatus) && upstreamStatus >= 300 && upstreamStatus <= 599) {
      this.upstreamStatus = upstreamStatus;
      if (upstreamStatus === 400 && diagnostic === "context-limit-vocabulary-observed") this.diagnostic = diagnostic;
    }
  }
}
const fail = (code, upstreamStatus, diagnostic) => { throw new JudgeProviderError(code, upstreamStatus, diagnostic); };
function requestBody(request, model, includeEvidence) {
  try {
    if (typeof model !== "string" || !model.trim() || typeof includeEvidence !== "boolean"
        || (includeEvidence && !VERSION.test(model))) fail("input_invalid");
    if (!object(request) || Object.keys(request).some(k => !["state", "questions"].includes(k))
        || !object(request.state) || !object(request.questions)) fail("input_invalid");
    const names = Object.keys(request.questions);
    if (!names.length) fail("input_invalid");
    const questions = Object.fromEntries(names.map(name => {
      const q = request.questions[name];
      if (!name || !object(q) || Object.keys(q).some(k => !["instruction", "options"].includes(k))
          || typeof q.instruction !== "string" || !q.instruction.trim() || !object(q.options)) fail("input_invalid");
      const keys = Object.keys(q.options);
      if (keys.length < 2 || keys.length > 255 || keys.some(k => !k || typeof q.options[k] !== "string")) fail("input_invalid");
      return [name, {type:"choice", criteria:{...q.options}, instructions:q.instruction}];
    }));
    const body = JSON.stringify({model, state:request.state, questions});
    if (!object(JSON.parse(body).state)) fail("input_invalid");
    return body;
  } catch { fail("input_invalid"); }
}
function normalize(data, questions, requestedModel, includeEvidence) {
  try {
    if (!object(data) || (!includeEvidence && typeof data.model !== "string") || !object(data.answers)) fail("provider_contract_error");
    const names = Object.keys(questions);
    if (Object.keys(data.answers).length !== names.length || names.some(k => !own(data.answers,k))) fail("provider_contract_error");
    const answers = Object.fromEntries(names.map(name => {
      const a = data.answers[name], options = questions[name].criteria;
      if (!object(a) || Object.keys(a).some(k => !["type","choice","confidence","probabilities"].includes(k))
          || a.type !== "choice" || typeof a.choice !== "string" || !own(options,a.choice)
          || !finite(a.confidence) || a.confidence < 0 || a.confidence > 1) fail("provider_contract_error");
      const normalized = {choice:a.choice, confidence:a.confidence};
      if (a.probabilities !== undefined) {
        if (!object(a.probabilities) || Object.entries(a.probabilities).some(([key,value]) => !own(options,key) || !finite(value))) fail("provider_contract_error");
        normalized.probabilities = {...a.probabilities};
      }
      return [name,normalized];
    }));
    // Default compatibility: type-check and discard the arbitrary model string.
    if (!includeEvidence) return {answers};
    // A typed answer is not erased merely because model evidence is unusable.
    // Version syntax/binding is not proof that a real model was executed.
    const present = own(data, "model");
    const usable = present && typeof data.model === "string" && VERSION.test(data.model);
    return {answers, evidence: {
      modelRequested: requestedModel,
      modelObserved: usable ? data.model : null,
      code: !present ? "model_missing" : !usable ? "model_unbound"
        : data.model !== requestedModel ? "model_mismatch" : null,
    }};
  } catch { fail("provider_contract_error"); }
}
export async function judgeNamedChoices({request, provider, signal, model = MODEL, includeEvidence = false} = {}) {
  if (!provider?.available) fail("auth_missing");
  const body = requestBody(request, model, includeEvidence);
  const questions = JSON.parse(body).questions;
  try {
    return normalize(await provider.post(JSON.parse(body), { signal, deadlineMs: DEADLINE_MS, diagnoseRejection: true }), questions, model, includeEvidence);
  } catch (error) {
    if (error instanceof JudgeProviderError) throw error;
    if (error instanceof JevTransportError) fail(error.code, error.status, error.diagnostic);
    fail("provider_contract_error");
  }
}
