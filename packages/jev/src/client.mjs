// Generic Jev client: caller supplies text and question, we return typed result.
// Injected fetch allows testing without network.

const JEV_PROVIDER_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

export class JevError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "JevError";
  }
}

export class JevContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "JevContractError";
  }
}

function validateModel(value) {
  if (typeof value !== "string") throw new JevContractError("model must be string");
  return value;
}

function validateNoulAnswer(answer) {
  if (answer?.type !== "noul") throw new JevContractError("noul answer type required");
  if (typeof answer?.noul !== "number") throw new JevContractError("noul must be number");
  if (!Number.isFinite(answer.noul)) throw new JevContractError("noul must be finite");
  if (answer.noul < 0 || answer.noul > 1) throw new JevContractError("noul must be in [0,1]");
  return answer.noul;
}

export async function askJevNoul({ text, question, apiKey, fetch: injectedFetch }) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new JevError("input_invalid", "text must be non-empty string");
  }
  if (typeof question !== "string" || question.trim().length === 0) {
    throw new JevError("input_invalid", "question must be non-empty string");
  }
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new JevError("auth_missing", "JEV_API_KEY not provided or empty");
  }

  const fetchFn = injectedFetch || globalThis.fetch;
  const body = {
    model: JEV_MODEL,
    state: text,
    questions: {
      live: {
        type: "noul",
        instructions: question,
      },
    },
  };

  let response;
  try {
    response = await fetchFn(JEV_PROVIDER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new JevError("provider_unreachable", `Failed to reach provider: ${e.message}`);
  }

  if (!response.ok) {
    throw new JevError("provider_error", `Provider returned ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new JevError("provider_invalid_response", `Failed to parse provider response: ${e.message}`);
  }

  if (!data || typeof data !== "object") {
    throw new JevContractError("provider response must be object");
  }

  const model = validateModel(data.model);
  const noul = validateNoulAnswer(data.answers?.live);

  return { model, noul };
}
