#!/usr/bin/env node
import fs from "node:fs";
const source = fs.readFileSync(process.argv[2], "utf8");

function tokenize(s) {
  const out = [];
  let i = 0, line = 1;
  const push = (type, value, at) => out.push({ type, value, line: at });
  while (i < s.length) {
    const c = s[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && s[i + 1] === "/") { i += 2; while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && s[i + 1] === "*") { i += 2; while (i + 1 < s.length && !(s[i] === "*" && s[i + 1] === "/")) { if (s[i] === "\n") line++; i++; } i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c, at = line; i++; let value = "";
      while (i < s.length) {
        const x = s[i++];
        if (x === "\\") { if (i < s.length) value += s[i++]; continue; }
        if (x === quote) break;
        if (x === "\n") line++;
        value += x;
      }
      push("string", value, at); continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const at=line; let v=c; i++; while (i<s.length && /[A-Za-z0-9_$]/.test(s[i])) v+=s[i++]; push("id",v,at); continue; }
    push("punct",c,line); i++;
  }
  return out;
}

const t = tokenize(source), imports = [];
for (let i = 0; i < t.length; i++) {
  if (t[i].type === "id" && t[i].value === "require" && t[i+1]?.value === "(" && t[i+2]?.type === "string") imports.push({module:t[i+2].value,line:t[i].line});
  if (t[i].type === "id" && t[i].value === "import") {
    if (t[i+1]?.value === "(" && t[i+2]?.type === "string") { imports.push({module:t[i+2].value,line:t[i].line}); continue; }
    if (t[i+1]?.type === "string") { imports.push({module:t[i+1].value,line:t[i].line}); continue; }
    for (let j=i+1; j<Math.min(t.length,i+20); j++) {
      if (t[j].value === ";") break;
      if (t[j].type === "id" && t[j].value === "from" && t[j+1]?.type === "string") { imports.push({module:t[j+1].value,line:t[i].line}); break; }
    }
  }
}
imports.sort((a,b)=>a.module.localeCompare(b.module)||a.line-b.line);
process.stdout.write(JSON.stringify({schema:"shiftleft-import-report/1",imports})+"\n");
