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

async function fetchAndParseResponse(body, apiKey, fetchFn) {
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

  return data;
}

function validateNoulAnswer(answer) {
  if (answer?.type !== "noul") throw new JevContractError("noul answer type required");
  if (typeof answer?.noul !== "number") throw new JevContractError("noul must be number");
  if (!Number.isFinite(answer.noul)) throw new JevContractError("noul must be finite");
  if (answer.noul < 0 || answer.noul > 1) throw new JevContractError("noul must be in [0,1]");
  return answer.noul;
}

function validateChoiceAnswer(answer, expectedOptions) {
  if (answer?.type !== "choice") throw new JevContractError("choice answer type required");
  if (typeof answer?.choice !== "string") throw new JevContractError("choice must be string");
  if (!expectedOptions.includes(answer.choice)) throw new JevContractError("choice key must be in options");
  if (!answer?.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities)) {
    throw new JevContractError("probabilities must be object map");
  }
  const probKeys = Object.keys(answer.probabilities).sort();
  const expectedKeys = expectedOptions.slice().sort();
  if (probKeys.length !== expectedKeys.length || !probKeys.every((k, i) => k === expectedKeys[i])) {
    throw new JevContractError("probabilities keys must match options");
  }
  for (const [key, value] of Object.entries(answer.probabilities)) {
    if (typeof value !== "number") throw new JevContractError("probabilities values must be number");
    if (!Number.isFinite(value)) throw new JevContractError("probabilities values must be finite");
    if (value < 0 || value > 1) throw new JevContractError("probabilities values must be in [0,1]");
  }
  if (typeof answer?.confidence !== "number") throw new JevContractError("confidence must be number");
  if (!Number.isFinite(answer.confidence)) throw new JevContractError("confidence must be finite");
  if (answer.confidence < 0 || answer.confidence > 1) throw new JevContractError("confidence must be in [0,1]");
  return answer;
}

function validateScoreAnswer(answer, numLevels, criteria) {
  if (answer?.type !== "score") throw new JevContractError("score answer type required");
  if (typeof answer?.score !== "number") throw new JevContractError("score must be number");
  if (!Number.isFinite(answer.score)) throw new JevContractError("score must be finite");
  if (answer.score < 0 || answer.score > numLevels - 1) {
    throw new JevContractError("score must be in [0, levels-1]");
  }
  if (!answer?.legend || typeof answer.legend !== "object" || Array.isArray(answer.legend)) {
    throw new JevContractError("legend must be object map");
  }
  const expectedKeyStrings = Array.from({ length: numLevels }, (_, i) => String(i));
  const legendKeySet = new Set(Object.keys(answer.legend));
  const expectedKeySet = new Set(expectedKeyStrings);
  if (legendKeySet.size !== expectedKeySet.size || !expectedKeyStrings.every(k => legendKeySet.has(k))) {
    throw new JevContractError("legend keys must be exactly '0' to 'N-1'");
  }
  for (const [key, value] of Object.entries(answer.legend)) {
    if (typeof value !== "string") throw new JevContractError("legend values must be string");
    const idx = parseInt(key, 10);
    if (String(idx) !== key) throw new JevContractError("legend keys must be canonical string integers");
    if (criteria && criteria[idx] !== value) {
      throw new JevContractError("legend values must match criteria strings");
    }
  }
  if (!answer?.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities)) {
    throw new JevContractError("probabilities must be object map");
  }
  const probKeySet = new Set(Object.keys(answer.probabilities));
  if (probKeySet.size !== expectedKeySet.size || !expectedKeyStrings.every(k => probKeySet.has(k))) {
    throw new JevContractError("probabilities keys must be exactly '0' to 'N-1'");
  }
  for (const [key, value] of Object.entries(answer.probabilities)) {
    if (typeof value !== "number") throw new JevContractError("probabilities values must be number");
    if (!Number.isFinite(value)) throw new JevContractError("probabilities values must be finite");
    if (value < 0 || value > 1) throw new JevContractError("probabilities values must be in [0,1]");
    const idx = parseInt(key, 10);
    if (String(idx) !== key) throw new JevContractError("probabilities keys must be canonical string integers");
  }
  if (typeof answer?.confidence !== "number") throw new JevContractError("confidence must be number");
  if (!Number.isFinite(answer.confidence)) throw new JevContractError("confidence must be finite");
  if (answer.confidence < 0 || answer.confidence > 1) throw new JevContractError("confidence must be in [0,1]");
  return answer;
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

  const data = await fetchAndParseResponse(body, apiKey, fetchFn);
  const model = validateModel(data.model);
  const noul = validateNoulAnswer(data.answers?.live);

  return { model, noul };
}

export async function askJevChoice({ text, criteria, instructions, apiKey, fetch: injectedFetch }) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new JevError("input_invalid", "text must be non-empty string");
  }
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    throw new JevError("input_invalid", "criteria must be object");
  }
  const optionKeys = Object.keys(criteria);
  if (optionKeys.length < 2 || optionKeys.length > 255) {
    throw new JevError("input_invalid", "criteria must contain 2-255 options");
  }
  for (const [key, value] of Object.entries(criteria)) {
    if (typeof value !== "string") {
      throw new JevError("input_invalid", "criteria values must be strings");
    }
  }
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    throw new JevError("input_invalid", "instructions must be non-empty string");
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
        type: "choice",
        criteria,
        instructions,
      },
    },
  };

  const data = await fetchAndParseResponse(body, apiKey, fetchFn);
  const model = validateModel(data.model);
  const choice = validateChoiceAnswer(data.answers?.live, optionKeys);

  return { model, choice };
}

export async function askJevScore({ text, criteria, instructions, apiKey, fetch: injectedFetch }) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new JevError("input_invalid", "text must be non-empty string");
  }
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) {
    throw new JevError("input_invalid", "criteria must be array with 2-10 levels");
  }
  for (let i = 0; i < criteria.length; i++) {
    if (typeof criteria[i] !== "string") {
      throw new JevError("input_invalid", "criteria values must be strings");
    }
  }
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    throw new JevError("input_invalid", "instructions must be non-empty string");
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
        type: "score",
        criteria,
        instructions,
      },
    },
  };

  const data = await fetchAndParseResponse(body, apiKey, fetchFn);
  const model = validateModel(data.model);
  const score = validateScoreAnswer(data.answers?.live, criteria.length, criteria);

  return { model, score };
}
