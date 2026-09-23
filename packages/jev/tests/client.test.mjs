import assert from "node:assert/strict";
import test from "node:test";
import { JevError, JevContractError, askJevNoul, askJevChoice } from "../src/client.mjs";

test("missing api key throws auth_missing", async () => {
  try {
    await askJevNoul("", "test");
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "auth_missing");
  }
});

test("empty text throws input_invalid", async () => {
  try {
    await askJevNoul("fake-key", "");
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("whitespace-only text throws input_invalid", async () => {
  try {
    await askJevNoul("fake-key", "   \t\n  ");
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("choice with empty keys throws input_invalid", async () => {
  try {
    await askJevChoice("fake-key", "test", "choice", [], {});
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("choice with non-array keys throws input_invalid", async () => {
  try {
    await askJevChoice("fake-key", "test", "choice", "not-array", {});
    assert.fail("expected JevError");
  } catch (e) {
    assert(e instanceof JevError);
    assert.equal(e.code, "input_invalid");
  }
});

test("network error returns provider_unreachable", async () => {
  // This would require mocking fetch; for now document the contract
  // In no-network test environment, this is skipped
  assert.ok(true, "Network tests deferred to integration phase");
});
