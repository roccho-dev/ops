# CDP Preflight Check Flow

Preflight checks run before any CDP operation to provide clear error guidance.

## Check Sequence

```
preflightCheck(addr, port, targetUrl)
│
├─ Step 1: Browser Running?
│   └─ curl http://{addr}:{port}/json/version
│       ├─ FAIL → CdpError("BROWSER_NOT_RUNNING")
│       └─ PASS → Step 2
│
├─ Step 2: CDP Available?
│   └─ curl http://{addr}:{port}/json/list
│       ├─ FAIL → CdpError("CDP_UNAVAILABLE")
│       └─ PASS → Step 3
│
├─ Step 3: Target Tab Found?
│   └─ find tab with url === targetUrl
│       ├─ NOT_FOUND → CdpError("TARGET_NOT_FOUND")
│       ├─ WS_URL null → CdpError("TAB_NOT_CONNECTED")
│       └─ PASS → Step 4
│
├─ Step 4: Login Required?
│   └─ Runtime.evaluate: document.querySelector('form[action*="login"]')
│       ├─ FOUND → CdpError("LOGIN_REQUIRED")
│       └─ PASS → Step 5
│
├─ Step 5: Page Loaded?
│   └─ Runtime.evaluate: document.readyState
│       ├─ "loading" | "interactive" → CdpError("PAGE_LOADING")
│       └─ "complete" → Step 6
│
├─ Step 6: Still Generating?
│   └─ Runtime.evaluate: stop button detection
│       ├─ FOUND → CdpError("GENERATING")
│       └─ PASS → Return tab object
│
└─ Return: { ok: true, tab, wsUrl }
```

## CdpError Class

```javascript
export class CdpError extends Error {
  constructor(code, detail, docRef, hint) {
    super(detail);
    this.name = 'CdpError';
    this.code = code;
    this.docRef = docRef;
    this.hint = hint;
    this.ok = false;
  }

  toJSON() {
    return {
      ok: false,
      code: this.code,
      detail: this.message,
      docRef: this.docRef,
      hint: this.hint,
    };
  }
}
```

## Usage Example

```javascript
import { preflightCheck, CdpError } from './lib.mjs';

const result = preflightCheck('127.0.0.1', 9222, 'https://chatgpt.com/c/abc123');

if (!result.ok) {
  if (result.error instanceof CdpError) {
    console.error(result.error.toJSON());
    // { ok: false, code: 'TARGET_NOT_FOUND', detail: '...', docRef: 'cdp://docs/cdp-errors.md#TARGET_NOT_FOUND', hint: '...' }
    process.exit(1);
  }
}

// result.ok === true, proceed with CDP operations
const { tab, wsUrl } = result;
```

## Doc Reference Format

All CdpError instances reference canonical documentation using the `cdp://` scheme:

```
cdp://docs/cdp-errors.md#{error-code}
```

This allows scripts to display actionable help to users.
