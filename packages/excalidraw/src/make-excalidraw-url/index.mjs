/** Public scene URL -> official Excalidraw viewer URL. */
export const manifest = Object.freeze({
  id: "urn:roccho-dev:ops:dist:excalidraw:make-excalidraw-url",
  version: "0.2.0",
  runtime: "browser-node",
  entrypoints: ["run", "makeExcalidrawUrl"],
  externalDependencies: [],
});

export function makeExcalidrawUrl(publicSceneUrl, userOptions = {}) {
  if (typeof publicSceneUrl !== "string" || !publicSceneUrl.trim()) {
    throw new TypeError("publicSceneUrl must be a non-empty string");
  }
  const baseUrl = userOptions.baseUrl ?? "https://excalidraw.com/";
  const cleanBase = String(baseUrl).replace(/#.*$/, "");
  return `${cleanBase}#url=${encodeURIComponent(publicSceneUrl)}`;
}

export function run(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("request must be an object");
  }
  if (request.operation != null && request.operation !== "make-excalidraw-url") {
    throw new Error(`unsupported operation: ${String(request.operation)}`);
  }
  return makeExcalidrawUrl(request.publicSceneUrl, request.options);
}
