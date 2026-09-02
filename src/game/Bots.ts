import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SoldierPuppet } from './Puppet';
import { Physics, G, cg } from './Physics';
import { RustMap, Waypoint } from './Map';
import { WeaponDef, WEAPONS, LOADOUTS, Loadout } from './WeaponDefs';
import { Bullets, coneDir } from './Weapons';
import { Effects } from './Effects';
import { AudioManager } from './Audio';
import { Player } from './Player';
import { clamp, damp, DEG, lerp, rand, pick, wrapAngle } from './util';

export type BotState = 'patrol' | 'hunt' | 'engage' | 'retreat' | 'cover' | 'dead';
export interface Target { entity: any; pos: THREE.Vector3; head: THREE.Vector3; alive: boolean; name: string; }

const CAP_HH = 0.54, CAP_R = 0.36;
export const DEBUG = { freeze: new URLSearchParams(location.search).has('botfreeze'), passive: new URLSearchParams(location.search).has('passive'), ghost: new URLSearchParams(location.search).has('ghost') };

export class Bot {
  id: number; name: string; loadout: Loadout; def: WeaponDef; mag: number; reserve: number; skill: number;
  body: RAPIER.RigidBody; collider: RAPIER.Collider; cc: RAPIER.KinematicCharacterController; hitHead: RAPIER.Collider; hitBody: RAPIER.Collider; hitLegs: RAPIER.Collider;
  pos = new THREE.Vector3(); vel = new THREE.Vector3(); yaw = 0; aimYaw = 0; aimPitch = 0; grounded = false;
  state: BotState = 'patrol'; health = 100; alive = true; respawnT = 0; deathT = 0;
  path: number[] = []; node = -1; goal = -1; repathT = 0; stuckT = 0; lastPos = new THREE.Vector3();
  target: Target | null = null; lastSeen = new THREE.Vector3(); lastSeenT = -99; seeT = 0; visible = false; perceiveT = 0; reactionT = 0;
  fireT = 0; burstLeft = 0; burstPause = 0; reloading = false; reloadT = 0; strafeDir = 0; strafeT = 0; crouch = false;
  retreatT = 0; hurtT = -99; lastDamageFrom: any = null; alertPos: THREE.Vector3 | null = null; alertT = -99;
  kills = 0; deaths = 0; score = 0; streak = 0; strideAcc = 0; grenadeT = 12; dmgMul = 0.85;
  coverT = 0; coverCd = 0; dangerT = 0; deathDir = new THREE.Vector3(0, 0, 1); flinch = 0; onHurt?: () => void;
  puppet: SoldierPuppet | null = null; muzzle = new THREE.Object3D();
  get model(): THREE.Group | null { return this.puppet ? this.puppet.model : null; }
  climbing = false; climbTarget: THREE.Vector3 | null = null;
  colliderHandles = new Set<number>();
  private _v = new THREE.Vector3(); private _w = new THREE.Vector3();

  constructor(public physics: Physics, id: number, name: string, loadout: Loadout, skill: number) {
    this.id = id; this.name = name; this.loadout = loadout; this.skill = skill;
    this.def = WEAPONS[loadout.primary]; this.mag = this.def.mag; this.reserve = this.def.reserve * 4;
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(CAP_HH, CAP_R).setCollisionGroups(cg(G.BOT, G.WORLD | G.PLAYER | G.BOT | G.GRENADE | G.DEBRIS)).setFriction(0), this.body);
    // hitboxes (sensors): head sphere, torso capsule, legs capsule
    // hitboxes are sensors in the HITBOX group; only bullet raycasts query that group, so movement is unaffected
    this.hitHead = physics.world.createCollider(R.ColliderDesc.ball(0.15).setTranslation(0, 0.66, 0).setSensor(true).setCollisionGroups(cg(G.HITBOX, G.ALL)), this.body);
    this.hitBody = physics.world.createCollider(R.ColliderDesc.capsule(0.22, 0.24).setTranslation(0, 0.2, 0).setSensor(true).setCollisionGroups(cg(G.HITBOX, G.ALL)), this.body);
    this.hitLegs = physics.world.createCollider(R.ColliderDesc.capsule(0.3, 0.2).setTranslation(0, -0.5, 0).setSensor(true).setCollisionGroups(cg(G.HITBOX, G.ALL)), this.body);
    physics.setOwner(this.hitHead, { entity: this, part: 'head' }); physics.setOwner(this.hitBody, { entity: this, part: 'body' }); physics.setOwner(this.hitLegs, { entity: this, part: 'legs' }); physics.setOwner(this.collider, { entity: this, part: 'body', surface: 'flesh' });
    for (const c of [this.collider, this.hitHead, this.hitBody, this.hitLegs]) this.colliderHandles.add(c.handle);
    this.cc = physics.world.createCharacterController(0.03); this.cc.enableAutostep(0.5, 0.25, true); this.cc.enableSnapToGround(0.4); this.cc.setMaxSlopeClimbAngle(56 * DEG); this.cc.setMinSlopeSlideAngle(62 * DEG);
  }

  get feetY() { return this.pos.y - CAP_HH - CAP_R; }
  get eyePos() { return this._v.set(this.pos.x, this.pos.y + 0.66, this.pos.z); }
  get chestPos() { return this._w.set(this.pos.x, this.pos.y + 0.25, this.pos.z); }
  get headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.66, this.pos.z); }

  async loadVisuals(scene: THREE.Scene) {
    this.puppet = await SoldierPuppet.create(scene);
    await this.puppet.setWeapon(this.def);
    this.muzzle = this.puppet.muzzle;
  }

  spawnAt(p: THREE.Vector3, yaw: number) {
    this.pos.set(p.x, p.y + CAP_HH + CAP_R + 0.05, p.z); this.vel.set(0, 0, 0); this.yaw = yaw; this.aimYaw = yaw; this.aimPitch = 0;
    this.body.setNextKinematicTranslation(this.pos); this.body.setTranslation(this.pos, true);
    this.health = 100; this.alive = true; this.state = 'patrol'; this.target = null; this.path = []; this.node = -1; this.goal = -1; this.reloading = false; this.mag = this.def.mag; this.crouch = false; this.climbing = false;
    this.visible = false; this.seeT = 0; this.streak = 0; this.deathT = 0; this.alertPos = null;
    for (const c of [this.collider, this.hitHead, this.hitBody, this.hitLegs]) c.setEnabled(true);
    this.body.setTranslation(this.pos, true);
    if (this.model) { this.model.visible = true; }
  }

  onDeath?: (attacker: any, weapon: string, headshot: boolean) => void;
  takeDamage(amount: number, attacker: any, part: string, weapon = '', _from: THREE.Vector3 | null = null): boolean {
    if (!this.alive) return false;
    this.health -= amount; this.hurtT = performance.now() / 1000; this.lastDamageFrom = attacker; this.flinch = Math.min(1, this.flinch + amount / 60);
    const src = _from ?? (attacker && attacker.pos ? attacker.pos : null);
    if (src) { this.deathDir.set(this.pos.x - src.x, 0, this.pos.z - src.z); if (this.deathDir.lengthSq() < 1e-4) this.deathDir.set(0, 0, 1); this.deathDir.normalize(); }
    this.onHurt?.();
    if (attacker && attacker !== this) { this.alertPos = attacker.pos ? attacker.pos.clone() : null; this.alertT = this.hurtT; if (!this.target) this.reactionT = Math.min(this.reactionT, 0.15); }
    if (this.health <= 0) { this.health = 0; this.die(); this.onDeath?.(attacker, weapon, part === 'head'); return true; }
    return false;
  }

  die() {
    this.alive = false; this.state = 'dead'; this.deathT = 0; this.respawnT = 4.5; this.deaths++; this.streak = 0; this.target = null;
    for (const c of [this.collider, this.hitHead, this.hitBody, this.hitLegs]) c.setEnabled(false);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: -60, z: this.pos.z });
  }

  updateVisuals(dt: number) {
    const P = this.puppet; if (!P) return;
    if (!this.alive) {
      this.deathT += dt;
      P.update(dt, { pos: this.pos, feetY: this.feetY, yaw: this.yaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch, speed: 0, alive: false, deathT: this.deathT, deathDir: this.deathDir });
      if (this.deathT > 3.5) P.setVisible(false);
      return;
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let faceYaw = this.yaw;
    if (this.target && (this.state === 'engage' || this.state === 'hunt')) faceYaw = this.aimYaw;
    else if (sp > 0.5) faceYaw = Math.atan2(this.vel.x, this.vel.z);
    this.yaw = this.yaw + wrapAngle(faceYaw - this.yaw) * Math.min(1, dt * 9);
    this.flinch = Math.max(0, this.flinch - dt * 3);
    P.update(dt, { pos: this.pos, feetY: this.feetY, yaw: this.yaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch, speed: sp, alive: true, deathT: 0, flinch: this.flinch, crouch: this.crouch });
  }
}

export interface BotEvents {
  onKill: (killer: any, victim: any, weapon: string, headshot: boolean) => void;
  onShot: (bot: Bot, pos: THREE.Vector3) => void;
  onStep?: (bot: Bot, running: boolean) => void;
  onSpot?: (bot: Bot) => void;
  onHurt?: (bot: Bot) => void;
  onReload?: (bot: Bot) => void;
  onGrenade?: (bot: Bot, pos: THREE.Vector3, vel: THREE.Vector3, fuse: number) => void;
}

export class BotManager {
  bots: Bot[] = [];
  /** Match-start countdown / menu: bots do not think or move. */
  frozen = false;
  /** Live grenade positions (fed by the game) that bots try to get away from. */
  dangerZones: THREE.Vector3[] = [];
  playerTarget!: Target;
  private _tmp = new THREE.Vector3(); private _dir = new THREE.Vector3();
  constructor(private physics: Physics, private scene: THREE.Scene, private map: RustMap, private bullets: Bullets, private effects: Effects, private audio: AudioManager, private player: Player, private events: BotEvents) {}

  async create(names: string[], skills: number[]) {
    for (let i = 0; i < names.length; i++) {
      const lo = LOADOUTS[(i + 1 + Math.floor(Math.random() * 2)) % LOADOUTS.length];
      const b = new Bot(this.physics, i + 1, names[i], lo, skills[i]);
      await b.loadVisuals(this.scene);
      b.onHurt = () => this.events.onHurt?.(b);
      b.puppet?.setTint([0xd8cdb5, 0xb9b3a4, 0xcbbf9d, 0xa9a08c, 0xd0c4a8, 0xbdb39b, 0xc9c0ae][i % 7]);
      this.bots.push(b);
    }
  }

  /** Spawn point farthest from all enemies (with randomness). */
  pickSpawn(forEntity: any) {
    const others: THREE.Vector3[] = [];
    if (this.player.alive && forEntity !== this.player) others.push(this.player.pos);
    for (const b of this.bots) if (b.alive && b !== forEntity) others.push(b.pos);
    let best = this.map.spawns[0], bs = -1;
    for (const s of this.map.spawns) {
      let d = 1e9; for (const o of others) d = Math.min(d, s.pos.distanceTo(o));
      const score = Math.min(d, 40) + rand(0, 10); if (score > bs) { bs = score; best = s; }
    }
    return best;
  }

  spawnAll() { for (const b of this.bots) { const s = this.pickSpawn(b); b.spawnAt(s.pos, s.yaw + Math.PI); } }
  /** Alert bots near a position (gunfire / explosion). */
  alert(pos: THREE.Vector3, radius: number, source: any, time: number) {
    for (const b of this.bots) { if (!b.alive || b === source) continue; if (b.pos.distanceTo(pos) < radius && !b.visible) { b.alertPos = pos.clone(); b.alertT = time; if (b.state === 'patrol') { b.state = 'hunt'; b.lastSeen.copy(pos); b.lastSeenT = time - 2; b.repathT = 0; } } }
  }
  get victims() { const v: { entity: any; pos: THREE.Vector3; alive: boolean }[] = [{ entity: this.player, pos: this.player.pos.clone(), alive: this.player.alive }]; for (const b of this.bots) v.push({ entity: b, pos: b.pos.clone(), alive: b.alive }); return v; }

  private targets(forBot: Bot): Target[] {
    const list: Target[] = [];
    if (this.player.alive && !DEBUG.ghost) list.push({ entity: this.player, pos: this.player.pos.clone().add(new THREE.Vector3(0, 0.15, 0)), head: this.player.eyePos.clone(), alive: true, name: 'YOU' });
    for (const b of this.bots) if (b !== forBot && b.alive) list.push({ entity: b, pos: b.chestPos.clone(), head: b.headPos, alive: true, name: b.name });
    return list;
  }

  update(dt: number, time: number) {
    for (const b of this.bots) {
      if (!b.alive) { b.respawnT -= dt; if (b.respawnT <= 0) { const s = this.pickSpawn(b); b.spawnAt(s.pos, s.yaw + Math.PI); } b.updateVisuals(dt); continue; }
      if (this.frozen) { b.updateVisuals(dt); continue; }
      this.think(b, dt, time);
      this.move(b, dt);
      b.updateVisuals(dt);
      // footsteps (positional, so the player can hear enemies approach)
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (b.grounded && sp > 0.8) { b.strideAcc += sp * dt; const stride = sp > 4.2 ? 2.5 : 1.9; if (b.strideAcc > stride) { b.strideAcc = 0; this.events.onStep?.(b, sp > 4.2); } }
    }
  }

  private think(b: Bot, dt: number, time: number) {
    if (DEBUG.freeze) { b.path = []; b.goal = -1; b.state = 'patrol'; b.target = null; return; }
    // ---- perception (throttled)
    b.perceiveT -= dt;
    if (b.perceiveT <= 0) {
      b.perceiveT = 0.12;
      const eye = b.eyePos.clone(); let best: Target | null = null, bestD = 1e9; let sawCurrent = false;
      for (const t of this.targets(b)) {
        const d = eye.distanceTo(t.pos); if (d > 75) continue;
        const dir = this._dir.subVectors(t.pos, eye).normalize();
        const fwd = new THREE.Vector3(Math.sin(b.aimYaw), 0, Math.cos(b.aimYaw));
        const ang = Math.acos(clamp(fwd.dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()), -1, 1));
        const inFov = ang < (b.target?.entity === t.entity ? 110 : 80) * DEG || d < 5;
        if (!inFov) continue;
        const vis = this.physics.clearLine(eye, t.pos) || this.physics.clearLine(eye, t.head);
        if (!vis) continue;
        if (b.target?.entity === t.entity) sawCurrent = true;
        // threat weighting: whoever hurt us recently counts as much closer
        const score = d * (t.entity === b.lastDamageFrom && time - b.hurtT < 4 ? 0.45 : 1);
        if (score < bestD) { bestD = score; best = t; }
      }
      if (best) {
        if (!b.target || (b.target.entity !== best.entity && (!sawCurrent || bestD < 8))) { const fresh = !b.target; b.target = best; b.reactionT = lerp(0.55, 0.18, b.skill) + rand(0, 0.2); b.seeT = 0; if (fresh) this.events.onSpot?.(b); }
        else { b.target.pos.copy(best.pos); b.target.head.copy(best.head); }
        b.visible = true; b.lastSeen.copy(best.pos); b.lastSeenT = time; b.state = b.state === 'retreat' ? 'retreat' : 'engage';
      } else {
        b.visible = false;
        if (b.target && time - b.lastSeenT > 6) { b.target = null; if (b.state === 'engage') b.state = 'hunt'; }
        else if (b.target && b.state === 'engage') b.state = 'hunt';
      }
      // hearing / being shot from unseen
      if (!b.visible && b.alertPos && time - b.alertT < 5 && b.state !== 'retreat') { b.lastSeen.copy(b.alertPos); b.lastSeenT = Math.max(b.lastSeenT, b.alertT - 3); if (b.state === 'patrol') b.state = 'hunt'; }
      // target died?
      if (b.target && !(b.target.entity.alive)) { b.target = null; b.state = 'patrol'; }
      // retreat logic
      if (b.health < 32 && b.state === 'engage' && b.retreatT <= 0 && Math.random() < 0.6) { b.state = 'retreat'; b.retreatT = 4.5; b.path = []; b.goal = -1; }
    }
    if (b.retreatT > 0) { b.retreatT -= dt; if (b.retreatT <= 0 && b.state === 'retreat') b.state = b.target ? 'engage' : 'patrol'; }
    b.coverCd -= dt; b.dangerT -= dt;
    // grenade avoidance: sprint away from any live grenade nearby
    for (const gz of this.dangerZones) {
      const d = b.pos.distanceTo(gz);
      if (d < 6.5 && b.dangerT <= 0) {
        b.dangerT = 2.2; const away = b.pos.clone().sub(gz).setY(0).normalize();
        const wps = this.map.waypoints.filter((w) => w.links.length > 0 && w.pos.distanceTo(gz) > 9 && w.pos.distanceTo(b.pos) < 16);
        let bestW = -1, bs = -Infinity; for (const w of wps) { const v = w.pos.clone().sub(b.pos).setY(0).normalize(); const sc = v.dot(away) * 10 - w.pos.distanceTo(b.pos) * 0.3; if (sc > bs) { bs = sc; bestW = w.id; } }
        if (bestW >= 0) this.setGoal(b, bestW); break;
      }
    }
    // take cover while reloading or when hurt, then come back out
    if (b.state === 'cover') { b.coverT -= dt; if (b.coverT <= 0 || !b.target) { b.state = b.target ? 'engage' : 'patrol'; b.path = []; b.goal = -1; } }
    else if (b.state === 'engage' && b.target && b.visible && b.coverCd <= 0 && ((b.reloading && b.reloadT > 0.8) || (b.health < 45 && Math.random() < 0.02))) {
      const tp = b.target.pos; const cands = this.map.waypoints.filter((w) => w.links.length > 0 && w.pos.distanceTo(b.pos) < 14 && w.pos.distanceTo(tp) > 5);
      let bestW = -1, bs = Infinity;
      for (const w of cands) { const eye = w.pos.clone().add(new THREE.Vector3(0, 1.0, 0)); if (!this.physics.clearLine(eye, tp)) { const sc = w.pos.distanceTo(b.pos); if (sc < bs) { bs = sc; bestW = w.id; } } }
      if (bestW >= 0) { this.setGoal(b, bestW); b.state = 'cover'; b.coverT = b.reloading ? Math.max(1.2, b.reloadT + 0.4) : rand(2.5, 4); b.coverCd = 9; }
    }
    if (b.visible) b.seeT += dt; else b.seeT = 0;
    b.reactionT -= dt;
    // ---- aim
    if (b.target) {
      const aimAt = b.visible ? b.target.pos : b.lastSeen;
      const d = this._dir.subVectors(aimAt, b.eyePos);
      const ty = Math.atan2(d.x, d.z); const tp = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const turn = lerp(5, 11, b.skill);
      b.aimYaw += wrapAngle(ty - b.aimYaw) * Math.min(1, dt * turn); b.aimPitch += (tp - b.aimPitch) * Math.min(1, dt * turn);
    } else if (b.path.length && b.node >= 0) {
      const n = this.map.waypoints[b.path[b.node]]?.pos; if (n) { const ty = Math.atan2(n.x - b.pos.x, n.z - b.pos.z); b.aimYaw += wrapAngle(ty - b.aimYaw) * Math.min(1, dt * 4); b.aimPitch += (0 - b.aimPitch) * Math.min(1, dt * 3); }
    }
    // ---- shooting
    b.fireT -= dt;
    // grenade at a target that broke line of sight recently
    b.grenadeT -= dt;
    if (b.target && !b.visible && b.grenadeT <= 0 && time - b.lastSeenT > 0.7 && time - b.lastSeenT < 4 && b.state !== 'retreat') {
      const d = b.pos.distanceTo(b.lastSeen);
      if (d > 7 && d < 24 && Math.random() < 0.6) {
        b.grenadeT = 22 + Math.random() * 15;
        const origin = b.eyePos.clone(); const to = b.lastSeen.clone().sub(origin); const dh = Math.hypot(to.x, to.z);
        const v = Math.sqrt(Math.max(4, 9.81 * dh)); const dirH = new THREE.Vector3(to.x / dh, 0, to.z / dh);
        const vel = dirH.multiplyScalar(v * 0.72).add(new THREE.Vector3(0, v * 0.72 + Math.max(0, to.y) * 0.8, 0));
        this.events.onGrenade?.(b, origin, vel, 3.6);
      } else b.grenadeT = 4;
    }
    if (b.reloading) { b.reloadT -= dt; if (b.reloadT <= 0) { b.reloading = false; const take = Math.min(b.def.mag, b.reserve); b.mag = take; b.reserve -= take; if (b.reserve < b.def.mag * 2) b.reserve += b.def.mag * 6; } }
    else if (b.target && b.visible && b.reactionT <= 0 && b.state !== 'retreat' && !(b.state === 'cover' && b.reloading) || (b.target && b.visible && b.state === 'retreat' && Math.random() < 0.02)) {
      const dist = b.eyePos.distanceTo(b.target!.pos);
      const aimErr = Math.abs(wrapAngle(Math.atan2(b.target!.pos.x - b.pos.x, b.target!.pos.z - b.pos.z) - b.aimYaw));
      if (aimErr < 6 * DEG && b.fireT <= 0 && b.burstPause <= 0 && !DEBUG.passive) {
        if (b.mag <= 0) { this.startReload(b, 0.4); }
        else if (dist < b.def.range * 0.6) { this.botShoot(b, dist); }
      }
      b.burstPause -= dt;
    }
    if (b.mag <= 0 && !b.reloading) this.startReload(b, 0.3);
    // ---- navigation goals
    b.repathT -= dt;
    const needGoal = b.goal < 0 || b.path.length === 0 || (b.node >= b.path.length);
    if (b.state === 'patrol') {
      if (needGoal || b.repathT <= 0 && Math.random() < 0.02) { this.setGoal(b, this.randomGoal(b)); b.repathT = rand(4, 8); }
    } else if (b.state === 'hunt') {
      if (needGoal || b.repathT <= 0) { const n = this.map.nearestWaypoint(b.lastSeen); this.setGoal(b, n); b.repathT = 1.5; }
      if (b.pos.distanceTo(b.lastSeen) < 3 && time - b.lastSeenT > 2) { b.state = 'patrol'; b.target = null; }
    } else if (b.state === 'engage') {
      const dist = b.target ? b.pos.distanceTo(b.target.pos) : 99;
      const wantDist = b.def.cls === 'sniper' ? 25 : b.def.cls === 'shotgun' || b.def.cls === 'smg' ? 7 : 13;
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafeT = rand(0.5, 1.4); b.strafeDir = pick([-1, 1, 0, 0]); b.crouch = Math.random() < 0.2 * (1 - b.skill * 0.5); }
      // approach / keep distance using waypoints if far, else direct micro movement
      if (dist > wantDist * 1.6 && (needGoal || b.repathT <= 0)) { this.setGoal(b, this.map.nearestWaypoint(b.target!.pos)); b.repathT = 1.2; }
      else if (dist <= wantDist * 1.6) { b.path = []; b.goal = -1; }
    } else if (b.state === 'retreat') {
      if (needGoal || b.repathT <= 0) { this.setGoal(b, this.fleeGoal(b)); b.repathT = 2; }
    }
  }

  private startReload(b: Bot, extra: number) { b.reloading = true; b.reloadT = b.def.reloadEmptyTime + extra; this.events.onReload?.(b); }

  /** Difficulty preset: adjusts reaction/accuracy (skill) and damage dealt. */
  setDifficulty(level: 'recruit' | 'regular' | 'veteran') {
    const skills = level === 'recruit' ? [0.3, 0.42, 0.55, 0.5, 0.35, 0.45, 0.5] : level === 'veteran' ? [0.8, 0.9, 1.0, 0.95, 0.85, 0.9, 0.92] : [0.55, 0.72, 0.88, 0.8, 0.5, 0.66, 0.76];
    const dmg = level === 'recruit' ? 0.6 : level === 'veteran' ? 1.0 : 0.85;
    this.bots.forEach((b, i) => { b.skill = skills[i % skills.length]; b.dmgMul = dmg; });
  }

  private randomGoal(b: Bot) {
    // prefer far nodes to keep bots roaming the whole map
    const wps = this.map.waypoints.filter((w) => w.links.length > 0);
    let best = -1, bs = -1;
    for (let i = 0; i < 6; i++) { const w = pick(wps); const s = w.pos.distanceTo(b.pos) + rand(0, 15) + (w.pos.y > 2 ? 6 : 0); if (s > bs) { bs = s; best = w.id; } }
    return best;
  }
  private fleeGoal(b: Bot) {
    const threat = b.target?.pos ?? b.alertPos ?? b.pos; const wps = this.map.waypoints.filter((w) => w.links.length > 0);
    let best = -1, bs = -1;
    for (let i = 0; i < 10; i++) { const w = pick(wps); const s = w.pos.distanceTo(threat) - w.pos.distanceTo(b.pos) * 0.5 + rand(0, 8); if (s > bs) { bs = s; best = w.id; } }
    return best;
  }
  private setGoal(b: Bot, goal: number) {
    if (goal < 0) return;
    const from = this.map.nearestWaypoint(b.pos); if (from < 0) return;
    b.goal = goal; b.path = this.map.findPath(from, goal); b.node = 0;
    if (b.path.length === 0 && from !== goal) {
      // unreachable: fall back to the nearest reachable node around the goal
      const gp = this.map.waypoints[goal].pos;
      const cands = this.map.waypoints.filter((w) => w.links.length > 0 && w.id !== goal).sort((x, y) => x.pos.distanceToSquared(gp) - y.pos.distanceToSquared(gp)).slice(0, 6);
      for (const c of cands) { const p = this.map.findPath(from, c.id); if (p.length) { b.goal = c.id; b.path = p; return; } }
      b.goal = -1;
    }
  }

  private botShoot(b: Bot, dist: number) {
    const d = b.def;
    // accuracy: improves the longer the target is tracked, worsens with distance & target speed
    const tv = b.target!.entity.vel as THREE.Vector3 | undefined;
    const tgtSpeed = b.target!.entity.speed ?? (tv ? Math.hypot(tv.x, tv.z) : 0);
    let err = lerp(5.5, 1.6, b.skill) * lerp(2.4, 1, clamp(b.seeT / 1.3, 0, 1));
    err += tgtSpeed * 0.35 + dist * 0.035; if (b.crouch) err *= 0.8; if (d.cls === 'sniper') err *= 0.55;
    const eye = b.eyePos.clone();
    // aim point: chest, occasionally head
    const aimPt = (Math.random() < 0.18 * b.skill ? b.target!.head : b.target!.pos).clone();
    // lead moving targets by their travel during the bullet's flight (skilled bots lead better)
    if (tv) aimPt.addScaledVector(tv, (dist / d.bulletSpeed) * lerp(0.3, 1.0, b.skill));
    const dir = coneDir(aimPt.sub(eye).normalize(), err);
    const muzzle = new THREE.Vector3(); b.muzzle.getWorldPosition(muzzle);
    if (muzzle.lengthSq() < 1) muzzle.copy(eye);
    for (let i = 0; i < d.pellets; i++) this.bullets.fire(d, eye, d.pellets > 1 ? coneDir(dir, d.pelletSpread) : dir, b, { tracerStart: muzzle, tracer: d.tracer && (d.pellets === 1 || i % 3 === 0), dmgMul: b.dmgMul });
    this.effects.muzzleFlashWorld(muzzle, dir, d.flashScale);
    const far = eye.distanceTo(this.player.eyePos) > 22;
    const nearSet = d.audio && this.audio.has(d.audio.shot[0]) ? d.audio.shot : d.sounds.shot;
    const farSet = d.audio ? d.audio.far : d.sounds.far;
    this.audio.play3D(far ? farSet : nearSet, muzzle, { vol: far ? 0.9 : 0.8, rateVar: 0.04, ref: 6, rolloff: 0.9, reverb: 0.4 });
    if (!far) this.audio.play3D(farSet, muzzle, { vol: 0.35, rate: 0.92, delay: 0.18, ref: 8, rolloff: 0.7, lowpass: 1600, reverb: 0.6 });
    if (d.cls === 'sniper') this.audio.play3D('shot_bolt3_far', muzzle, { vol: 0.8, rate: 0.88, ref: 10, rolloff: 0.6, max: 400, reverb: 0.7 });
    b.mag--; this.events.onShot(b, eye);
    // fire cadence: bursts for autos, single for semi/bolt/pump
    if (d.mode === 'auto') { b.fireT = 60 / d.rpm * rand(1, 1.3); if (--b.burstLeft <= 0) { const close = dist < 12, mid = dist < 28; b.burstLeft = Math.round(close ? rand(6, 10) : mid ? rand(3, 6) : rand(2, 3)); b.burstPause = (close ? rand(0.15, 0.4) : mid ? rand(0.3, 0.7) : rand(0.5, 1.0)) * lerp(1.4, 0.7, b.skill); } }
    else if (d.mode === 'bolt') b.fireT = d.boltTime + rand(0.4, 1.0);
    else if (d.mode === 'pump') b.fireT = d.boltTime + rand(0.2, 0.5);
    else b.fireT = 60 / d.rpm * rand(1.3, 2.2);
  }

  private move(b: Bot, dt: number) {
    const wish = this._tmp.set(0, 0, 0); let speed = 0;
    let onLadderLink = false;
    if (b.path.length && b.node < b.path.length) {
      const wp = this.map.waypoints[b.path[b.node]]; const prev = b.node > 0 ? this.map.waypoints[b.path[b.node - 1]] : null;
      const dx = wp.pos.x - b.pos.x, dz = wp.pos.z - b.pos.z; const dxz = Math.hypot(dx, dz); const dy = wp.pos.y - b.feetY;
      onLadderLink = wp.ladder !== undefined && prev?.ladder !== undefined && wp.ladder === prev.ladder;
      if (onLadderLink) {
        // climb: move horizontally onto the ladder line, then vertically
        if (dxz > 0.25 && Math.abs(dy) > 0.3) { wish.set(dx / dxz, 0, dz / dxz); speed = 1.5; }
        b.climbing = true; b.vel.y = clamp(dy * 3, -3, 3);
        if (Math.abs(dy) < 0.15 && dxz < 0.6) { b.node++; b.climbing = false; }
      } else {
        b.climbing = false;
        if (dxz < (b.node === b.path.length - 1 ? 0.5 : 0.9) && Math.abs(dy) < 1.2) b.node++;
        else { wish.set(dx / dxz, 0, dz / dxz); speed = b.state === 'patrol' ? 3.4 : b.state === 'retreat' ? 5.8 : 5.0; }
      }
    }
    if (b.state === 'engage' && b.target && !onLadderLink) {
      // strafe around the target
      const fwd = new THREE.Vector3(Math.sin(b.aimYaw), 0, Math.cos(b.aimYaw)); const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const dist = b.pos.distanceTo(b.target.pos);
      const wantDist = b.def.cls === 'sniper' ? 25 : b.def.cls === 'shotgun' || b.def.cls === 'smg' ? 7 : 13;
      if (wish.lengthSq() === 0) {
        if (dist > wantDist * 1.15) wish.add(fwd); else if (dist < wantDist * 0.6) wish.sub(fwd);
        wish.addScaledVector(right, b.strafeDir);
        if (wish.lengthSq() > 0) { wish.normalize(); speed = b.crouch ? 2.2 : 3.6; }
      }
    }
    if (b.reloading && b.state === 'engage' && !onLadderLink) { speed *= 0.6; }
    // stuck detection
    if (speed > 0) { if (b.pos.distanceTo(b.lastPos) < 0.05 * dt * 60) b.stuckT += dt; else b.stuckT = 0; if (b.stuckT > 1.2) { b.stuckT = 0; b.path = []; b.goal = -1; b.repathT = 0; b.vel.y = 5; } }
    b.lastPos.copy(b.pos);
    // velocity integrate
    const target = wish.multiplyScalar(speed);
    b.vel.x = damp(b.vel.x, target.x, 9, dt); b.vel.z = damp(b.vel.z, target.z, 9, dt);
    if (!b.climbing) b.vel.y -= 19.5 * dt;
    const desired = { x: b.vel.x * dt, y: b.vel.y * dt, z: b.vel.z * dt };
    const m = this.physics.moveCharacter(b.cc, b.collider, b.pos, desired, cg(G.BOT, G.WORLD | G.PLAYER | G.BOT), b.grounded && !b.climbing);
    b.pos.x += m.x; b.pos.y += m.y; b.pos.z += m.z;
    b.body.setNextKinematicTranslation(b.pos);
    b.grounded = b.climbing ? true : m.grounded;
    if (b.grounded && b.vel.y < 0 && !b.climbing) b.vel.y = -1.5;
    if (b.pos.y < -20) { const s = this.pickSpawn(b); b.spawnAt(s.pos, s.yaw + Math.PI); }
  }
}
