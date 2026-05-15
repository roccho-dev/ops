# CDP Error Catalog

Error codes returned by CDP helper scripts (`lib.mjs`).

## Error Code Index

| Code | Meaning | Doc |
|------|---------|-----|
| `BROWSER_NOT_RUNNING` | Chrome browser is not started | [#BROWSER_NOT_RUNNING](#BROWSER_NOT_RUNNING) |
| `CDP_UNAVAILABLE` | CDP port is not responding | [#CDP_UNAVAILABLE](#CDP_UNAVAILABLE) |
| `TARGET_NOT_FOUND` | Requested tab URL is not open | [#TARGET_NOT_FOUND](#TARGET_NOT_FOUND) |
| `TAB_NOT_CONNECTED` | Tab exists but WebSocket URL is invalid | [#TAB_NOT_CONNECTED](#TAB_NOT_CONNECTED) |
| `LOGIN_REQUIRED` | ChatGPT login required | [#LOGIN_REQUIRED](#LOGIN_REQUIRED) |
| `PAGE_LOADING` | Page is still loading | [#PAGE_LOADING](#PAGE_LOADING) |
| `PAGE_BLOCKED` | Page access is blocked | [#PAGE_BLOCKED](#PAGE_BLOCKED) |
| `GENERATING` | GPT is generating a response | [#GENERATING](#GENERATING) |
| `RATE_LIMITED` | ChatGPT rate limit exceeded | [#RATE_LIMITED](#RATE_LIMITED) |
| `SESSION_EXPIRED` | ChatGPT session has expired | [#SESSION_EXPIRED](#SESSION_EXPIRED) |
| `TIMEOUT` | Operation timed out | [#TIMEOUT](#TIMEOUT) |

---

## BROWSER_NOT_RUNNING

**Meaning**: Chrome browser is not running or not reachable.

**Detection**: `curl http://{addr}:{port}/json/version` fails with connection refused.

**Recovery**:
```bash
# Start Chromium with CDP
chromium-cdp

# Or headless mode
HQ_CHROME_HEADLESS=1 chromium-cdp
```

**Reference**: [ui_timeouts.md](./ui_timeouts.md)

---

## CDP_UNAVAILABLE

**Meaning**: Chrome is running but CDP port is not responding.

**Detection**: `curl http://{addr}:{port}/json/list` fails.

**Recovery**:
```bash
# Restart Chromium
pkill chromium
chromium-cdp
```

**Reference**: [ui_timeouts.md](./ui_timeouts.md)

---

## TARGET_NOT_FOUND

**Meaning**: No open tab matches the requested URL.

**Detection**: Tab with target URL not found in `/json/list` response.

**Recovery**:
```bash
# Open new tab with target URL
cdp-bridge new --url "https://chatgpt.com/c/<thread-id>"
```

**Reference**: [ui_timeouts.md](./ui_timeouts.md)

---

## TAB_NOT_CONNECTED

**Meaning**: Tab exists but WebSocket debugger URL is null or expired.

**Detection**: Tab found but `webSocketDebuggerUrl` is empty/expired.

**Recovery**:
```bash
# Close the stale tab and open a fresh one
cdp-bridge close --id <tab-id>
cdp-bridge new --url <target-url>
```

---

## LOGIN_REQUIRED

**Meaning**: ChatGPT login is required (login form detected in DOM).

**Detection**: `document.querySelector('form[action*="login"]')` returns element.

**Recovery**:
```bash
# 1. Open ChatGPT in browser
# 2. Complete login manually (one-time)
# 3. Profile can be snapshotted for headless reuse
```

**Reference**: Profile bootstrap in [chrome service](../chrome/README.md)

---

## PAGE_LOADING

**Meaning**: Page `readyState` is not yet `"complete"`.

**Detection**: `document.readyState !== "complete"`.

**Recovery**:
```bash
# Increase wait time
--waitMs 30000
```

---

## PAGE_BLOCKED

**Meaning**: Page access is blocked (e.g., `ERR_BLOCKED_BY_ADMINISTRATOR`).

**Detection**: Navigation or evaluation returns blocking error.

**Recovery**:
```bash
# Check administrator/network restrictions
# Try with fresh profile
chromium-cdp --user-data-dir=/new/profile
```

---

## GENERATING

**Meaning**: GPT is currently generating a response (stop button visible).

**Detection**: Stop button element found in DOM.

**Recovery**:
```bash
# Wait for generation to complete
# Or click stop button and retry
```

---

## RATE_LIMITED

**Meaning**: ChatGPT rate limit exceeded (HTTP 429).

**Detection**: Response contains 429 status.

**Recovery**:
```bash
# Wait and retry after some time
# Consider using slower polling
```

---

## SESSION_EXPIRED

**Meaning**: ChatGPT session has expired (authentication error).

**Detection**: 401 response or session-related error.

**Recovery**:
```bash
# Re-login to ChatGPT
# Refresh profile snapshot
```

---

## TIMEOUT

**Meaning**: CDP operation did not complete within specified timeout.

**Detection**: Operation exceeded `timeout-ms` threshold.

**Recovery**:
```bash
# Increase timeout
--timeout-ms 60000
```

---

## Error Object Schema

```typescript
interface CdpError {
  code: string;           // e.g., "BROWSER_NOT_RUNNING"
  detail: string;         // Human-readable detail
  docRef: string;         // e.g., "cdp://docs/cdp-errors.md#BROWSER_NOT_RUNNING"
  hint?: string;          // Optional hint
  ok: false;              // Always false for errors
}
```

## Preflight Check Flow

See [cdp-preflight.md](./cdp-preflight.md) for detailed flow.
