// One per-target credential binding. Domain validation belongs to adapters.
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export class JevTransportError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "JevTransportError";
    this.code = code;
    this.status = status;
  }
}

export function bindJev({ apiKey, fetch: fetchFn = globalThis.fetch } = {}) {
  const available = typeof apiKey === "string" && apiKey.length > 0;
  return Object.freeze({
    available,
    async post(body, { signal, deadlineMs } = {}) {
      const fail = (code, status) => { throw new JevTransportError(code, status); };
      if (!available) fail("auth_missing");
      if (typeof fetchFn !== "function") fail("provider_unavailable");
      if (signal?.aborted) fail("cancelled");
      const controller = new AbortController();
      let timer, abort;
      const stopped = new Promise((_, reject) => {
        if (deadlineMs !== undefined) timer = setTimeout(() => {
          controller.abort();
          reject(new JevTransportError("provider_timeout"));
        }, deadlineMs);
        abort = () => { controller.abort(); reject(new JevTransportError("cancelled")); };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      const call = (async () => {
        let response;
        try {
          response = await fetchFn(ENDPOINT, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch { fail("provider_unavailable"); }
        if (!response?.ok) fail("provider_http_error", response?.status);
        try { return await response.json(); }
        catch { fail("provider_invalid_response"); }
      })();
      try { return await Promise.race([stopped, call]); }
      finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
  });
}
