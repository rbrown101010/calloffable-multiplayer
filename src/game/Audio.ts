import * as THREE from 'three';
import { clamp, rand } from './util';

export interface PlayOpts { vol?: number; rate?: number; rateVar?: number; delay?: number; loop?: boolean; lowpass?: number; highpass?: number; reverb?: number; pan?: number; bus?: 'sfx' | 'gun' | 'ui'; offset?: number; }
export interface GunSound { shot: string | string[]; vol?: number; rate?: number; rateVar?: number; offset?: number; reverb?: number; layer?: string | string[]; layerVol?: number; layerRate?: number; mech?: string | string[]; mechVol?: number; mechDelay?: number; sub?: number; subFreq?: number; subDecay?: number; crack?: number; echo?: string | string[]; echoVol?: number; echoDelay?: number; echo2?: boolean; }
export interface Play3DOpts extends PlayOpts { ref?: number; max?: number; rolloff?: number; reverb?: number; }

/** Web Audio manager: sample playback, 3D positional sounds, synthesized UI/impact sounds, ambience. */
export class AudioManager {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  ui: GainNode;
  comp: DynamicsCompressorNode;
  reverb: ConvolverNode;
  reverbGain: GainNode;
  buffers = new Map<string, AudioBuffer>();
  /** Dedicated bus for the player's own weapon: fast compressor + makeup for punch, then into the main chain. */
  gun: GainNode; gunComp: DynamicsCompressorNode;
  private lastPick = new Map<string, number>();
  private listenerPos = new THREE.Vector3();
  private _fwd = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private noiseBuf!: AudioBuffer;
  private windNodes: AudioNode[] = [];
  private lowHp = 0; private beatT = 0;
  private tinnitusGain?: GainNode;
  private replaying=false;private replaySoundDepth=0;
  setReplayMode(on:boolean){this.replaying=on;if(on)for(const source of [...this.voices.keys()]){try{source.stop();}catch{}this.releaseVoice(source);}}
  replaySound(play:()=>unknown){this.replaySoundDepth++;try{return play();}finally{this.replaySoundDepth--;}}

  // Bound the audio graph even if a slow audio device falls behind the game loop.
  private voices = new Map<AudioScheduledSourceNode,{spatial:boolean;score:number;end:number;nodes:AudioNode[]}>();
  private spatialLimit = 24;
  private voiceLimit = 64;

  private reserveVoice(spatial:boolean,score:number) {
    if(this.ctx.state!=='running'||this.master.gain.value===0||(this.replaying&&!this.replaySoundDepth))return false;
    const candidates=[...this.voices].filter(([,v])=>!spatial||v.spatial);
    if(this.voices.size<this.voiceLimit&&(!spatial||candidates.length<this.spatialLimit))return true;
    const pool=spatial&&candidates.length>=this.spatialLimit?candidates:[...this.voices];
    pool.sort((a,b)=>a[1].score-b[1].score||a[1].end-b[1].end);
    const victim=pool[0];if(!victim||victim[1].score>score)return false;
    try{victim[0].stop();}catch{}this.releaseVoice(victim[0]);return true;
  }
  private trackVoice(source:AudioScheduledSourceNode,nodes:AudioNode[],spatial:boolean,score:number,end:number) {
    this.voices.set(source,{nodes,spatial,score,end});
    // Keep announcer and caller onended callbacks independent of graph cleanup.
    source.addEventListener('ended',()=>this.releaseVoice(source),{once:true});
  }
  private releaseVoice(source:AudioScheduledSourceNode) {
    const voice=this.voices.get(source);if(!voice)return;
    for(const node of voice.nodes)node.disconnect();this.voices.delete(source);
  }

  private cleanAfter(source:AudioScheduledSourceNode|null,nodes:AudioNode[]) {
    const clean=()=>nodes.forEach(node=>node.disconnect());
    if(source)source.addEventListener('ended',clean,{once:true});else clean();
  }

  /** Field recordings contain silence and multiple shots. Reuse just the first report. */
  private trimGunRecording(name:string,buffer:AudioBuffer) {
    if(!name.startsWith('shot_'))return buffer;
    const samples=buffer.getChannelData(0),window=Math.max(1,Math.floor(buffer.sampleRate*.005)),energy:number[]=[];
    for(let i=0;i<samples.length;i+=window){let sum=0;for(let j=i;j<Math.min(i+window,samples.length);j++)sum+=samples[j]*samples[j];energy.push(Math.sqrt(sum/window));}
    const peak=Math.max(...energy);if(peak<.0001)return buffer;
    const onset=Math.max(0,energy.findIndex(v=>v>peak*.15)*window-Math.floor(buffer.sampleRate*.012));
    const duration=name.includes('bolt')?1.65:name.includes('shotgun')?1.35:1.1;
    const length=Math.min(buffer.length-onset,Math.ceil(buffer.sampleRate*duration));
    const trimmed=this.ctx.createBuffer(buffer.numberOfChannels,length,buffer.sampleRate),fade=Math.min(Math.floor(buffer.sampleRate*.06),length);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){const out=trimmed.getChannelData(ch);out.set(buffer.getChannelData(ch).subarray(onset,onset+length));for(let i=0;i<fade;i++)out[length-fade+i]*=1-i/fade;}
    return trimmed;
  }

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 18; this.comp.ratio.value = 6; this.comp.attack.value = 0.002; this.comp.release.value = 0.18;
    this.sfx = this.ctx.createGain();
    this.ui = this.ctx.createGain();
    this.sfx.connect(this.comp); this.ui.connect(this.comp); this.comp.connect(this.master); this.master.connect(this.ctx.destination);
    this.master.gain.value = 0.8;
    this.gunComp = this.ctx.createDynamicsCompressor();
    this.gunComp.threshold.value = -20; this.gunComp.knee.value = 4; this.gunComp.ratio.value = 10; this.gunComp.attack.value = 0.0015; this.gunComp.release.value = 0.14;
    this.gun = this.ctx.createGain(); this.gun.gain.value = 1.35; this.gunComp.connect(this.gun); this.gun.connect(this.comp);
    // Outdoor slap-back reverb (short, bright-ish decay)
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.4, 3.2);
    this.reverbGain = this.ctx.createGain(); this.reverbGain.gain.value = 0.28;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.comp);
    this.noiseBuf = this.makeNoise(2);
  }

  setVolume(v: number) { this.master.gain.value = clamp(v, 0, 1); }
  unlock() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  async load(manifest: Record<string, string>, onProgress?: (done: number, total: number) => void) {
    const names = Object.keys(manifest); let done = 0;
    await Promise.all(names.map(async (n) => {
      try {
        const res = await fetch(manifest[n]); const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this.buffers.set(n, this.trimGunRecording(n,buf));
      } catch (e) { console.warn('audio load failed', n, e); }
      done++; onProgress?.(done, names.length);
    }));
  }

  private makeNoise(seconds: number) {
    const len = Math.floor(this.ctx.sampleRate * seconds); const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return buf;
  }
  private makeImpulse(seconds: number, decay: number) {
    const len = Math.floor(this.ctx.sampleRate * seconds); const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1); } }
    return buf;
  }

  /** 2D (non-positional) playback. */
  play(name: string, o: PlayOpts = {}): AudioBufferSourceNode | null {
    const buf = this.buffers.get(name); if (!buf) return null;
    const score=o.bus==='ui'?4:o.bus==='gun'?3:1;
    if(!this.reserveVoice(false,score))return null;
    const src=this.ctx.createBufferSource();src.buffer=buf;src.loop=!!o.loop;
    src.playbackRate.value=(o.rate??1)*(o.rateVar?1+rand(-o.rateVar,o.rateVar):1);
    const g=this.ctx.createGain();g.gain.value=o.vol??1;const nodes:AudioNode[]=[src,g];
    let node:AudioNode=src;
    if(o.lowpass){const lp=this.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=o.lowpass;node.connect(lp);node=lp;nodes.push(lp);}
    if(o.highpass){const hp=this.ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=o.highpass;node.connect(hp);node=hp;nodes.push(hp);}
    if(o.pan!==undefined){const pn=this.ctx.createStereoPanner();pn.pan.value=clamp(o.pan,-1,1);node.connect(pn);node=pn;nodes.push(pn);}
    node.connect(g);g.connect(o.bus==='gun'?this.gunComp:o.bus==='ui'?this.ui:this.sfx);
    if(o.reverb){const rs=this.ctx.createGain();rs.gain.value=o.reverb;g.connect(rs);rs.connect(this.reverb);nodes.push(rs);}
    this.trackVoice(src,nodes,false,score,this.ctx.currentTime+(o.delay??0)+buf.duration/src.playbackRate.value);
    src.start(this.ctx.currentTime+(o.delay??0),o.offset??0);
    return src;
  }

  /** Pick a sample from a rotation set (never the same one twice in a row). */
  pick(names: string | string[]): string {
    if (typeof names === 'string') return names;
    const avail = names.filter((n) => this.buffers.has(n)); if (!avail.length) return names[0];
    if (avail.length === 1) return avail[0];
    const key = avail.join('|'); const last = this.lastPick.get(key) ?? -1;
    let i = Math.floor(Math.random() * avail.length); if (i === last) i = (i + 1) % avail.length;
    this.lastPick.set(key, i); return avail[i];
  }
  has(name: string) { return this.buffers.has(name); }

  /**
   * Layered first-person gunshot: main recording (rotated), mechanical action click, synthesized sub-thump and
   * crack transient, plus a distant echo tail — all through the compressed gun bus.
   */
  playGunshot(g: GunSound) {
    const t = this.ctx.currentTime;
    const main = this.pick(g.shot);
    this.play(main, { vol: g.vol ?? 1, rate: (g.rate ?? 1), rateVar: g.rateVar ?? 0.04, bus: 'gun', reverb: g.reverb ?? 0.35, offset: g.offset ?? 0 });
    if (g.layer) this.play(this.pick(g.layer), { vol: g.layerVol ?? 0.5, rate: g.layerRate ?? 1, rateVar: 0.03, bus: 'gun', delay: 0.004 });
    if (g.mech) this.play(this.pick(g.mech), { vol: g.mechVol ?? 0.45, rateVar: 0.05, bus: 'gun', delay: g.mechDelay ?? 0.0, highpass: 600 });
    if (g.sub) { this.tone(g.subFreq ?? 58, 'sine', 0.003, g.sub, g.subDecay ?? 0.22, this.gunComp, t, 32); }
    if (g.crack) { this.noise(0.001, g.crack, 0.022, { type: 'highpass', freq: 2400 }, this.gunComp, t); }
    if (g.echo) { const far = this.pick(g.echo); this.play(far, { vol: (g.echoVol ?? 0.35), rate: 0.9, rateVar: 0.04, delay: g.echoDelay ?? 0.26, lowpass: 1800, reverb: 0.7 }); if (g.echo2) this.play(far, { vol: (g.echoVol ?? 0.35) * 0.55, rate: 0.8, delay: (g.echoDelay ?? 0.26) + 0.42, lowpass: 1000, reverb: 0.8 }); }
  }

  /** Bounded positional playback with stereo panning and distance attenuation. */
  play3D(nameOrSet: string | string[], pos: THREE.Vector3, o: Play3DOpts = {}): AudioBufferSourceNode | null {
    const name=this.pick(nameOrSet),buf=this.buffers.get(name);if(!buf)return null;
    const distance=pos.distanceTo(this.listenerPos),ref=o.ref??4;
    const attenuation=ref/(ref+(o.rolloff??1.1)*Math.max(0,distance-ref));
    const score=(o.vol??1)*attenuation;
    if(distance>(o.max??200)||score<.004||!this.reserveVoice(true,score))return null;
    const src=this.ctx.createBufferSource();src.buffer=buf;src.loop=!!o.loop;
    src.playbackRate.value=(o.rate??1)*(o.rateVar?1+rand(-o.rateVar,o.rateVar):1);
    const p=this.makePanner(pos,o),g=this.ctx.createGain();g.gain.value=o.vol??1;
    const nodes:AudioNode[]=[src,p,g];let node:AudioNode=src;
    if(o.lowpass){const lp=this.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=o.lowpass;node.connect(lp);node=lp;nodes.push(lp);}
    if(o.highpass){const hp=this.ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=o.highpass;node.connect(hp);node=hp;nodes.push(hp);}
    node.connect(g);g.connect(p);p.connect(this.sfx);
    // Reverb follows distance and stereo placement too; distant impacts must not play at full volume.
    if(o.reverb!==0){const rs=this.ctx.createGain();rs.gain.value=o.reverb??.5;p.connect(rs);rs.connect(this.reverb);nodes.push(rs);}
    this.trackVoice(src,nodes,true,score,this.ctx.currentTime+(o.delay??0)+buf.duration/src.playbackRate.value);
    src.start(this.ctx.currentTime+(o.delay??0));
    return src;
  }

  private makePanner(pos: THREE.Vector3, o: Play3DOpts) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = o.ref ?? 4; p.maxDistance = o.max ?? 200; p.rolloffFactor = o.rolloff ?? 1.1;
    p.coneInnerAngle = 360;
    const t = this.ctx.currentTime;
    if (p.positionX) { p.positionX.setValueAtTime(pos.x, t); p.positionY.setValueAtTime(pos.y, t); p.positionZ.setValueAtTime(pos.z, t); }
    else (p as any).setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  updateListener(cam: THREE.Camera) {
    cam.getWorldPosition(this.listenerPos);
    this._fwd.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    this._up.set(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
    const L = this.ctx.listener; const t = this.ctx.currentTime;
    if ((L as any).positionX) {
      L.positionX.setValueAtTime(this.listenerPos.x, t); L.positionY.setValueAtTime(this.listenerPos.y, t); L.positionZ.setValueAtTime(this.listenerPos.z, t);
      L.forwardX.setValueAtTime(this._fwd.x, t); L.forwardY.setValueAtTime(this._fwd.y, t); L.forwardZ.setValueAtTime(this._fwd.z, t);
      L.upX.setValueAtTime(this._up.x, t); L.upY.setValueAtTime(this._up.y, t); L.upZ.setValueAtTime(this._up.z, t);
    } else {
      (L as any).setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      (L as any).setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, this._up.x, this._up.y, this._up.z);
    }
  }

  // ---------- Synthesized sounds ----------
  private env(g: GainNode, t0: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  private tone(freq: number, type: OscillatorType, a: number, peak: number, d: number, dest: AudioNode = this.ui, t0 = this.ctx.currentTime, slideTo?: number) {
    if(!this.reserveVoice(false,dest===this.ui?4:dest===this.gunComp?3:1))return null;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + d);
    const g = this.ctx.createGain(); this.env(g, t0, a, peak, d); o.connect(g); g.connect(dest); this.trackVoice(o,[o,g],false,dest===this.ui?4:dest===this.gunComp?3:1,t0+a+d+.05);o.start(t0); o.stop(t0 + a + d + 0.05);return o;
  }
  private noise(a: number, peak: number, d: number, filter: { type: BiquadFilterType; freq: number; q?: number; slideTo?: number }, dest: AudioNode = this.sfx, t0 = this.ctx.currentTime) {
    if(!this.reserveVoice(false,dest===this.ui?4:dest===this.gunComp?3:1))return null;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filter.type; f.frequency.setValueAtTime(filter.freq, t0); f.Q.value = filter.q ?? 1;
    if (filter.slideTo) f.frequency.exponentialRampToValueAtTime(filter.slideTo, t0 + a + d);
    const g = this.ctx.createGain(); this.env(g, t0, a, peak, d); s.connect(f); f.connect(g); g.connect(dest);this.trackVoice(s,[s,f,g],false,dest===this.ui?4:dest===this.gunComp?3:1,t0+a+d+.05); s.start(t0); s.stop(t0 + a + d + 0.05);
    return s;
  }

  /** Modern Warfare style hit marker: two bright, very short ticks (headshot adds a ring). */
  hitmarker(head = false) {
    const t = this.ctx.currentTime;
    this.tone(head ? 3300 : 2500, 'square', 0.001, 0.26, 0.022, this.ui, t);
    this.noise(0.001, 0.3, 0.016, { type: 'highpass', freq: 5200 }, this.ui, t);
    this.tone(head ? 2500 : 1900, 'square', 0.001, 0.2, 0.028, this.ui, t + 0.042);
    if (head) this.tone(4300, 'sine', 0.002, 0.14, 0.2, this.ui, t + 0.05);
  }
  /** Kill confirm: heavy "thunk" under the ticks. */
  killConfirm() {
    const t = this.ctx.currentTime;
    this.tone(210, 'triangle', 0.002, 0.55, 0.1, this.ui, t, 70);
    this.noise(0.001, 0.5, 0.05, { type: 'lowpass', freq: 1100 }, this.ui, t);
    this.tone(1800, 'square', 0.001, 0.22, 0.03, this.ui, t + 0.015);
    this.tone(2400, 'square', 0.001, 0.18, 0.03, this.ui, t + 0.07);
  }
  headshotDing() { const t = this.ctx.currentTime; this.tone(2200, 'sine', 0.002, 0.18, 0.25, this.ui, t); this.tone(3300, 'sine', 0.002, 0.1, 0.2, this.ui, t + 0.02); }
  uiHover() { this.tone(1200, 'sine', 0.003, 0.05, 0.05); }
  uiClick() { this.tone(700, 'square', 0.002, 0.08, 0.06); this.tone(1400, 'sine', 0.002, 0.08, 0.08); }
  dryFire() { const t = this.ctx.currentTime; this.tone(1800, 'square', 0.001, 0.12, 0.03, this.sfx, t); this.noise(0.001, 0.15, 0.02, { type: 'bandpass', freq: 2500, q: 2 }, this.sfx, t); }
  weaponSwitch() { const t = this.ctx.currentTime; this.noise(0.002, 0.22, 0.05, { type: 'bandpass', freq: 1800, q: 1.5 }, this.sfx, t); this.noise(0.002, 0.2, 0.06, { type: 'bandpass', freq: 900, q: 1.5 }, this.sfx, t + 0.09); }
  /** Layered bolt-action sniper report: two recordings, a sub thump, a sharp crack and a rolling echo. */
  sniperShot(near1: string, near2: string, far: string) {
    this.play(near1, { vol: 1.0, rate: 0.92, rateVar: 0.02, reverb: 0.5 });
    this.play(near2, { vol: 0.8, rate: 0.84, delay: 0.008, reverb: 0.4 });
    const t = this.ctx.currentTime;
    this.tone(52, 'sine', 0.003, 0.85, 0.3, this.sfx, t, 28);
    this.noise(0.001, 0.9, 0.03, { type: 'highpass', freq: 2600 }, this.sfx, t);
    this.play(far, { vol: 0.45, rate: 0.88, delay: 0.3, lowpass: 1500, reverb: 0.6 });
    this.play(far, { vol: 0.25, rate: 0.78, delay: 0.7, lowpass: 900, reverb: 0.6 });
  }
  boltCycle() { this.play('shotgun_pump', { vol: 0.4, rate: 0.72, rateVar: 0.03 }); const t = this.ctx.currentTime; this.noise(0.003, 0.35, 0.06, { type: 'bandpass', freq: 1400, q: 1.2 }, this.sfx, t); this.tone(420, 'triangle', 0.003, 0.18, 0.05, this.sfx, t); this.noise(0.003, 0.3, 0.08, { type: 'bandpass', freq: 2200, q: 1.2 }, this.sfx, t + 0.28); this.tone(520, 'triangle', 0.003, 0.15, 0.06, this.sfx, t + 0.29); }
  footstep(vol = 0.35, running = false) {
    const t = this.ctx.currentTime;
    this.noise(0.004, vol, running ? 0.09 : 0.12, { type: 'lowpass', freq: 900 + rand(-200, 200), q: 0.8 }, this.sfx, t);
    this.noise(0.002, vol * 0.5, 0.04, { type: 'bandpass', freq: 2400 + rand(-400, 400), q: 1.5 }, this.sfx, t);
  }
  whizz(pan = 0) {
    if (this.has('whizz_1')) { this.play(this.pick(['whizz_1', 'whizz_2', 'whizz_3']), { vol: 0.7, rateVar: 0.08, pan }); return; }
    const t = this.ctx.currentTime; const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(this.sfx);
    this.cleanAfter(this.noise(0.01, 0.35, 0.16, { type: 'bandpass', freq: 3800, q: 3, slideTo: 900 }, p, t),[p]);
  }
  ricochet(pos: THREE.Vector3) {
    if (this.has('ricochet_1')) { this.play3D(['ricochet_1', 'ricochet_2', 'ricochet_3'], pos, { vol: 0.55, rateVar: 0.08, ref: 3, rolloff: 1.3 }); return; }
    const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3, rolloff: 1.3 }); p.connect(this.sfx);
    this.cleanAfter(this.tone(2800 + rand(-600, 600), 'sine', 0.003, 0.35, 0.25, p, t, 900),[p]); this.noise(0.002, 0.3, 0.05, { type: 'highpass', freq: 3000 }, p, t);
  }
  /** Bullet impact by surface; uses recorded samples when present, else the synthesized fallback. */
  impactSurface(pos: THREE.Vector3, surface: string) {
    const set = surface === 'metal' ? ['imp_metal_1', 'imp_metal_2', 'imp_metal_3'] : surface === 'sand' || surface === 'rock' ? ['imp_dirt_1', 'imp_dirt_2', 'imp_dirt_3'] : surface === 'wood' ? ['imp_wood_1', 'imp_wood_2'] : ['imp_concrete_1', 'imp_concrete_2', 'imp_concrete_3'];
    if (this.has(set[0])) { this.play3D(set, pos, { vol: surface === 'metal' ? 0.7 : 0.6, rateVar: 0.1, ref: 3, rolloff: 1.3, max: 60 }); return; }
    this.impact(pos, surface === 'metal');
  }
  impact(pos: THREE.Vector3, metal: boolean) {
    const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3, rolloff: 1.3 }); p.connect(this.sfx);
    if (metal) { this.cleanAfter(this.tone(1800 + rand(-300, 400), 'triangle', 0.002, 0.3, 0.12, p, t),[p]); this.noise(0.002, 0.4, 0.06, { type: 'bandpass', freq: 3200, q: 2 }, p, t); }
    else { this.cleanAfter(this.noise(0.003, 0.5, 0.09, { type: 'lowpass', freq: 1200, q: 0.7 }, p, t),[p]); }
  }
  bodyHit(pos: THREE.Vector3) { const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3 }); p.connect(this.sfx); this.noise(0.003, 0.6, 0.08, { type: 'lowpass', freq: 500 }, p, t); this.cleanAfter(this.tone(120, 'sine', 0.003, 0.4, 0.08, p, t),[p]); }
  explosion(pos: THREE.Vector3, dist: number) {
    if (this.has('explosion_1')) {
      this.play3D(['explosion_1', 'explosion_2'], pos, { vol: 1.0, rateVar: 0.05, ref: 8, rolloff: 0.8, max: 400, reverb: 0.8 });
      if (this.has('explosion_far_1')) this.play3D('explosion_far_1', pos, { vol: 0.6, delay: 0.25, ref: 20, rolloff: 0.5, max: 600, lowpass: 900, reverb: 0.9 });
      const t0 = this.ctx.currentTime; this.tone(48, 'sine', 0.005, dist < 25 ? 0.9 * (1 - dist / 30) : 0.05, 0.6, this.sfx, t0, 26);
      if (dist < 9) this.tinnitus(1 - dist / 9);
      return;
    }
    const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 6, rolloff: 0.9, max: 400 }); p.connect(this.sfx);
    const rs = this.ctx.createGain(); rs.gain.value = 0.8; p.connect(rs); rs.connect(this.reverb);
    this.cleanAfter(this.noise(0.005, 1.2, 0.9, { type: 'lowpass', freq: 3000, q: 0.6, slideTo: 120 }, p, t),[p,rs]);
    this.tone(70, 'sine', 0.005, 1.0, 0.7, p, t, 30);
    this.noise(0.002, 0.7, 0.25, { type: 'highpass', freq: 1500 }, p, t);
    if (dist < 9) this.tinnitus(1 - dist / 9);
  }
  casing(pos: THREE.Vector3) { if (this.has('casing_1')) this.play3D(['casing_1', 'casing_2', 'casing_3'], pos, { vol: 0.35, rateVar: 0.1, ref: 2, rolloff: 1.5, max: 25, reverb: 0 }); else this.grenadeBounce(pos, 0.25); }
  grenadeBounce(pos: THREE.Vector3, strength: number) { const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3 }); p.connect(this.sfx); this.cleanAfter(this.tone(900 + rand(-200, 200), 'triangle', 0.002, 0.25 * strength, 0.09, p, t),[p]); this.noise(0.002, 0.2 * strength, 0.04, { type: 'bandpass', freq: 2000, q: 2 }, p, t); }
  grenadePin() { const t = this.ctx.currentTime; this.tone(2400, 'square', 0.002, 0.08, 0.03, this.sfx, t); this.noise(0.002, 0.2, 0.05, { type: 'bandpass', freq: 3000, q: 2 }, this.sfx, t + 0.04); }
  tinnitus(strength: number) {
    const t = this.ctx.currentTime;
    if (!this.tinnitusGain) { const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 5200; this.tinnitusGain = this.ctx.createGain(); this.tinnitusGain.gain.value = 0; o.connect(this.tinnitusGain); this.tinnitusGain.connect(this.ui); o.start(); }
    const g = this.tinnitusGain.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.12 * strength, t + 0.05); g.exponentialRampToValueAtTime(0.0001, t + 1.5 + 2 * strength);
  }
  uavPing() { const t = this.ctx.currentTime; this.tone(1180, 'sine', 0.004, 0.16, 0.28, this.ui, t); this.tone(1760, 'sine', 0.004, 0.12, 0.34, this.ui, t + 0.14); }
  streakEarned() { const t = this.ctx.currentTime; [660, 880, 1320].forEach((f, i) => this.tone(f, 'sine', 0.005, 0.16, 0.3, this.ui, t + i * 0.09)); }
  countdownBeep(final = false) { const t = this.ctx.currentTime; this.tone(final ? 1320 : 880, 'square', 0.004, final ? 0.12 : 0.08, final ? 0.35 : 0.12, this.ui, t); }
  /** Jet pass for the airstrike: swept band-passed noise with a doppler-like pitch drop and a low rumble. */
  jetFlyby() {
    if (this.has('jet_1')) { this.play('jet_1', { vol: 0.9, rateVar: 0.03 }); return; }
    if(!this.reserveVoice(false,1))return;
    const t = this.ctx.currentTime; const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 1.6); bp.frequency.exponentialRampToValueAtTime(260, t + 3.4);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    const pan = this.ctx.createStereoPanner(); pan.pan.setValueAtTime(-0.9, t); pan.pan.linearRampToValueAtTime(0.9, t + 3.4);
    s.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.sfx);this.trackVoice(s,[s,bp,g,pan],false,1,t+3.8); s.start(t); s.stop(t + 3.8);
    if(!this.reserveVoice(false,1))return;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(42, t + 3.2);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.35, t + 1.4); g2.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    o.connect(lp); lp.connect(g2); g2.connect(this.sfx);this.trackVoice(o,[o,lp,g2],false,1,t+3.6); o.start(t); o.stop(t + 3.6);
  }
  bombWhistle(delay: number) { const t = this.ctx.currentTime + delay; this.tone(1900, 'sine', 0.05, 0.16, 1.1, this.sfx, t, 500); }
  /** Low-health heartbeat intensity 0..1 (thumps are scheduled from update()). */
  setLowHealth(intensity: number) { this.lowHp = clamp(intensity, 0, 1); }
  update(dt: number) {
    if (this.lowHp > 0.02) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT = 1.2 - 0.6 * this.lowHp; const v = 0.18 + 0.3 * this.lowHp; const t = this.ctx.currentTime;
        this.tone(54, 'sine', 0.015, v, 0.16, this.ui, t); this.tone(46, 'sine', 0.015, v * 0.7, 0.16, this.ui, t + 0.19);
      }
    } else this.beatT = 0;
  }
  /** Soft desert wind bed: brown noise, low-passed, slow gusts. */
  startWind() {
    if (this.windNodes.length) return;
    if (this.has('wind_loop')) {
      const s = this.ctx.createBufferSource(); s.buffer = this.buffers.get('wind_loop')!; s.loop = true;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; const g = this.ctx.createGain(); g.gain.value = 0.05;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.04; const lg = this.ctx.createGain(); lg.gain.value = 0.015; lfo.connect(lg); lg.connect(g.gain);
      s.connect(lp); lp.connect(g); g.connect(this.sfx); s.start(0, Math.random() * 20); lfo.start();
      this.windNodes = [s, lp, this.ctx.createGain(), g, lfo, this.ctx.createOscillator()]; return;
    }
    const len = this.ctx.sampleRate * 8; const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } }
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.4;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 40;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.05; const lg = this.ctx.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = this.ctx.createOscillator(); lfo2.frequency.value = 0.085; const lg2 = this.ctx.createGain(); lg2.gain.value = 110; lfo2.connect(lg2); lg2.connect(lp.frequency);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.sfx); s.start(); lfo.start(); lfo2.start();
    this.windNodes = [s, lp, hp, g, lfo, lfo2];
  }
  setWind(v: number) { const g = this.windNodes[3] as GainNode | undefined; if (g) g.gain.value = 0.05 * clamp(v, 0, 2); }
}
