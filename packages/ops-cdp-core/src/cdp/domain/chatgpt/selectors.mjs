export const SELECTORS = Object.freeze({
  stop: 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop"], button[aria-label="停止"]',
  send: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Send"], button[aria-label="送信"]',
  assistantMsg: '[data-message-author-role="assistant"]',
  userMsg: '[data-message-author-role="user"]',
  modelSwitcher: 'button[data-testid="model-switcher-dropdown-button"], button[aria-label*="Model selector" i], button[aria-label*="current model" i]',
});

export function selector(name) {
  if (!Object.prototype.hasOwnProperty.call(SELECTORS, name)) {
    throw new Error(`unknown ChatGPT selector: ${name}`);
  }
  return SELECTORS[name];
}

export function selectorsSnapshot() {
  return { ...SELECTORS };
}
