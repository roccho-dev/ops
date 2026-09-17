import {AsrClient} from '../asr/client.mjs'
import {Microphone} from '../audio/microphone.mjs'
export class Hayamimi extends EventTarget {
  constructor({secondOpinion=true}={}){super();this.root=new URL('../../',import.meta.url);this._running=false;this.onText=null;this.asr=new AsrClient(this.root,{secondOpinion,onText:text=>{this.onText?.(text);this.dispatchEvent(new CustomEvent('text',{detail:text}))}});this.mic=new Microphone(this.root,s=>this.asr.push(s))}
  get running(){return this._running}
  async start(){if(this._running)return;await this.asr.ready;await this.mic.start();this._running=true}
  async stop(){if(!this._running)return;await this.mic.stop();this.asr.flush();this._running=false}
  close(){this.asr.close()}
}
export const createHayamimi=opts=>new Hayamimi(opts)
