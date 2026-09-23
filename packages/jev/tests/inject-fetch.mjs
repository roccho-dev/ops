import { createFakeFetch } from "./cli-helpers.mjs";

const scenario = process.env.TEST_FETCH_SCENARIO;
if (scenario) {
  globalThis.__TEST_FETCH__ = createFakeFetch(scenario);
}
