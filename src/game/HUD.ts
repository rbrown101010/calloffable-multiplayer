import * as THREE from 'three';
import { clamp, el, fmtTime, lerp } from './util';

export interface ScoreRow { name: string; score: number; kills: number; deaths: number; streak: number; me: boolean; }
export interface RadarBlip { pos: THREE.Vector3; alive: boolean; visible: boolean; }

export class HUD {
  root = el('hud');
  crosshair = el('crosshair'); hitmarkerEl = el('hitmarker'); scope = el('scope'); scopeRange = el('scope-range');
  dmgDirs = el('dmg-dirs'); flashEl = el('flash');
  mmCanvas = el<HTMLCanvasElement>('minimap-canvas'); mmCtx = this.mmCanvas.getContext('2d')!; compass = el('compass-heading');
  timer = el('timer'); scoreMe = el('score-me'); scoreTop = el('score-top');
  killfeed = el('killfeed');
  hpFill = el('hp-fill'); hpLag = el('hp-lag'); hpNum = el('hp-num');
  wpName = el('wp-name'); ammoMag = el('ammo-mag'); ammoRes = el('ammo-res'); wpMode = el('wp-mode'); wpSecondary = el('wp-secondary'); eqLethal = el('eq-lethal');
  centerMsgs = el('center-msgs'); streakEl = el('streak'); hintEl = el('hint');
  respawn = el('respawn'); killer = el('killer'); killerWeapon = el('killer-weapon'); respawnCount = el('respawn-count');
  scoreboard = el('scoreboard'); sbBody = el('sb-body'); sbTimer = el('sb-timer');
  streaksEl = el('streaks'); ammoWarn = el('ammo-warn'); private lastStreakHtml = '';
  hurt = 0; flashV = 0; hitT = 0;
  base: HTMLCanvasElement | null = null; baseSize = 70;
  private lastHp = 100;

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setCrosshair(spreadDeg: number, fovDeg: number, ads: number, hidden: boolean, scoped: boolean) {
    const h = innerHeight / 2; const px = Math.tan(spreadDeg * Math.PI / 180) * h / Math.tan(fovDeg * Math.PI / 360);
    this.crosshair.style.setProperty('--gap', `${clamp(px + 3, 3, 90)}px`);
    this.crosshair.classList.toggle('ads', ads > 0.6 && !scoped);
    this.crosshair.classList.toggle('hide', hidden || (scoped && ads > 0.5));
  }
  hitmarker(kind: 'hit' | 'head' | 'kill') {
    const e = this.hitmarkerEl; e.classList.remove('show', 'head', 'kill'); void e.offsetWidth;
    e.classList.add('show'); if (kind !== 'hit') e.classList.add(kind);
    if (kind === 'kill') { this.crosshair.classList.add('kill'); setTimeout(() => this.crosshair.classList.remove('kill'), 260); }
  }
  nadeWarn = el('nade-warn');
  /** Grenade danger indicator: angle relative to view (0 = ahead), urgency 0..1. */
  setGrenadeWarning(angle: number | null, urgency = 0) {
    if (angle === null) { this.nadeWarn.classList.remove('show'); return; }
    this.nadeWarn.classList.add('show'); this.nadeWarn.style.transform = `rotate(${angle}rad)`; this.nadeWarn.style.setProperty('--urg', String(urgency));
  }
  killcamEl = el('killcam'); killcamBar = el('kc-fill');
  showKillcam(killer: string, weapon: string, victim: string) { this.killcamEl.classList.remove('hidden'); el('kc-killer').textContent = killer; el('kc-weapon').textContent = weapon; el('kc-victim').textContent = victim; this.killcamBar.style.width = '0%'; }
  setKillcamProgress(p: number) { this.killcamBar.style.width = `${clamp(p, 0, 1) * 100}%`; }
  hideKillcam() { this.killcamEl.classList.add('hidden'); }
  setScope(on: boolean, range: number | null) { this.scope.classList.toggle('hidden', !on); if (on) this.scopeRange.textContent = range === null ? '--- m' : `${range.toFixed(0).padStart(3, ' ')} m`; }
  setHealth(hp: number, max: number) {
    const pct = clamp(hp / max, 0, 1) * 100;
    this.hpFill.style.width = pct + '%'; this.hpFill.classList.toggle('low', hp < 40);
    this.hpNum.textContent = Math.ceil(hp).toString();
    if (hp >= this.lastHp) this.hpLag.style.width = pct + '%'; else setTimeout(() => { this.hpLag.style.width = pct + '%'; }, 250);
    this.lastHp = hp;
  }
  damage(intensity: number, angle: number | null) {
    this.hurt = Math.min(1, this.hurt + intensity);
    if (angle !== null) { const d = document.createElement('div'); d.className = 'dmg-dir'; d.style.transform = `rotate(${angle}rad)`; this.dmgDirs.appendChild(d); setTimeout(() => d.remove(), 1000); }
  }
  flash(v: number) { this.flashV = Math.max(this.flashV, v); }
  setWeapon(name: string, mode: string, secondary: string) { this.wpName.textContent = name; this.wpMode.textContent = mode; this.wpSecondary.textContent = secondary; }
  setAmmo(mag: number, res: number, magSize: number, reloading: boolean) {
    this.ammoMag.textContent = mag.toString(); this.ammoRes.textContent = res.toString();
    this.ammoMag.classList.toggle('low', mag <= Math.max(1, Math.floor(magSize * 0.25)) && !reloading); this.ammoMag.classList.toggle('reloading', reloading);
  }
  setStreaks(streak: number, uav: 'locked' | 'ready' | 'active', air: 'locked' | 'ready' | 'active', chopper: 'locked' | 'ready' | 'active' = 'locked', randomName = 'RANDOM REWARD') {
    const chip = (key: string, name: string, need: number, st: string) => `<div class="sk ${st}"><b>${key}</b><span>${name}</span><i>${st === 'locked' ? `${Math.min(streak, need)}/${need}` : st === 'ready' ? 'READY' : 'ACTIVE'}</i></div>`;
    const html = chip('3', 'UAV', 3, uav) + chip('4', randomName, 5, air) + chip('5', 'CHOPPER GUNNER', 9, chopper);
    if (html !== this.lastStreakHtml) { this.streaksEl.innerHTML = html; this.lastStreakHtml = html; }
  }
  setAmmoWarn(text: string | null) { if ((this.ammoWarn.textContent || '') !== (text || '')) this.ammoWarn.textContent = text || ''; }
  targetName = el('target-name'); private lastTarget = '';
  setTargetName(name: string | null) { const n = name || ''; if (n !== this.lastTarget) { this.lastTarget = n; this.targetName.textContent = n; this.targetName.classList.toggle('show', !!n); } }
  setLethal(n: number) { this.eqLethal.innerHTML = `<b>G</b> FRAG ×${n}`; this.eqLethal.classList.toggle('empty', n <= 0); }
  setTimer(s: number) { this.timer.textContent = fmtTime(s); this.timer.classList.toggle('low', s < 30); this.sbTimer.textContent = fmtTime(s); }
  setScores(me: number, top: number) { this.scoreMe.textContent = me.toString(); this.scoreTop.textContent = top.toString(); }
  feed(killer: string, victim: string, weapon: string, headshot: boolean, who: 'killer' | 'victim' | null) {
    const d = document.createElement('div'); d.className = 'kf' + (who === 'killer' ? ' me' : who === 'victim' ? ' victim' : '');
    d.innerHTML = `<span>${killer}</span><span class="w">${weapon}</span><span>${victim}</span>${headshot ? '<span class="hs">HEADSHOT</span>' : ''}`;
    this.killfeed.appendChild(d); while (this.killfeed.children.length > 6) this.killfeed.firstElementChild?.remove();
    setTimeout(() => d.classList.add('out'), 5000); setTimeout(() => d.remove(), 5600);
  }
  centerMsg(text: string, pts?: string, cls = '') {
    const d = document.createElement('div'); d.className = 'cmsg ' + cls; d.innerHTML = `${text}${pts ? `<span class="pts">${pts}</span>` : ''}`;
    this.centerMsgs.appendChild(d); while (this.centerMsgs.children.length > 3) this.centerMsgs.firstElementChild?.remove(); setTimeout(() => d.remove(), 1700);
  }
  streak(text: string) { const e = this.streakEl; e.textContent = text; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
  hint(text: string | null) { if (text) { this.hintEl.textContent = text; this.hintEl.classList.add('show'); } else this.hintEl.classList.remove('show'); }
  showRespawn(killer: string, weapon: string) { this.respawn.classList.remove('hidden'); this.killer.textContent = killer; this.killerWeapon.textContent = weapon; }
  setRespawnCount(s: number) { this.respawnCount.textContent = Math.ceil(s).toString(); }
  hideRespawn() { this.respawn.classList.add('hidden'); }
  showScoreboard(on: boolean, rows?: ScoreRow[]) {
    this.scoreboard.classList.toggle('hidden', !on);
    if (on && rows) this.sbBody.innerHTML = rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="rank">${i + 1}</td><td class="l">${r.name}</td><td>${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${(r.kills / Math.max(1, r.deaths)).toFixed(2)}</td><td>${r.streak}</td></tr>`).join('');
  }

  setMinimapBase(c: HTMLCanvasElement, worldSize: number) { this.base = c; this.baseSize = worldSize; }

  /** Rotating radar centered on the player. */
  drawMinimap(pPos: THREE.Vector3, yaw: number, blips: RadarBlip[], time: number, uav = false) {
    const ctx = this.mmCtx, W = this.mmCanvas.width, H = this.mmCanvas.height, cx = W / 2, cy = H / 2;
    const viewRadius = 34; const scale = (W / 2) / viewRadius; // px per meter
    ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1a1712'; ctx.fillRect(0, 0, W, H);
    if (this.base) {
      const s = this.base.width / this.baseSize; // base px per meter
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(yaw); ctx.scale(scale / s, scale / s);
      ctx.translate(-(pPos.x + this.baseSize / 2) * s, -(pPos.z + this.baseSize / 2) * s);
      ctx.globalAlpha = 0.95; ctx.drawImage(this.base, 0, 0); ctx.restore();
    }
    // grid rings
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (const r of [viewRadius / 3, viewRadius * 2 / 3]) { ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, Math.PI * 2); ctx.stroke(); }
    // enemy blips (world -> rotated radar)
    for (const b of blips) {
      if (!b.alive || !(b.visible || uav)) continue;
      const dx = b.pos.x - pPos.x, dz = b.pos.z - pPos.z;
      const rx = dx * Math.cos(yaw) + dz * Math.sin(yaw); const rz = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const px = cx + rx * scale, py = cy + rz * scale; if (Math.hypot(px - cx, py - cy) > W / 2 - 6) continue;
      ctx.fillStyle = '#ff3b2e'; ctx.shadowColor = '#ff3b2e'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    // view cone
    const cone = ctx.createRadialGradient(cx, cy, 0, cx, cy, W / 2); cone.addColorStop(0, 'rgba(255,255,255,0.28)'); cone.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, W / 2, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); ctx.closePath(); ctx.fill();
    // player arrow
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 6, cy + 6); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx - 6, cy + 6); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    // sweep
    const a = (time * 1.2) % (Math.PI * 2); ctx.strokeStyle = 'rgba(240,160,48,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * W / 2, cy + Math.sin(a) * W / 2); ctx.stroke();
    ctx.restore();
    if (uav) { ctx.fillStyle = '#f0a030'; ctx.font = 'bold 13px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('UAV', cx, H - 14); ctx.strokeStyle = 'rgba(240,160,48,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 3, 0, Math.PI * 2); ctx.stroke(); }
    // compass
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360; const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    this.compass.textContent = `${dirs[Math.round(deg / 45) % 8]} ${Math.round(deg).toString().padStart(3, '0')}°`;
  }

  update(dt: number, hp: number) {
    this.hurt = Math.max(0, this.hurt - dt * 1.4);
    const low = hp < 45 ? (1 - hp / 45) * 0.75 : 0;
    const pulse = hp < 30 ? (Math.sin(performance.now() / 1000 * 4) * 0.5 + 0.5) * 0.25 : 0;
    document.documentElement.style.setProperty('--hurt', String(clamp(Math.max(this.hurt, low + pulse), 0, 1)));
    this.flashV = Math.max(0, this.flashV - dt * 1.6); this.flashEl.style.opacity = String(clamp(this.flashV, 0, 1));
  }
}
