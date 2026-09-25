import assert from "node:assert/strict";
import test from "node:test";
import { JevError, JevContractError, askJevNoul, askJevChoice, askJevScore } from "../src/client.mjs";

test("missing api key throws auth_missing", async () => {
  try {
    await askJevNoul({ text: "test", question: "Is this valid?", apiKey: "" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "auth_missing");
  }
});

test("empty text throws input_invalid", async () => {
  try {
    await askJevNoul({ text: "", question: "Is this valid?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("empty question throws input_invalid", async () => {
  try {
    await askJevNoul({ text: "test", question: "", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("success with fake fetch returns typed result", async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer test-key");
    assert.equal(options.headers["content-type"], "application/json");

    const body = JSON.parse(options.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.state, "test input");
    assert.deepEqual(body.questions, {
      live: { type: "noul", instructions: "Is this valid?" },
    });

    return {
      ok: true,
      json: async () => ({
        model: "jev-1.13.0",
        answers: { live: { type: "noul", noul: 0.75 } },
      }),
    };
  };

  const result = await askJevNoul({
    text: "test input",
    question: "Is this valid?",
    apiKey: "test-key",
    fetch: fakeFetch,
  });

  assert.deepEqual(result, { model: "jev-1.13.0", noul: 0.75 });
});

test("non-2xx response throws provider_error", async () => {
  const fakeFetch = async () => ({ ok: false, status: 500 });

  try {
    await askJevNoul({
      text: "test",
      question: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "provider_error");
  }
});

test("unparseable response throws provider_invalid_response", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => {
      throw new Error("invalid json");
    },
  });

  try {
    await askJevNoul({
      text: "test",
      question: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "provider_invalid_response");
  }
});

test("wrong noul type throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: { live: { type: "wrong", noul: 0.5 } },
    }),
  });

  try {
    await askJevNoul({
      text: "test",
      question: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("non-finite noul throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: { live: { type: "noul", noul: NaN } },
    }),
  });

  try {
    await askJevNoul({
      text: "test",
      question: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("out-of-range noul throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: { live: { type: "noul", noul: 1.5 } },
    }),
  });

  try {
    await askJevNoul({
      text: "test",
      question: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("fetch error throws provider_unreachable", async () => {
  const fakeFetch = async () => {
    throw new Error("network error");
  };

  try {
    await askJevNoul({
      text: "test",
      question: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "provider_unreachable");
  }
});

test("askJevChoice: fewer than 2 options throws input_invalid", async () => {
  try {
    await askJevChoice({ text: "test", criteria: { a: "option a" }, instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevChoice: more than 255 options throws input_invalid", async () => {
  const criteria = {};
  for (let i = 0; i < 256; i++) {
    criteria[String(i)] = `option ${i}`;
  }
  try {
    await askJevChoice({ text: "test", criteria, instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevChoice: non-object criteria throws input_invalid", async () => {
  try {
    await askJevChoice({ text: "test", criteria: "not-object", instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevChoice: non-string values throws input_invalid", async () => {
  try {
    await askJevChoice({ text: "test", criteria: { a: 123 }, instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevChoice: missing instructions throws input_invalid", async () => {
  try {
    await askJevChoice({ text: "test", criteria: { a: "opt a", b: "opt b" }, instructions: "", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevChoice: success with fake fetch returns typed result", async () => {
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.questions.live, {
      type: "choice",
      criteria: { a: "option a", b: "option b" },
      instructions: "Pick one",
    });

    return {
      ok: true,
      json: async () => ({
        model: "jev-1.13.0",
        answers: {
          live: {
            type: "choice",
            choice: "a",
            probabilities: { a: 0.8, b: 0.2 },
            confidence: 0.9,
          },
        },
      }),
    };
  };

  const result = await askJevChoice({
    text: "test input",
    criteria: { a: "option a", b: "option b" },
    instructions: "Pick one",
    apiKey: "test-key",
    fetch: fakeFetch,
  });

  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.choice.type, "choice");
  assert.equal(result.choice.choice, "a");
  assert.deepEqual(result.choice.probabilities, { a: 0.8, b: 0.2 });
  assert.equal(result.choice.confidence, 0.9);
});

test("askJevChoice: choice not in options throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "choice",
          choice: "z",
          probabilities: { a: 1 },
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevChoice({
      text: "test",
      criteria: { a: "option a", b: "option b" },
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("askJevChoice: probabilities not object map throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "choice",
          choice: "a",
          probabilities: [0.5, 0.5],
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevChoice({
      text: "test",
      criteria: { a: "option a", b: "option b" },
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("askJevScore: fewer than 2 levels throws input_invalid", async () => {
  try {
    await askJevScore({ text: "test", criteria: ["low"], instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevScore: more than 10 levels throws input_invalid", async () => {
  const criteria = Array.from({ length: 11 }, (_, i) => `level ${i}`);
  try {
    await askJevScore({ text: "test", criteria, instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevScore: non-array criteria throws input_invalid", async () => {
  try {
    await askJevScore({ text: "test", criteria: "not-array", instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevScore: non-string values throws input_invalid", async () => {
  try {
    await askJevScore({ text: "test", criteria: ["low", 123, "high"], instructions: "Q?", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevScore: missing instructions throws input_invalid", async () => {
  try {
    await askJevScore({ text: "test", criteria: ["low", "high"], instructions: "", apiKey: "key" });
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("askJevScore: success with fake fetch returns typed result", async () => {
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.questions.live, {
      type: "score",
      criteria: ["low", "medium", "high"],
      instructions: "Rate it",
    });

    return {
      ok: true,
      json: async () => ({
        model: "jev-1.13.0",
        answers: {
          live: {
            type: "score",
            score: 1.95,
            legend: { "0": "low", "1": "medium", "2": "high" },
            probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
            confidence: 0.88,
          },
        },
      }),
    };
  };

  const result = await askJevScore({
    text: "test input",
    criteria: ["low", "medium", "high"],
    instructions: "Rate it",
    apiKey: "test-key",
    fetch: fakeFetch,
  });

  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.score.type, "score");
  assert.equal(result.score.score, 1.95);
  assert.deepEqual(result.score.legend, { "0": "low", "1": "medium", "2": "high" });
  assert.deepEqual(result.score.probabilities, { "0": 0.1, "1": 0.2, "2": 0.7 });
  assert.equal(result.score.confidence, 0.88);
});

test("askJevScore: score not in [0, levels-1] throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "score",
          score: 2.5,
          legend: { "0": "low", "1": "high" },
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevScore({
      text: "test",
      criteria: ["low", "high"],
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("askJevScore: legend not object map throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "score",
          score: 0.5,
          legend: ["low", "high"],
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevScore({
      text: "test",
      criteria: ["low", "high"],
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("askJevScore: probabilities not object map throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "score",
          score: 0.5,
          legend: { "0": "low", "1": "high" },
          probabilities: [0.5, 0.5],
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevScore({
      text: "test",
      criteria: ["low", "high"],
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("official API example response for score (3 levels, score 1.05)", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.13.0",
      answers: {
        live: {
          type: "score",
          score: 1.05,
          legend: { "0": "low", "1": "medium", "2": "high" },
          probabilities: { "0": 0.1, "1": 0.85, "2": 0.05 },
          confidence: 0.92,
        },
      },
    }),
  });

  const result = await askJevScore({
    text: "test input",
    criteria: ["low", "medium", "high"],
    instructions: "Rate it",
    apiKey: "test-key",
    fetch: fakeFetch,
  });

  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.score.type, "score");
  assert.equal(result.score.score, 1.05);
  assert.deepEqual(result.score.legend, { "0": "low", "1": "medium", "2": "high" });
  assert.deepEqual(result.score.probabilities, { "0": 0.1, "1": 0.85, "2": 0.05 });
  assert.equal(result.score.confidence, 0.92);
});

test("askJevScore: alias key like '01' (leading zero) throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "score",
          score: 0.5,
          legend: { "01": "low", "1": "high" },
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevScore({
      text: "test",
      criteria: ["low", "high"],
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("askJevScore: alias key like '1e0' (scientific notation) throws contract_error", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "score",
          score: 0.5,
          legend: { "0": "low", "1e0": "high" },
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevScore({
      text: "test",
      criteria: ["low", "high"],
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});

test("askJevScore: legend values must match criteria strings", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.0",
      answers: {
        live: {
          type: "score",
          score: 0.5,
          legend: { "0": "wrong", "1": "high" },
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
        },
      },
    }),
  });

  try {
    await askJevScore({
      text: "test",
      criteria: ["low", "high"],
      instructions: "Q?",
      apiKey: "key",
      fetch: fakeFetch,
    });
    assert.fail("expected JevContractError");
  } catch (e) {
    assert(e instanceof JevContractError);
  }
});
