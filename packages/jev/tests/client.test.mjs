import assert from "node:assert/strict";
import test from "node:test";
import { JevError, JevContractError, askJevNoul } from "../src/client.mjs";

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
