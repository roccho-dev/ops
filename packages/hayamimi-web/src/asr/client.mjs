const strip=s=>s.replace(/[\s。、．，,.!?！？・]/g,'')
function lev(a,b){if(a.length<b.length)[a,b]=[b,a];let p=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const c=[i];for(let j=1;j<=b.length;j++)c[j]=Math.min(c[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}return p[b.length]}
function choose(primary,second){const a=strip(primary),b=strip(second);if(!a||!b)return primary;const d=lev(a,b)/Math.max(a.length,b.length);return d<=.25?second:primary}
export class AsrClient {
  constructor(root,{secondOpinion=false,onText=()=>{}}={}){this.root=root;this.secondOpinion=secondOpinion;this.onText=onText;this.seq=0;this.pending=new Map();this.primary=new Worker(new URL('runtime/asr/primary.worker.js',root));this.second=secondOpinion?new Worker(new URL('runtime/asr/second.worker.js',root)):null;this.ready=new Promise((resolve,reject)=>{this.primary.onmessage=e=>this.#primary(e,resolve);this.primary.onerror=reject});if(this.second){this.second.onmessage=e=>this.#second(e);this.second.postMessage({type:'boot',root:root.href})}this.primary.postMessage({type:'boot',root:root.href})}
  #primary(e,resolve){const m=e.data;if(m.type==='ready'){resolve();return}if(m.type!=='final'||!m.text.trim())return;if(!this.secondOpinion||!this.second){this.onText(m.text);return}const id=++this.seq;this.pending.set(id,m.text);this.second.postMessage({type:'decode',id,samples:m.samples},[m.samples.buffer])}
  #second(e){const m=e.data;if(m.type!=='opinion')return;const p=this.pending.get(m.id);if(p==null)return;this.pending.delete(m.id);this.onText(choose(p,m.text))}
  push(samples){this.primary.postMessage({type:'audio',samples},[samples.buffer])}
  flush(){this.primary.postMessage({type:'flush'})}
  close(){this.primary.terminate();this.second?.terminate()}
}
