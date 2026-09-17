const TARGET=16000, SEND=2048
class MicProcessor extends AudioWorkletProcessor {
  constructor(){super();this.buf=new Float32Array(0);this.ratio=sampleRate/TARGET;this.frac=0;this.tail=0}
  resample(input){if(Math.abs(sampleRate-TARGET)<=1)return input;const out=[];let p=this.frac;while(p<input.length){const i=Math.floor(p),t=p-i,a=i===0?this.tail:input[i-1],b=input[i];out.push(a+(b-a)*t);p+=this.ratio}this.frac=p-input.length;this.tail=input[input.length-1];return Float32Array.from(out)}
  process(inputs){const ch=inputs[0]?.[0];if(!ch)return true;const b=this.resample(ch),m=new Float32Array(this.buf.length+b.length);m.set(this.buf);m.set(b,this.buf.length);this.buf=m;while(this.buf.length>=SEND){const c=this.buf.slice(0,SEND);this.buf=this.buf.slice(SEND);this.port.postMessage(c,[c.buffer])}return true}
}
registerProcessor('hayamimi-mic',MicProcessor)
