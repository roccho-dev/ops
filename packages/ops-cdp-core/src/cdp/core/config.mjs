// core/config: 環境変数由来の設定(addr/port/headless/profile)。ドメイン知識ゼロ。
import * as std from "./std.mjs";

export function getDefaultAddr() {
  return std.getenv("HQ_CHROME_ADDR") || "127.0.0.1";
}

export function getDefaultPort() {
  return Number(std.getenv("HQ_CHROME_PORT") || "9222") || 9222;
}

export function isHeadlessMode() {
  return std.getenv("HQ_CHROME_HEADLESS") === "1";
}

export function getChromeProfileDir() {
  return std.getenv("HQ_CHROME_PROFILE_DIR") || (std.getenv("HOME") + "/.secret/hq/chromium-cdp-profile");
}
