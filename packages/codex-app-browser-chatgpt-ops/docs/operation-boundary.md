# Operation Boundary

`codex-app-browser-chatgpt-ops` exists because Codex in-app browser automation
has different mechanics from Chromium CDP automation.

## Not CDP

`ops-cdp-core` remains the canonical home for Chromium CDP, Project Source
transport, thread readback, artifact listing, and artifact fetch. This package
does not add a second CDP implementation.

## Codex App Browser

This package targets the runtime where these globals and APIs exist:

- `agent.browsers.get("iab")`
- `browser.tabs.selected()`
- `tab.playwright`
- `tab.cua`

The browser adapter is therefore named after the Codex app browser surface, not
after browsers in general.

## Static Safety

CI can check prompt generation, branch slug generation, PR body generation, and
policy review. CI must not create ChatGPT sessions, rename live sessions, or
submit messages to ChatGPT.

## Friction Encoded

| Friction | Encoded response |
| --- | --- |
| Session creation can happen before URL waits settle. | Detect project sidebar conversation links. |
| Rename is not exposed in the conversation menu. | Double-click the sidebar conversation title and fill `Chat title`. |
| Browser title may not show the conversation title. | Verify visible sidebar text. |
| Branch names cannot preserve PR title text exactly. | Keep PR title exact and generate a separate safe branch slug. |
| Provenance can grow noisy. | Keep only the session URL in generated PR bodies. |
