// core/result: CDP エラー型 + envelope。ドメイン知識ゼロ。
const DOC_BASE = "cdp://docs/cdp-errors.md";

export class CdpError extends Error {
  constructor(code, detail, docRef, hint) {
    super(detail);
    this.name = "CdpError";
    this.code = code;
    this.detail = detail;
    this.docRef = docRef || `${DOC_BASE}#${code}`;
    this.hint = hint;
    this.ok = false;
  }

  toJSON() {
    return {
      ok: false,
      code: this.code,
      detail: this.message,
      docRef: this.docRef,
      hint: this.hint || null,
    };
  }
}

export function cdpError(code, detail, hint) {
  return new CdpError(code, detail, null, hint);
}
