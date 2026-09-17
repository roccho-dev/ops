const PREROLL_S = 1.0
class AudioHistory {
  constructor(sampleRate, keepS = 30) { this.sr=sampleRate; this.keep=Math.floor(keepS*sampleRate); this.buf=new Float32Array(0); this.offset=0; this.lastSegEnd=0 }
  push(chunk) { const out=new Float32Array(this.buf.length+chunk.length); out.set(this.buf); out.set(chunk,this.buf.length); this.buf=out; if(out.length>this.keep){const n=out.length-this.keep;this.buf=out.slice(n);this.offset+=n} }
  withPreroll(start,samples) { const want=Math.max(start-Math.floor(PREROLL_S*this.sr),this.lastSegEnd,this.offset); const lo=Math.max(0,Math.min(want-this.offset,this.buf.length)); const hi=Math.max(lo,Math.min(start-this.offset,this.buf.length)); const pre=this.buf.subarray(lo,hi); this.lastSegEnd=start+samples.length; if(!pre.length)return samples; const out=new Float32Array(pre.length+samples.length);out.set(pre);out.set(samples,pre.length);return out }
}
self.AudioHistory=AudioHistory
