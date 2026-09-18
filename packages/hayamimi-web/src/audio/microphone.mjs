export class Microphone {
  constructor(root,onChunk){this.root=root;this.onChunk=onChunk;this.stream=null;this.ctx=null;this.node=null}
  async start(){if(this.stream)return;this.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});this.ctx=new AudioContext({sampleRate:16000});await this.ctx.audioWorklet.addModule(new URL('runtime/audio/pcm.worklet.mjs',this.root));this.node=new AudioWorkletNode(this.ctx,'hayamimi-mic');this.node.port.onmessage=e=>this.onChunk(e.data);const src=this.ctx.createMediaStreamSource(this.stream);src.connect(this.node);this.node.connect(this.ctx.destination)}
  async stop(){if(!this.stream)return;for(const t of this.stream.getTracks())t.stop();this.node?.disconnect();await this.ctx?.close();this.stream=this.ctx=this.node=null}
}
