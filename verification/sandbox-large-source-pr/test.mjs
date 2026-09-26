import { shards, evaluateAll } from "./src/index.mjs";
import fs from "node:fs";
if(shards.length!==32) throw new Error("shards");
const rows=evaluateAll({kind:"source"});
if(rows.length!==32 || rows.some((r,i)=>!r.accepted||r.ordinal!==i)) throw new Error("semantics");
const bytes=fs.readdirSync("src/shards").reduce((n,p)=>n+fs.statSync("src/shards/"+p).size,0);
if(bytes!==2097152) throw new Error("bytes "+bytes);
console.log(JSON.stringify({schema:"ops.sandboxLargeSourceTest/1",status:"PASS",shards:32,shardBytes:bytes,results:rows.length}));
