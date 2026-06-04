// core/cdp-client: cdp-bridge 経由の CDP transport プリミティブ。ドメイン知識ゼロ。
import { runToString, sleepMs } from "./proc.mjs";

export function cdpBridgeJson(args) {
  const out = runToString(["cdp-bridge", ...args]);
  return JSON.parse(out);
}

export function cdpVersion(addr, port) {
  return cdpBridgeJson(["version", "--addr", addr, "--port", String(port)]);
}

export function cdpWsUrl(addr, port) {
  return runToString(["cdp-bridge", "wsurl", "--addr", addr, "--port", String(port)]).trim();
}

export function cdpList(addr, port) {
  return cdpBridgeJson(["list", "--addr", addr, "--port", String(port)]);
}

export function cdpNew(addr, port, url) {
  return cdpBridgeJson(["new", "--addr", addr, "--port", String(port), "--url", url]);
}

export function cdpClose(addr, port, id) {
  return cdpBridgeJson(["close", "--addr", addr, "--port", String(port), "--id", id]);
}

export function cdpCall(wsUrl, reqObj, timeoutMs) {
  const argv = ["call", "--ws", wsUrl, "--req", JSON.stringify(reqObj)];
  if (timeoutMs !== undefined && timeoutMs !== null) {
    argv.push("--timeout-ms", String(timeoutMs));
  }
  return cdpBridgeJson(argv);
}

export function cdpEvaluate(wsUrl, expression, opts) {
  const o = opts || {};
  const req = {
    id: o.id || 1,
    method: "Runtime.evaluate",
    params: {
      expression,
      returnByValue: o.returnByValue !== false,
      awaitPromise: o.awaitPromise === true,
    },
  };
  return cdpCall(wsUrl, req, o.timeoutMs || 60000);
}

export function mkCaller(wsUrl) {
  let nextId = 1;
  const shouldRetry = (e) => String(e || "").includes("WouldBlock");
  const withRetry = (fn) => {
    let last = null;
    for (let i = 0; i < 4; i++) {
      try {
        return fn();
      } catch (e) {
        last = e;
        if (!shouldRetry(e) || i === 3) throw e;
        sleepMs(150 + i * 200);
      }
    }
    throw last || new Error("retry failed");
  };

  const call = (method, params, timeoutMs) => {
    const req = { id: nextId++, method, params: params || {} };
    return withRetry(() => cdpCall(wsUrl, req, timeoutMs || 60000));
  };

  const evalDetailed = (expression, opts) => {
    const o = opts || {};
    const req = {
      id: nextId++,
      method: "Runtime.evaluate",
      params: {
        expression,
        returnByValue: true,
        awaitPromise: !!o.awaitPromise,
      },
    };
    const resp = withRetry(() => cdpCall(wsUrl, req, o.timeoutMs || 60000));
    const result = resp && resp.result ? resp.result : null;
    const remoteObject = result && result.result ? result.result : null;
    const hasValue = !!(remoteObject && Object.prototype.hasOwnProperty.call(remoteObject, "value"));
    const value = hasValue ? remoteObject.value : undefined;
    const exceptionDetails = result && result.exceptionDetails ? result.exceptionDetails : null;
    return { resp, hasValue, value, remoteObject, exceptionDetails };
  };

  const evalValue = (expression, opts) => {
    const details = evalDetailed(expression, opts);
    return details.hasValue ? details.value : null;
  };

  return { call, evalValue, evalDetailed };
}

export function pollUntil(fn, opts) {
  const o = opts || {};
  const timeoutMs = Math.max(0, Number(o.timeoutMs) || 0);
  const pollMs = Math.max(1, Number(o.pollMs) || 200);
  const label = String(o.label || "condition");
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (true) {
    try {
      const value = fn();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }

    if (Date.now() >= deadline) break;
    sleepMs(pollMs);
  }

  if (lastError) {
    throw new Error(`timeout waiting for ${label}: ${String(lastError && lastError.message ? lastError.message : lastError)}`);
  }
  throw new Error(`timeout waiting for ${label}`);
}
