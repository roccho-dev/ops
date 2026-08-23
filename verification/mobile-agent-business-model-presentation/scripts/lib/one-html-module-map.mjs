import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const invariant = (condition, message) => { if (!condition) throw new Error(`one-html-module-map: ${message}`); };
const relativeSpecifierPattern = /\b(?:from|import)\s+(["'])(\.[^"']+)\1/gu;
const toPosix = value => value.replaceAll("\\", "/");
const moduleId = (root, path) => `@one-html/${Buffer.from(toPosix(relative(root, path))).toString("base64url")}`;

const findSpecifiers = source => [...source.matchAll(relativeSpecifierPattern)].map(match => match[2]);

export const bundleOneHtmlModuleMap = async ({ entry, replacements = new Map(), root }) => {
  const absoluteRoot = resolve(root);
  const sources = new Map();
  const visit = async path => {
    const absolute = resolve(path);
    invariant(absolute === absoluteRoot || absolute.startsWith(`${absoluteRoot}/`), `module escapes root: ${absolute}`);
    if (sources.has(absolute)) return;
    let source = await readFile(absolute, "utf8");
    for (const [needle, replacement] of replacements.get(absolute) ?? []) {
      invariant(source.includes(needle), `replacement target is missing in ${toPosix(relative(absoluteRoot, absolute))}`);
      source = source.replaceAll(needle, replacement);
    }
    sources.set(absolute, source);
    for (const specifier of findSpecifiers(source)) await visit(resolve(dirname(absolute), specifier));
  };
  await visit(resolve(entry));

  const ids = new Map([...sources.keys()].sort().map(path => [path, moduleId(absoluteRoot, path)]));
  const imports = {};
  for (const [path, source] of [...sources.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const rewritten = source.replace(relativeSpecifierPattern, (whole, quote, specifier) => {
      const dependency = resolve(dirname(path), specifier);
      invariant(ids.has(dependency), `unresolved module ${specifier}`);
      return whole.replace(`${quote}${specifier}${quote}`, `${quote}${ids.get(dependency)}${quote}`);
    });
    imports[ids.get(path)] = `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
  }
  return Object.freeze({ entrySpecifier: ids.get(resolve(entry)), imports: Object.freeze(imports), moduleCount: ids.size });
};
