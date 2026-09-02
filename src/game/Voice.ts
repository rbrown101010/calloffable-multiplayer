import type { AudioManager } from './Audio';
import type * as THREE from 'three';

/** CoD-style voice: a prioritized announcer queue, the player's operator callouts and spatialized enemy chatter. */
export class Voice {
  private queue: { key: string; pri: number }[] = [];
  private busy = false;
  private lastAnn = new Map<string, number>(); private lastOp = new Map<string, number>(); private lastBot = new Map<any, number>();
  enabled = true;
  constructor(private audio: AudioManager) {}
  private now() { return performance.now() / 1000; }

  announce(key: string, pri = 1, cooldown = 6) {
    const name = `vo_ann_${key}`; if (!this.enabled || !this.audio.has(name)) return;
    const t = this.now(); if (t - (this.lastAnn.get(key) ?? -99) < cooldown) return; this.lastAnn.set(key, t);
    if (this.queue.some((q) => q.key === key)) return;
    this.queue.push({ key, pri }); this.queue.sort((a, b) => b.pri - a.pri);
    if (this.queue.length > 3) this.queue.length = 3;
    this.pump();
  }
  private pump() {
    if (this.busy || !this.queue.length) return;
    const { key } = this.queue.shift()!; const src = this.audio.play(`vo_ann_${key}`, { vol: 1.0, bus: 'ui' });
    if (!src) { this.pump(); return; }
    this.busy = true; src.onended = () => { this.busy = false; setTimeout(() => this.pump(), 250); };
  }
  operator(key: string, cooldown = 4) {
    const name = `vo_op_${key}`; if (!this.enabled || !this.audio.has(name)) return;
    const t = this.now(); if (t - (this.lastOp.get(key) ?? -99) < cooldown || t - (this.lastOp.get('_any') ?? -99) < 1.2) return;
    this.lastOp.set(key, t); this.lastOp.set('_any', t);
    this.audio.play(name, { vol: 0.85, rateVar: 0.02, highpass: 120 });
  }
  bot(bot: any, key: string, pos: THREE.Vector3, cooldown = 5) {
    const v = (bot.id % 2) + 1; const name = `vo_bot${v}_${key}`; if (!this.enabled || !this.audio.has(name)) return;
    const t = this.now(); if (t - (this.lastBot.get(bot) ?? -99) < cooldown) return; this.lastBot.set(bot, t);
    this.audio.play3D(name, pos, { vol: 0.95, rateVar: 0.03, ref: 5, rolloff: 1.1, max: 55, reverb: 0.25 });
  }
}
