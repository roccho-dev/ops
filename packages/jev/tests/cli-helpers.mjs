export function createFakeFetch(scenario) {
  return async (url, options) => {
    // Ensure fetch never calls the actual provider
    if (!url.includes("://api.typesafe.ai")) {
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
