import { evaluate } from '../../jev-review/review.mjs';
import { structural } from '../design/lint.mjs';

export const DAG_THEMES=Object.freeze([
{id:'unnecessary',concern:'The target may be unnecessary for achieving the accepted purpose and acceptance conditions in the observed world.'},
{id:'misfit',concern:'The target may conflict with the accepted purpose, acceptance conditions, constraints, or observed-world facts.'},
{id:'low-contribution',concern:'The target may make little or no material contribution to achieving the accepted purpose and acceptance conditions in the observed world.'},
].map(Object.freeze));
const text=(x)=>typeof x==='string'&&x.trim().length>0;
const list=(x)=>Array.isArray(x)&&Reflect.ownKeys(x).length===x.length+1&&Array.from({length:x.length},(_,i)=>Object.getOwnPropertyDescriptor(x,String(i))).every((p)=>p&&Object.hasOwn(p,'value'));
const strings=(x)=>list(x)&&x.every(text);
const exact=(x,names)=>x&&[Object.prototype,null].includes(Object.getPrototypeOf(x))&&Reflect.ownKeys(x).length===names.length&&names.every((name)=>Object.hasOwn(x,name));
const compare=(a,b)=>a<b?-1:a>b?1:0;
const edgePort=({from,to})=>`edge:${JSON.stringify([from,to])}`,nodePort=(id)=>`node:${JSON.stringify(id)}`;
export function validateDagInput(input){
 if(!exact(input,['contract','world','dag']))throw new Error('INVALID_DAG_EVALUATION');
 const {contract,world,dag}=input;
 if(!exact(contract,['purpose','acceptance','constraints'])||!text(contract.purpose)||!strings(contract.acceptance)||!contract.acceptance.length||!strings(contract.constraints))throw new Error('INVALID_DAG_CONTRACT');
 if(!exact(world,['snapshot','facts'])||!text(world.snapshot)||!strings(world.facts))throw new Error('INVALID_OBSERVED_WORLD');
 if(!exact(dag,['nodes','edges'])||!list(dag.nodes)||!dag.nodes.length||!list(dag.edges))throw new Error('INVALID_CANDIDATE_DAG');
 for(const node of dag.nodes)if(!exact(node,['id','actor','action'])||!text(node.id)||!text(node.actor)||!text(node.action))throw new Error('INVALID_DAG_NODE');
 for(const edge of dag.edges)if(!exact(edge,['from','to','reason'])||!text(edge.from)||!text(edge.to)||!text(edge.reason))throw new Error('INVALID_DAG_EDGE');
}
function projectStructure(dag){return{purpose:'Validate only the declared Candidate DAG structure.',acceptance:['Every declared node is represented and dependencies are acyclic.'],constraints:[],in:[],out:dag.nodes.map((n)=>nodePort(n.id)),units:dag.nodes.map((n)=>({id:n.id,kind:'dag-node',responsibility:n.actor,in:dag.edges.filter((e)=>e.to===n.id).map(edgePort),out:[nodePort(n.id),...dag.edges.filter((e)=>e.from===n.id).map(edgePort)],design:n.action}))};}
export function hardDagChecks(dag){
 const ids=new Set(dag.nodes.map((n)=>n.id)),edges=new Set(),hard=[];
 for(const edge of dag.edges){if(!ids.has(edge.from)||!ids.has(edge.to))hard.push({code:'MISSING_DEPENDENCY_REF',subject:['edge',edge.from,edge.to]});const key=JSON.stringify([edge.from,edge.to]);if(edges.has(key))hard.push({code:'DUPLICATE_EDGE',subject:['edge',edge.from,edge.to]});edges.add(key);}
 if(hard.length)return hard.sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b)));
 return structural(projectStructure(dag));
}
function subjects(dag){return[...[...dag.nodes].sort((a,b)=>compare(a.id,b.id)).map((n)=>['node',n.id]),...[...dag.edges].sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b))).map((e)=>['edge',e.from,e.to])];}
export async function evaluateDag(input,ask){
 validateDagInput(input);const state=JSON.parse(JSON.stringify(input));state.dag.nodes.sort((a,b)=>compare(a.id,b.id));state.dag.edges.sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b)));
 const hard=hardDagChecks(state.dag),refs=subjects(state.dag);
 if(hard.length)return{kind:'dagSemanticEvaluation.v1',hard,coverage:{subjects:refs.length,themes:DAG_THEMES.length,evaluated:0},findings:[],calls:0,usage:{}};
 if(typeof ask!=='function')throw new Error('INVALID_DAG_EVALUATOR');
 const themes=DAG_THEMES.map((t)=>t.id),items=DAG_THEMES.flatMap((t)=>refs.map((subject)=>({theme:t.id,subject,concern:t.concern})));
 const result=await evaluate(state,{themes,items},ask);
 return{kind:'dagSemanticEvaluation.v1',hard,coverage:{subjects:refs.length,themes:themes.length,evaluated:result.judgments.length},findings:[...result.judgments].sort((a,b)=>compare(a.theme,b.theme)||b.noul-a.noul||compare(JSON.stringify(a.subject),JSON.stringify(b.subject))),calls:result.calls,usage:result.usage};
}
