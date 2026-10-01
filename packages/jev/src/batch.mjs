// Worker-compatible named-choice transport. Application meaning stays with callers.
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const DEADLINE_MS = 10_000;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const finite = value => typeof value === "number" && Number.isFinite(value);

export class JudgeProviderError extends Error {
  constructor(code) { super(code); this.name = "JudgeProviderError"; this.code = code; }
}
const fail = code => { throw new JudgeProviderError(code); };
function requestBody(request) {
  try {
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
    const body = JSON.stringify({model:MODEL, state:request.state, questions});
    if (!object(JSON.parse(body).state)) fail("input_invalid");
    return body;
  } catch { fail("input_invalid"); }
}
function normalize(data, questions) {
  try {
    if (!object(data) || typeof data.model !== "string" || !object(data.answers)) fail("provider_contract_error");
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
    // A valid arbitrary provider model string is type-checked, then discarded.
    return {answers};
  } catch { fail("provider_contract_error"); }
}
export async function judgeNamedChoices({request, apiKey, fetch:fetchFn = globalThis.fetch, signal} = {}) {
  if (typeof apiKey !== "string" || !apiKey) fail("auth_missing");
  const body = requestBody(request);
  const questions = JSON.parse(body).questions;
  if (typeof fetchFn !== "function") fail("provider_unavailable");
  if (signal?.aborted) fail("cancelled");
  const controller = new AbortController();
  let timer, abort;
  const stopped = new Promise((_,reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new JudgeProviderError("provider_timeout")); }, DEADLINE_MS);
    abort = () => { controller.abort(); reject(new JudgeProviderError("cancelled")); };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort",abort,{once:true});
  });
  const call = (async () => {
    let response;
    try {
      response = await fetchFn(ENDPOINT,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body,signal:controller.signal});
    } catch { fail("provider_unavailable"); }
    if (!response?.ok) fail("provider_http_error");
    let data;
    try { data = await response.json(); } catch { fail("provider_invalid_response"); }
    return normalize(data,questions);
  })();
  try { return await Promise.race([stopped,call]); }
  catch (error) { if (error instanceof JudgeProviderError) throw error; fail("provider_contract_error"); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort",abort); }
}
