// One per-target credential binding. Domain validation belongs to adapters.
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export class JevTransportError extends Error {
  constructor(code, status, diagnostic) {
    super(code);
    this.name = "JevTransportError";
    this.code = code;
    this.status = status;
    if (code === "provider_http_error" && status === 400 && diagnostic === "context-limit-vocabulary-observed") this.diagnostic = diagnostic;
  }
}

export function bindJev({ apiKey, fetch: fetchFn = globalThis.fetch } = {}) {
  const available = typeof apiKey === "string" && apiKey.length > 0;
  return Object.freeze({
    available,
    async post(body, { signal, deadlineMs, diagnoseRejection } = {}) {
      const fail = (code, status, diagnostic) => { throw new JevTransportError(code, status, diagnostic); };
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
        if (!response?.ok) {
          let diagnostic;
          // Explicit named-choice opt-in only. Raw rejection bytes never leave
          // this bounded read; the constant observes words, not their meaning.
          if (response?.status === 400 && diagnoseRejection === true && deadlineMs !== undefined) {
            let reader, cancel, complete = false;
            try {
              reader = response.body?.getReader();
              if (reader) {
                let interrupt;
                let cancelled = false;
                const interrupted = new Promise(resolve => { interrupt = resolve; });
                cancel = () => {
                  if (cancelled) return;
                  cancelled = true;
                  interrupt({ interrupted: true });
                  try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
                };
                controller.signal.addEventListener("abort", cancel, { once: true });
                if (controller.signal.aborted) cancel();
                const chunks = [];
                let size = 0;
                while (!controller.signal.aborted) {
                  const { done, value, interrupted: stopped } = await Promise.race([reader.read(), interrupted]);
                  if (stopped) break;
                  if (done) { complete = true; break; }
                  if (!(value instanceof Uint8Array) || size + value.byteLength > 4096) { cancel(); break; }
                  size += value.byteLength; chunks.push(value);
                }
                if (complete && !controller.signal.aborted) {
                  const bytes = new Uint8Array(size);
                  let offset = 0;
                  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
                  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
                  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
                  if (object(parsed)) {
                    const texts = [parsed.detail, parsed.message, object(parsed.error) ? parsed.error.message : undefined];
                    if (texts.some(text => {
                      if (typeof text !== "string") return false;
                      const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
                      return words.includes("context") && (words.includes("length") || words.includes("limit"));
                    })) diagnostic = "context-limit-vocabulary-observed";
                  }
                }
              }
            } catch { /* Unsupported, unreadable or malformed diagnostics are omitted. */ }
            finally {
              if (!complete) cancel?.();
              if (cancel) controller.signal.removeEventListener("abort", cancel);
              try { reader?.releaseLock(); } catch {}
            }
          }
          fail("provider_http_error", response?.status, diagnostic);
        }
        try { return await response.json(); }
        catch { fail("provider_invalid_response"); }
      })();
      try { return await Promise.race([stopped, call]); }
      finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
  });
}
