import * as THREE from 'three';
import { clamp, rand } from './util';

export interface PlayOpts { vol?: number; rate?: number; rateVar?: number; delay?: number; loop?: boolean; lowpass?: number; reverb?: number; }
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
  private listenerPos = new THREE.Vector3();
  private _fwd = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private noiseBuf!: AudioBuffer;
  private windNodes: AudioNode[] = [];
  private lowHp = 0; private beatT = 0;
  private tinnitusGain?: GainNode;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 18; this.comp.ratio.value = 6; this.comp.attack.value = 0.002; this.comp.release.value = 0.18;
    this.sfx = this.ctx.createGain();
    this.ui = this.ctx.createGain();
    this.sfx.connect(this.comp); this.ui.connect(this.comp); this.comp.connect(this.master); this.master.connect(this.ctx.destination);
    this.master.gain.value = 0.8;
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
        this.buffers.set(n, buf);
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
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = !!o.loop;
    src.playbackRate.value = (o.rate ?? 1) * (o.rateVar ? 1 + rand(-o.rateVar, o.rateVar) : 1);
    const g = this.ctx.createGain(); g.gain.value = o.vol ?? 1;
    let node: AudioNode = src;
    if (o.lowpass) { const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lowpass; node.connect(lp); node = lp; }
    node.connect(g); g.connect(this.sfx);
    if ((o as any).reverb) { const rs = this.ctx.createGain(); rs.gain.value = (o as any).reverb; g.connect(rs); rs.connect(this.reverb); }
    src.start(this.ctx.currentTime + (o.delay ?? 0));
    return src;
  }

  /** Positional playback with HRTF panning and distance attenuation. */
  play3D(name: string, pos: THREE.Vector3, o: Play3DOpts = {}): AudioBufferSourceNode | null {
    const buf = this.buffers.get(name); if (!buf) return null;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = !!o.loop;
    src.playbackRate.value = (o.rate ?? 1) * (o.rateVar ? 1 + rand(-o.rateVar, o.rateVar) : 1);
    const p = this.makePanner(pos, o);
    const g = this.ctx.createGain(); g.gain.value = o.vol ?? 1;
    let node: AudioNode = src;
    if (o.lowpass) { const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lowpass; node.connect(lp); node = lp; }
    node.connect(g); g.connect(p); p.connect(this.sfx);
    if (o.reverb !== 0) { const rs = this.ctx.createGain(); rs.gain.value = (o.reverb ?? 0.5); g.connect(rs); rs.connect(this.reverb); }
    src.start(this.ctx.currentTime + (o.delay ?? 0));
    src.onended = () => { try { p.disconnect(); g.disconnect(); } catch {} };
    return src;
  }

  private makePanner(pos: THREE.Vector3, o: Play3DOpts) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
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
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + d);
    const g = this.ctx.createGain(); this.env(g, t0, a, peak, d); o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + a + d + 0.05);
  }
  private noise(a: number, peak: number, d: number, filter: { type: BiquadFilterType; freq: number; q?: number; slideTo?: number }, dest: AudioNode = this.sfx, t0 = this.ctx.currentTime) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filter.type; f.frequency.setValueAtTime(filter.freq, t0); f.Q.value = filter.q ?? 1;
    if (filter.slideTo) f.frequency.exponentialRampToValueAtTime(filter.slideTo, t0 + a + d);
    const g = this.ctx.createGain(); this.env(g, t0, a, peak, d); s.connect(f); f.connect(g); g.connect(dest); s.start(t0); s.stop(t0 + a + d + 0.05);
    return g;
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
    const t = this.ctx.currentTime; const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(this.sfx);
    this.noise(0.01, 0.35, 0.16, { type: 'bandpass', freq: 3800, q: 3, slideTo: 900 }, p, t);
  }
  ricochet(pos: THREE.Vector3) {
    const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3, rolloff: 1.3 }); p.connect(this.sfx);
    this.tone(2800 + rand(-600, 600), 'sine', 0.003, 0.35, 0.25, p, t, 900); this.noise(0.002, 0.3, 0.05, { type: 'highpass', freq: 3000 }, p, t);
  }
  impact(pos: THREE.Vector3, metal: boolean) {
    const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3, rolloff: 1.3 }); p.connect(this.sfx);
    if (metal) { this.tone(1800 + rand(-300, 400), 'triangle', 0.002, 0.3, 0.12, p, t); this.noise(0.002, 0.4, 0.06, { type: 'bandpass', freq: 3200, q: 2 }, p, t); }
    else { this.noise(0.003, 0.5, 0.09, { type: 'lowpass', freq: 1200, q: 0.7 }, p, t); }
  }
  bodyHit(pos: THREE.Vector3) { const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3 }); p.connect(this.sfx); this.noise(0.003, 0.6, 0.08, { type: 'lowpass', freq: 500 }, p, t); this.tone(120, 'sine', 0.003, 0.4, 0.08, p, t); }
  explosion(pos: THREE.Vector3, dist: number) {
    const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 6, rolloff: 0.9, max: 400 }); p.connect(this.sfx);
    const rs = this.ctx.createGain(); rs.gain.value = 0.8; p.connect(rs); rs.connect(this.reverb);
    this.noise(0.005, 1.2, 0.9, { type: 'lowpass', freq: 3000, q: 0.6, slideTo: 120 }, p, t);
    this.tone(70, 'sine', 0.005, 1.0, 0.7, p, t, 30);
    this.noise(0.002, 0.7, 0.25, { type: 'highpass', freq: 1500 }, p, t);
    if (dist < 9) this.tinnitus(1 - dist / 9);
  }
  grenadeBounce(pos: THREE.Vector3, strength: number) { const t = this.ctx.currentTime; const p = this.makePanner(pos, { ref: 3 }); p.connect(this.sfx); this.tone(900 + rand(-200, 200), 'triangle', 0.002, 0.25 * strength, 0.09, p, t); this.noise(0.002, 0.2 * strength, 0.04, { type: 'bandpass', freq: 2000, q: 2 }, p, t); }
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
    const t = this.ctx.currentTime; const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 1.6); bp.frequency.exponentialRampToValueAtTime(260, t + 3.4);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    const pan = this.ctx.createStereoPanner(); pan.pan.setValueAtTime(-0.9, t); pan.pan.linearRampToValueAtTime(0.9, t + 3.4);
    s.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.sfx); s.start(t); s.stop(t + 3.8);
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(42, t + 3.2);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.35, t + 1.4); g2.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    o.connect(lp); lp.connect(g2); g2.connect(this.sfx); o.start(t); o.stop(t + 3.6);
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
