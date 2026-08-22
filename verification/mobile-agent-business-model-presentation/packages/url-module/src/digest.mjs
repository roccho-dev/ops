const bytesToHex = bytes => [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async input => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (!(bytes instanceof Uint8Array)) throw new Error("sha256: input must be text or Uint8Array");
  if (globalThis.crypto?.subtle) return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
};
