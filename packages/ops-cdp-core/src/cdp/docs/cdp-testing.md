# CDP Boundary Values and Real Machine Testing

目的から script を引きたい時は、先に `chatgpt-command-map.md` を見ます。

- docs: `parts/cdp/docs/chatgpt-command-map.md`
- runtime help: `nix run .#chromium-cdp-chatgpt-command-map`

## Boundary Values

| Parameter | Default | Min | Max | Recommended |
|-----------|---------|-----|-----|------------|
| `waitMs` | 8000 | 0 | 120000 | 8000-30000 |
| `pollMs` | 250 | 50 | 10000 | 100-500 |
| `timeoutMs` | 60000 | 1000 | 300000 | 30000-60000 |
| `retryCount` | 3 | 1 | 10 | 3 |
| `chunkSize` | 800 | 100 | 5000 | 500-1000 |

## Real Machine Testing Checklist

### J1: Headless Mode

```bash
# Start headless Chromium
HQ_CHROME_HEADLESS=1 chromium-cdp

# Verify CDP port
curl http://127.0.0.1:9222/json/version
```

### J2: Headful Mode

```bash
# Start headful Chromium
chromium-cdp

# Verify CDP port
curl http://127.0.0.1:9222/json/version
```

### J3: Profile Reuse

```bash
# Set profile directory
export HQ_CHROME_PROFILE_DIR=~/.secret/hq/chromium-cdp-profile

# Start with profile
chromium-cdp

# After login, publish profile
chromium-cdp-service-profile-publish
```

### J4: Multiple Tabs

```bash
# Open multiple tabs
cdp-bridge new --url "https://chatgpt.com/c/thread1"
cdp-bridge new --url "https://chatgpt.com/c/thread2"

# List tabs
cdp-bridge list

# Send to specific tab by ID
qjs --std -m send-chatgpt.mjs --id <tab-id> --text "hello"
```

### J5: Long Connection

```bash
# Monitor WS connection stability
watch -n 5 'cdp-bridge list'

# Reconnect if needed
cdp-bridge close --id <stale-tab-id>
cdp-bridge new --url <url>
```

## Error Recovery Scenarios

### Browser Crash

```bash
# Detect
curl http://127.0.0.1:9222/json/version  # fails

# Recovery
pkill chromium
chromium-cdp
```

### WS URL Expired

```bash
# Detect
cdp-bridge list  # shows tab without webSocketDebuggerUrl

# Recovery
cdp-bridge close --id <tab-id>
cdp-bridge new --url <url>
```

### Rate Limiting

```bash
# Detect
# GPT returns rate limit message

# Recovery
# Wait 60 seconds and retry
# Or use different ChatGPT account
```

## Project Workflow (Validated)

These commands were rechecked against a live project page on port `9223`.

運用モデルは、`CDP = 外部操作機構` です。

- 共有背景
  - `Project Sources`
- 各会話への担当投入
  - 新規 thread 作成 + follow-up 送信
- 成果回収
  - `thread artifact`

この layer では、配布 bundle を毎回作るより、

- `Project Sources`
- `Instructions`
- `Chats`

を shared context として使う前提を優先します。

### P1: Create a New Thread from a Project Page

If the project page is already open in Chromium, pass its target id to avoid route drift.

```bash
# Find the project page target id
curl -fsS http://127.0.0.1:9223/json/list | jq -r '.[] | select(.type=="page") | [.id,.title,.url] | @tsv'

# Create a new thread from the live project page
HQ_CHROME_PORT=9223 nix run .#chromium-cdp-create-project-thread -- \
  --projectUrl "https://chatgpt.com/g/g-p-<project>-<name>/project" \
  --id "<project-target-id>" \
  --text "SCRIPT_CREATE_THREAD_OK" \
  --json
```

Expected result:

- `ok=true`
- `threadUrl` points to `/g/g-p-.../c/<thread>`

### P2: Upload and Download Thread Files

```bash
HQ_CHROME_PORT=9223 nix run .#chromium-cdp-upload-chatgpt-file -- \
  --url "https://chatgpt.com/g/g-p-<project>-<name>/c/<thread>" \
  --file /abs/path/to/upload.txt \
  --text "UPLOAD_OK"

HQ_CHROME_PORT=9223 nix run .#chromium-cdp-list-artifacts -- \
  --url "https://chatgpt.com/g/g-p-<project>-<name>/c/<thread>"

HQ_CHROME_PORT=9223 nix run .#chromium-cdp-fetch-artifact -- \
  --url "https://chatgpt.com/g/g-p-<project>-<name>/c/<thread>" \
  --name "upload.txt" \
  --outDir /tmp/hq_fetch \
  --downloadsDir /tmp/hq_downloads
```

Expected result:

- upload returns `ok=true`
- artifacts include the uploaded file
- fetch copies the file into `--outDir`

### P3: Current Project Sources Caveat

Project Sources is only partially stable right now.

- `chromium-cdp-project-sources-promote-turn`
- `chromium-cdp-project-sources-collect-files`
- `chromium-cdp-project-sources-roundtrip`

are now exposed as first-class apps, but the live UI still drifts:

- some project URLs land on a shell page instead of the full `Chats / Sources` view
- `project-sources-roundtrip` still has a helper/UI mismatch in some live cases
- delete is still not first-class; the current escape hatch remains `--removeAfter`
- updating a source with the same filename does not guarantee that an existing thread reads the latest content

When a same-name source is updated, send a reread instruction to each target thread:

```text
Project Sources を必ず読み直してください。
過去回答やキャッシュに頼らず、SOURCE_MANIFEST.json の現在版を確認してください。
```

### P4: Validated Manual Orchestration for Shared Background

The currently validated path is primitive-first, not composite-first.

1. Upload a file to a writer thread
2. Ask assistant to echo or summarize the source payload
3. Promote that assistant turn into `Project Sources`
4. Create or reuse a separate reader thread in the same project
5. Ask the reader thread to read current `Project Sources`
6. Confirm with `read-thread`

Important fact:

- in the current UI, `Add to project sources` was visible on the assistant turn
- it was not visible on the matching user upload turn

That means the stable path right now is:

- `thread upload`
- `assistant echo/summary`
- `assistant turn promote`
- `reader thread verify`

The external operator can orchestrate that manually with these primitives:

- `chromium-cdp-upload-chatgpt-file`
- `chromium-cdp-send-chatgpt`
- `chromium-cdp-project-sources-promote-turn`
- `chromium-cdp-create-project-thread`
- `chromium-cdp-read-thread`
