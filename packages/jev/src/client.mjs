// Generic Jev client: caller supplies question, we return typed result.

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

function validateChoiceAnswer(answer, expectedKeys) {
  if (answer?.type !== "choice") throw new JevContractError("choice answer type required");
  if (typeof answer?.choice !== "string") throw new JevContractError("choice must be string");
  if (!expectedKeys.includes(answer.choice)) throw new JevContractError(`choice must be in ${JSON.stringify(expectedKeys)}`);
  if (typeof answer?.confidence !== "number") throw new JevContractError("confidence must be number");
  if (!Number.isFinite(answer.confidence)) throw new JevContractError("confidence must be finite");
  if (answer.confidence < 0 || answer.confidence > 1) throw new JevContractError("confidence must be in [0,1]");
  if (!answer.probabilities || typeof answer.probabilities !== "object") throw new JevContractError("probabilities must be object");
  Object.entries(answer.probabilities).forEach(([k, v]) => {
    if (!expectedKeys.includes(k)) throw new JevContractError(`probability key ${k} not in expected keys`);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new JevContractError(`probability ${k} must be finite number`);
  });
  return { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities };
}

export async function askJev(apiKey, question) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new JevError("auth_missing", "JEV_API_KEY not provided or empty");
  }

  let response;
  try {
    response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(question),
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

  return {
    model: validateModel(data.model),
    answers: data.answers,
  };
}

export async function askJevNoul(apiKey, text, instructions) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new JevError("input_invalid", "text must be non-empty string");
  }

  const question = {
    model: "jev-latest",
    state: text,
    questions: {
      live: {
        type: "noul",
        instructions: instructions || "Is this state valid?",
      },
    },
  };

  const { model, answers } = await askJev(apiKey, question);
  const noul = validateNoulAnswer(answers?.live);

  return { model, noul };
}

export async function askJevChoice(apiKey, text, choiceName, choiceKeys, instructions) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new JevError("input_invalid", "text must be non-empty string");
  }
  if (!Array.isArray(choiceKeys) || choiceKeys.length === 0) {
    throw new JevError("input_invalid", "choiceKeys must be non-empty array");
  }

  const criteria = Object.fromEntries(choiceKeys.map(k => [k, instructions?.[k] || k]));

  const question = {
    model: "jev-latest",
    state: text,
    questions: {
      [choiceName]: {
        type: "choice",
        instructions: instructions?.prompt || "Choose one",
        criteria,
      },
    },
  };

  const { model, answers } = await askJev(apiKey, question);
  const result = validateChoiceAnswer(answers?.[choiceName], choiceKeys);

  return { model, ...result };
}
