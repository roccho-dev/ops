import { buildAll } from "../build.mjs";
await buildAll({ write: false, check: true });
process.stdout.write("excalidraw:dist-current-pass\n");
