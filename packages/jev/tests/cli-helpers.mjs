export function createFakeFetch(scenario) {
  return async (url, options) => {
    // Guard against unexpected provider calls
    if (!url.includes("https://api.typesafe.ai/v1/systemone")) {
      throw new Error("Fetch called with unexpected URL: " + url);
    }

    if (scenario === "success") {
      return {
        ok: true,
        json: async () => ({
          model: "jev-1.13.0",
          answers: { live: { type: "noul", noul: 0.75 } },
        }),
      };
    } else if (scenario === "success_choice") {
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
    } else if (scenario === "success_score") {
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
    } else if (scenario === "provider_error") {
      return {
        ok: false,
        status: 500,
      };
    } else if (scenario === "contract_error") {
      return {
        ok: true,
        json: async () => ({
          model: "jev-1.0",
          answers: { live: { type: "noul", noul: NaN } },
        }),
      };
    } else if (scenario === "fetch_throws") {
      throw new Error("Network error: simulated provider unreachable");
    }

    throw new Error("Unknown scenario: " + scenario);
  };
}
