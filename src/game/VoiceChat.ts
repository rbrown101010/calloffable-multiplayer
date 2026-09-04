/** Opt-in WebRTC audio with ephemeral radio audio over InstantDB when direct media is blocked. */
export class VoiceChat {
  enabled=false; muted=false; pushToTalk=false; talking=false;
  private stream:MediaStream|null=null;
  private peers=new Map<string,{pc:RTCPeerConnection,audio:HTMLAudioElement,candidates:RTCIceCandidateInit[];wantOffer:boolean}>();
  private peerIds:string[]=[];
  private pttHeld=false; private destroyed=false; private enabling=false;
  private audioContext?:AudioContext; private capture?:AudioWorkletNode; private source?:MediaStreamAudioSourceNode;
  private mutedPeers=new Set<string>(); private playHeads=new Map<string,number>(); private sources=new Map<string,Set<AudioBufferSourceNode>>();
  fallbackFrames=0; private lastFrame=new Map<string,number>();
  unlock=()=>{void this.audioContext?.resume().catch(()=>{});for(const p of this.peers.values())p.audio.play().catch(()=>{});};
  onChange=()=>{};
  onError=(message:string)=>{};
  constructor(private id:string, private iceServers:RTCIceServer[], private send:(message:any)=>void) {
    window.addEventListener('pointerdown',this.unlock);window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);window.addEventListener('blur',this.blur);
  }
  private keyDown=(e:KeyboardEvent)=>{if(e.code==='KeyV'&&!(e.target as HTMLElement)?.matches('input,textarea')){this.pttHeld=true;this.applyMute();}};
  private keyUp=(e:KeyboardEvent)=>{if(e.code==='KeyV'){this.pttHeld=false;this.applyMute();}};
  private blur=()=>{this.pttHeld=false;this.applyMute();};
  async toggle(){
    if(this.enabled){this.disable();return;}if(this.enabling||this.destroyed)return;this.enabling=true;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(this.destroyed){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.enabled=true;this.muted=false;this.applyMute();await this.startCapture(stream);
      for(const [id,{pc}]of this.peers){const transceiver=pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');if(transceiver&&pc.signalingState!=='closed'){transceiver.direction='sendrecv';await transceiver.sender.replaceTrack(stream.getAudioTracks()[0]);}}
      await this.sync(this.peerIds);this.onChange();
    }catch(e){this.onError((e as Error).name==='NotAllowedError'?'Microphone permission was denied. Allow it in your browser to enable voice.':'No microphone is available.');}finally{this.enabling=false;}
  }
  disable(){this.capture?.disconnect();this.source?.disconnect();this.capture=undefined;this.source=undefined;this.enabled=false;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.talking=false;for(const {pc}of this.peers.values())for(const sender of pc.getSenders())if(sender.track&&pc.signalingState!=='closed')void sender.replaceTrack(null).catch(()=>{});this.onChange();}
  setPTT(on:boolean){this.pushToTalk=on;this.applyMute();}
  private applyMute(){this.talking=this.enabled&&!this.muted&&(!this.pushToTalk||this.pttHeld);this.stream?.getAudioTracks().forEach(t=>t.enabled=this.talking);this.onChange();}
  isPeerMuted(id:string){return this.mutedPeers.has(id);}
  setPeerMuted(id:string,on:boolean){if(on){this.mutedPeers.add(id);for(const s of this.sources.get(id)||[])try{s.stop();}catch{}}else this.mutedPeers.delete(id);const peer=this.peers.get(id);if(peer)peer.audio.muted=on;}
  private async context(){if(!this.audioContext)this.audioContext=new AudioContext({sampleRate:16000,latencyHint:'interactive'});await this.audioContext.resume().catch(()=>{});return this.audioContext;}
  private async startCapture(stream:MediaStream){
    const ctx=await this.context();await ctx.audioWorklet.addModule('/voice-capture.js');if(this.destroyed||!this.enabled)return;
    this.source=ctx.createMediaStreamSource(stream);this.capture=new AudioWorkletNode(ctx,'radio-capture');this.source.connect(this.capture);this.capture.connect(ctx.destination);
    this.capture.port.onmessage=({data}:{data:Uint8Array})=>{
      if(!this.talking||this.destroyed||![...this.peers.values()].some(p=>p.pc.connectionState!=='connected'))return;
      this.send({kind:'voice-audio',audio:btoa(String.fromCharCode(...data))});
    };
  }
  private async playRadio(from:string,data:any){
    const p=this.peers.get(from);if(p?.pc.connectionState==='connected'||this.mutedPeers.has(from)||typeof data.audio!=='string'||data.audio.length!==2732)return;
    // Accept at most 12 small frames per second per joined peer; drop delayed audio rather than queueing it.
    const now=performance.now();if(now-(this.lastFrame.get(from)||0)<65)return;this.lastFrame.set(from,now);
    let bytes:string;try{bytes=atob(data.audio);}catch{return;}if(bytes.length!==2048)return;
    const ctx=await this.context();if(this.destroyed||ctx.state!=='running')return;const buffer=ctx.createBuffer(1,bytes.length,16000),out=buffer.getChannelData(0);
    for(let i=0;i<bytes.length;i++){const u=(~bytes.charCodeAt(i))&255;let sample=(((u&15)<<3)+132)<<((u>>4)&7);sample-=132;out[i]=(u&128?-sample:sample)/32768;}
    const head=this.playHeads.get(from)||0;const start=head>ctx.currentTime&&head<ctx.currentTime+.4?head:ctx.currentTime+.07;
    const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);source.start(start);this.playHeads.set(from,start+buffer.duration);
    if(!this.sources.has(from))this.sources.set(from,new Set());this.sources.get(from)!.add(source);source.onended=()=>{source.disconnect();this.sources.get(from)?.delete(source);};this.fallbackFrames++;
  }
  async sync(ids:string[]){this.peerIds=ids.filter(id=>id!==this.id);for(const [id,p]of this.peers)if(!ids.includes(id)){p.pc.close();p.audio.remove();this.peers.delete(id);}for(const id of this.peerIds){if(!this.peers.has(id)){this.make(id);if(this.id<id)await this.offer(id);}}}
  private make(id:string){
    const pc=new RTCPeerConnection({iceServers:this.iceServers});const audio=document.createElement('audio');audio.autoplay=true;audio.muted=this.mutedPeers.has(id);audio.dataset.peer=id;document.body.append(audio);
    const item={pc,audio,candidates:[] as RTCIceCandidateInit[],wantOffer:false};this.peers.set(id,item);
    const track=this.stream?.getAudioTracks()[0];if(this.id<id)pc.addTransceiver(track||'audio',{direction:'sendrecv',streams:this.stream?[this.stream]:[]});
    pc.onsignalingstatechange=()=>{if(pc.signalingState==='stable'&&item.wantOffer&&this.id<id)void this.offer(id);};
    pc.onicecandidate=e=>{if(e.candidate)this.send({kind:'voice',to:id,candidate:e.candidate.toJSON()});};
    pc.ontrack=e=>{audio.srcObject=e.streams[0]||new MediaStream([e.track]);audio.play().catch(()=>{});};
    pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed')this.onError('Voice is using the private radio relay for this network.');};
    return item;
  }
  private async offer(id:string){const p=this.peers.get(id);if(!p)return;if(p.pc.signalingState!=='stable'){p.wantOffer=true;return;}p.wantOffer=false;try{await p.pc.setLocalDescription(await p.pc.createOffer());this.send({kind:'voice',to:id,description:p.pc.localDescription});}catch{}}
  async signal(from:string,data:any){
    if(this.destroyed)return;if(data.kind==='voice-renegotiate'){if(data.to===this.id&&this.id<from)await this.offer(from);return;}if(data.kind==='voice-audio'){await this.playRadio(from,data);return;}
    if(data.kind==='voice-reset'){const p=this.peers.get(from);if(p){p.pc.close();p.audio.remove();this.peers.delete(from);}this.make(from);if(this.id<from)await this.offer(from);return;}
    if(data.to!==this.id)return;
    const p=this.peers.get(from)||this.make(from);
    try{
      if(data.description){
        if(data.description.type==='offer'&&p.pc.signalingState!=='stable'){if(this.id<from)return;await p.pc.setLocalDescription({type:'rollback'});}
        await p.pc.setRemoteDescription(data.description);
        for(const c of p.candidates)await p.pc.addIceCandidate(c);p.candidates=[];
        if(data.description.type==='offer'){const transceiver=p.pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');if(transceiver){transceiver.direction='sendrecv';await transceiver.sender.replaceTrack(this.stream?.getAudioTracks()[0]||null);}await p.pc.setLocalDescription(await p.pc.createAnswer());this.send({kind:'voice',to:from,description:p.pc.localDescription});}
      }else if(data.candidate){if(p.pc.remoteDescription)await p.pc.addIceCandidate(data.candidate);else p.candidates.push(data.candidate);}
    }catch(e){console.warn('Voice negotiation:',(e as Error).message);}
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.disable();this.audioContext?.close();window.removeEventListener('pointerdown',this.unlock);for(const p of this.peers.values()){p.pc.close();p.audio.remove();}this.peers.clear();window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('blur',this.blur);}
}
