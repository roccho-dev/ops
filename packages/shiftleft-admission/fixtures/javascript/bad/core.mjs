import fs from "node:fs";
export function read(path) { return fs.readFileSync(path, "utf8"); }
