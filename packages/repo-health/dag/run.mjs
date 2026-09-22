import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { askJev } from '../../jev-review/jev.mjs';
import { JEV_MODEL } from '../../jev-review/core.mjs';
import { sha256 } from '../lib/core.mjs';
import { evaluateDag } from './evaluate.mjs';
export async function runDagFile(inputPath,outputPath,ask){
 const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));const result=await evaluateDag(input,ask);
 const rows=[{kind:'dagSemanticRun.v1',model:JEV_MODEL,inputDigest:sha256(input),authority:false},result];
 fs.writeFileSync(outputPath,rows.map((row)=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx',mode:0o600});return result;
}
async function main(){
 if(process.argv.length!==4)throw new Error('usage: node dag/run.mjs INPUT.json OUTPUT.jsonl');
 const ask=(state,questions)=>askJev(state,questions,{key:process.env.JEV_API_KEY,endpoint:process.env.JEV_API_URL||'https://api.typesafe.ai/v1/systemone',timeoutMs:15000});
 const result=await runDagFile(process.argv[2],process.argv[3],ask);console.log(JSON.stringify({kind:result.kind,hard:result.hard.length,evaluated:result.coverage.evaluated,calls:result.calls}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch((error)=>{console.error(error?.message||'DAG_EVALUATION_FAILED');process.exitCode=1;});
