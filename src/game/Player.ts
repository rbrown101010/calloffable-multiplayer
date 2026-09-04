import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics, G, cg } from './Physics';
import { Input } from './Input';
import { clamp, damp, DEG, lerp } from './util';
import type { Ladder } from './Map';

export interface MoveCtx {
  canControl: boolean;
  /** allow mouse look even when movement/firing is locked (match countdown) */
  canLook?: boolean;
  speedMul: number;     // from weapon weight
  adsHeld: boolean;
  adsFov: number;
  adsTime: number;
  firing: boolean;
}

const CAP_R = 0.36, CAP_HH_STAND = 0.54, CAP_HH_CROUCH = 0.2;

export class Player {
  body: RAPIER.RigidBody; collider: RAPIER.Collider; cc: RAPIER.KinematicCharacterController;
  pos = new THREE.Vector3(); vel = new THREE.Vector3();
  yaw = 0; pitch = 0; sens = 1.0; adsSensitivity = 1;
  rig = new THREE.Object3D();
  camera: THREE.PerspectiveCamera;
  mounted = false;
  loadoutIdx = 0; life = 0;
  grounded = false; wasGrounded = false; groundedTime = 0;
  sprinting = false; crouching = false; sliding = false; slideT = 0; slideDir = new THREE.Vector3();
  ads = 0; adsBlend = 0;
  climbing: Ladder | null = null; ladderExitT = 0;
  health = 100; maxHealth = 100; alive = true; lastDamage = -99; regenDelay = 4.2; regenRate = 38;
  fovBase = 90; fovCur = 90;
  speed = 0; moveDir = new THREE.Vector3(); wishDir = new THREE.Vector3();
  // camera fx
  bobPhase = 0; bobY = 0; bobX = 0; landDip = 0; landVel = 0;
  recoilP = 0; recoilY = 0; recoilVP = 0; recoilVY = 0;
  punchP = 0; punchY = 0; punchVP = 0; punchVY = 0;
  shake = 0; roll = 0; swayX = 0; swayY = 0;
  eyeCur = 1.62; stride = 0;
  onFootstep?: (running: boolean) => void;
  onLand?: (impact: number) => void;
  onDamage?: (amount: number, from: THREE.Vector3 | null, attacker: any) => void;
  onDeath?: (attacker: any, weapon: string, headshot: boolean) => void;
  name = 'RILEY'; kills = 0; deaths = 0; score = 0; streak = 0; colliderHandles = new Set<number>();
  jumpCooldown = 0; airTime = 0; breathHold = 0; stamina = 1; deathT = 0; stuckT = 0; onStuck?: () => void;
  private _seatEye = new THREE.Vector3(); private _f = new THREE.Vector3(); private _r = new THREE.Vector3(); private _tmp = new THREE.Vector3();

  constructor(private physics: Physics, private input: Input, camera: THREE.PerspectiveCamera, private ladders: Ladder[]) {
    this.camera = camera; this.rig.add(camera);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 0));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(CAP_HH_STAND, CAP_R).setCollisionGroups(cg(G.PLAYER, G.WORLD | G.VEHICLE | G.BOT | G.GRENADE | G.DEBRIS)).setFriction(0), this.body);
    physics.setOwner(this.collider, { entity: this, part: 'body', player: this });
    this.colliderHandles.add(this.collider.handle);
    this.cc = physics.world.createCharacterController(0.03);
    this.cc.enableAutostep(0.5, 0.25, true);
    this.cc.enableSnapToGround(0.4);
    this.cc.setMaxSlopeClimbAngle(56 * DEG);
    this.cc.setMinSlopeSlideAngle(62 * DEG);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(85);
  }

  setLadders(ladders:Ladder[]) { this.ladders=ladders;this.climbing=null; }

  setMounted(on:boolean){
    this.mounted=on;
    this.collider.setHalfHeight(on?.16:this.crouching?CAP_HH_CROUCH:CAP_HH_STAND);
    this.collider.setTranslationWrtParent({x:0,y:on?-.17:0,z:0});
  }

  get feetY() { return this.pos.y - (this.crouching ? CAP_HH_CROUCH : CAP_HH_STAND) - CAP_R; }
  get eyePos() { return this.mounted ? this._seatEye.copy(this.pos).add(new THREE.Vector3(0,.15,0)) : this.rig.position; }
  get forward() { return this._f.set(0, 0, -1).applyQuaternion(this.rig.quaternion); }
  get right() { return this._r.set(1, 0, 0).applyQuaternion(this.rig.quaternion); }
  get flatForward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  get flatRight() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  get moving() { return this.speed > 0.3; }

  spawn(p: THREE.Vector3, yaw: number) {
    this.adsBlend = 0; this.sprinting = false; this.speed = 0; this.stamina = 1; this.breathHold = 0;
    this.crouching = false; this.sliding = false; this.collider.setHalfHeight(CAP_HH_STAND);
    this.pos.set(p.x, p.y + CAP_HH_STAND + CAP_R + 0.05, p.z); this.vel.set(0, 0, 0);
    this.body.setNextKinematicTranslation(this.pos); this.body.setTranslation(this.pos, true);
    this.yaw = yaw; this.pitch = 0; this.health = this.maxHealth; this.alive = true; this.climbing = null; this.deathT = 0;
    this.recoilP = this.recoilY = this.recoilVP = this.recoilVY = 0; this.punchP = this.punchY = this.punchVP = this.punchVY = 0; this.landDip = 0; this.shake = 0; this.ads = 0;
    this.updateRig(0);
  }

  /** Move the player to a safe spot (feet position) without touching health or loadout. */
  teleport(feet: THREE.Vector3) {
    this.pos.set(feet.x, feet.y + (this.crouching ? CAP_HH_CROUCH : CAP_HH_STAND) + CAP_R + 0.05, feet.z); this.vel.set(0, 0, 0);
    this.body.setNextKinematicTranslation(this.pos); this.body.setTranslation(this.pos, true); this.climbing = null; this.stuckT = 0;
  }

  applyRecoil(pitchKick: number, yawKick: number) {
    // part of the kick moves the real aim, the rest is a visual spring
    this.pitch = clamp(this.pitch + pitchKick * 0.35, -89 * DEG, 89 * DEG);
    this.yaw += yawKick * 0.35;
    this.recoilVP += pitchKick * 0.65 * 60; this.recoilVY += yawKick * 0.65 * 60;
  }
  addShake(a: number) { this.shake = Math.min(1.2, this.shake + a); }
  addPunch(p: number, y: number) { this.punchVP += p * 40; this.punchVY += y * 40; }

  /** Returns true if this damage killed the player. */
  takeDamage(amount: number, attacker: any, part = 'body', weapon = '', from: THREE.Vector3 | null = null): boolean {
    if (!this.alive) return false;
    this.health -= amount; this.lastDamage = performance.now() / 1000;
    this.addPunch(-amount * 0.0018, (Math.random() - 0.5) * amount * 0.002);
    this.onDamage?.(amount, from ?? (attacker && attacker.pos ? attacker.pos : null), attacker);
    if (this.health <= 0) { this.health = 0; this.alive = false; this.ads = 0; this.deaths++; this.streak = 0; this.onDeath?.(attacker, weapon, part === 'head'); return true; }
    return false;
  }

  /** Check ladder volumes near the player. */
  private findLadder(): Ladder | null {
    for (const l of this.ladders) {
      const dx = this.pos.x - l.center.x, dz = this.pos.z - l.center.z;
      const side = new THREE.Vector3(-l.facing.z, 0, l.facing.x);
      const along = dx * l.facing.x + dz * l.facing.z; const lat = dx * side.x + dz * side.z;
      if (Math.abs(lat) < l.halfW && along > -0.85 && along < 0.55 && this.feetY > l.bottom - 0.9 && this.feetY < l.top + 0.3) return l;
    }
    return null;
  }

  update(dt: number, ctx: MoveCtx) {
    const inp = this.input; const now = performance.now() / 1000;
    if (this.alive && (ctx.canControl || ctx.canLook)) {
      // ---- look
      // Match screen-space motion to the actual camera FOV. Mouse input is
      // applied directly once; no interpolation or accumulated aim inertia.
      const adsSens = Math.tan(this.camera.fov * DEG / 2) / Math.tan(this.fovBase * DEG / 2) * lerp(1, this.adsSensitivity, this.ads);
      const s = 0.0021 * this.sens * adsSens;
      this.yaw -= inp.mouseDX * s; this.pitch = clamp(this.pitch - inp.mouseDY * s, -88 * DEG, 88 * DEG);
      this.swayX = damp(this.swayX, inp.mouseDX, 12, dt); this.swayY = damp(this.swayY, inp.mouseDY, 12, dt);
    } else { this.swayX = damp(this.swayX, 0, 12, dt); this.swayY = damp(this.swayY, 0, 12, dt); }

    // ---- input
    let fwd = 0, side = 0, wantSprint = false, wantJump = false, crouchHit = false;
    if (this.alive && ctx.canControl) {
      fwd = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
      side = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
      wantSprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
      wantJump = inp.hit('Space');
      crouchHit = inp.hit('KeyC') || inp.hit('ControlLeft');
    }
    const f = this.flatForward, r = this.flatRight;
    this.wishDir.set(0, 0, 0).addScaledVector(f, fwd).addScaledVector(r, side);
    if (this.wishDir.lengthSq() > 1) this.wishDir.normalize();

    // ---- ADS
    const adsWant = this.alive && ctx.canControl && ctx.adsHeld && !this.sliding;
    this.ads = damp(this.ads, adsWant ? 1 : 0, adsWant ? 1 / Math.max(0.05, ctx.adsTime) * 3.2 : 14, dt);
    if (this.ads < 0.002) this.ads = 0; if (this.ads > 0.998) this.ads = 1;

    // ---- stance
    if (crouchHit) {
      if (this.sprinting && this.grounded && !this.sliding && this.speed > 4.5 && this.stamina > 0.2) {
        this.sliding = true; this.slideT = 0; this.slideDir.copy(this.wishDir.lengthSq() > 0.1 ? this.wishDir : f).normalize(); this.setCrouch(true); this.stamina -= 0.2;
      } else if (!this.sliding) this.setCrouch(!this.crouching);
    }
    if (this.sliding) { this.slideT += dt; if (this.slideT > 0.85 || !this.grounded || wantJump) { this.sliding = false; } }
    // sprint
    const canSprint = wantSprint && fwd > 0 && !this.crouching && this.ads < 0.3 && !ctx.firing && this.grounded && !this.climbing;
    this.sprinting = canSprint && !this.sliding;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.05); else this.stamina = Math.min(1, this.stamina + dt * 0.15);

    // ---- speed
    let speed = this.crouching ? 2.5 : this.sprinting ? 7.0 : 4.8;
    speed *= ctx.speedMul;
    speed *= lerp(1, 0.55, this.ads);
    if (fwd < 0 && !this.sprinting) speed *= 0.8;
    if (side !== 0 && fwd === 0) speed *= 0.9;
    if (!this.alive) speed = 0;

    // ---- ladder
    const ladder = this.alive ? this.findLadder() : null;
    if (this.climbing && (!ladder || this.ladderExitT > 0)) { this.climbing = null; }
    if (!this.climbing && ladder && this.ladderExitT <= 0 && (fwd !== 0 || side !== 0) && this.alive) {
      // enter when moving toward the ladder (or descending onto it from top)
      const toward = this.wishDir.dot(ladder.facing);
      const nearTop = this.feetY > ladder.top - 0.2;
      if (toward > 0.3 || (nearTop && toward < -0.3)) { this.climbing = ladder; this.vel.set(0, 0, 0); this.sprinting = false; this.sliding = false; }
    }
    this.ladderExitT = Math.max(0, this.ladderExitT - dt);

    // ---- velocity
    if (this.climbing) {
      const L = this.climbing;
      // climb direction: W goes up unless looking steeply down
      let dir = fwd; if (this.pitch < -45 * DEG) dir = -fwd; 
      const vy = dir * 3.0;
      this.vel.set(0, vy, 0);
      // hug the ladder
      const target = new THREE.Vector3(L.center.x, this.pos.y, L.center.z);
      this.vel.x = (target.x - this.pos.x) * 6; this.vel.z = (target.z - this.pos.z) * 6;
      // exit at top: step onto the platform
      if (this.feetY >= L.top - 0.05 && dir > 0) { this.vel.y = 2.5; this.vel.addScaledVector(L.facing, 3.0); this.climbing = null; this.ladderExitT = 0.5; }
      // exit at bottom
      if (this.feetY <= L.bottom + 0.05 && dir < 0) { this.climbing = null; this.ladderExitT = 0.4; }
      if (wantJump) { this.climbing = null; this.ladderExitT = 0.5; this.vel.copy(L.facing).multiplyScalar(-3.5); this.vel.y = 3.5; }
    } else {
      const hv = this._tmp.set(this.vel.x, 0, this.vel.z);
      if (this.sliding) {
        const st = this.slideT / 0.85; const sp = lerp(8.6, 2.4, st * st);
        hv.copy(this.slideDir).multiplyScalar(sp);
        // steer a bit with A/D
        hv.addScaledVector(r, side * 1.2);
      } else if (this.grounded) {
        const target = this.wishDir.clone().multiplyScalar(speed);
        const accel = this.wishDir.lengthSq() > 0.01 ? 11 : 16;
        hv.x = damp(hv.x, target.x, accel, dt); hv.z = damp(hv.z, target.z, accel, dt);
      } else {
        // air control
        const cur = hv.length();
        hv.addScaledVector(this.wishDir, 9 * dt);
        const maxS = Math.max(cur, speed * 0.9); if (hv.length() > maxS) hv.setLength(maxS);
      }
      this.vel.x = hv.x; this.vel.z = hv.z;
      this.vel.y -= 19.5 * dt;
      this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
      if (wantJump && this.grounded && this.jumpCooldown <= 0 && !this.crouching) { this.vel.y = 5.4; this.grounded = false; this.jumpCooldown = 0.3; this.groundedTime = 0; }
      if (wantJump && this.crouching && this.grounded && !this.sliding) { this.setCrouch(false); }
    }

    // ---- move
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    const m = this.physics.moveCharacter(this.cc, this.collider, this.pos, desired, cg(G.PLAYER, G.WORLD | G.VEHICLE | G.BOT), this.grounded && !this.climbing);
    const vyBefore = this.vel.y;
    this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
    this.body.setNextKinematicTranslation(this.pos);
    this.wasGrounded = this.grounded;
    this.grounded = this.climbing ? true : m.grounded;
    if (this.grounded) { if (this.vel.y < 0 && !this.climbing) this.vel.y = -1.5; this.groundedTime += dt; this.airTime = 0; }
    else { this.airTime += dt; if (m.y < desired.y - 1e-4 && this.vel.y > 0) this.vel.y = 0; }
    if (this.grounded && !this.wasGrounded && !this.climbing) { const impact = clamp(-vyBefore / 10, 0, 1.2); this.landVel = impact; this.onLand?.(impact); }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.moveDir.set(this.vel.x, 0, this.vel.z); if (this.speed > 0.01) this.moveDir.divideScalar(this.speed);
    // unstuck failsafe: input but no progress → hop, and after a while ask the game for a safe spot
    const moved = Math.hypot(m.x, m.z);
    if (this.alive && this.grounded && !this.climbing && this.wishDir.lengthSq() > 0.1 && moved < 0.004) {
      this.stuckT += dt;
      if (this.stuckT > 1.0 && this.stuckT < 1.05) { this.vel.y = 3.2; this.grounded = false; }
      if (this.stuckT > 3.5) { this.stuckT = 0; this.onStuck?.(); }
    } else this.stuckT = Math.max(0, this.stuckT - dt * 2);

    // ---- health regen
    if (this.alive && now - this.lastDamage > this.regenDelay && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + this.regenRate * dt);

    // ---- breath / camera
    this.updateRig(dt, ctx);
    if (this.grounded && this.moving && !this.climbing) {
      this.stride += this.speed * dt; const strideLen = this.sprinting ? 2.7 : this.crouching ? 1.4 : 1.95;
      if (this.stride > strideLen) { this.stride = 0; this.onFootstep?.(this.sprinting); }
    } else this.stride = strideLen(this) * 0.7;
  }

  setCrouch(c: boolean) {
    if (c === this.crouching) return;
    if (!c) {
      // headroom check
      const up = this.physics.raycast(this.pos, new THREE.Vector3(0, 1, 0), CAP_HH_STAND + CAP_R + 0.5 - (CAP_HH_CROUCH + CAP_R) + 0.1, G.WORLD);
      if (up) return;
    }
    const dh = CAP_HH_STAND - CAP_HH_CROUCH;
    this.crouching = c; this.collider.setHalfHeight(c ? CAP_HH_CROUCH : CAP_HH_STAND);
    this.pos.y += c ? -dh : dh; this.body.setNextKinematicTranslation(this.pos); this.body.setTranslation(this.pos, true);
  }

  private updateRig(dt: number, ctx?: MoveCtx) {
    // eye height
    const eyeTarget = this.crouching ? 1.08 : 1.62; this.eyeCur = damp(this.eyeCur, eyeTarget, 14, dt);
    // head bob
    const bobSpeed = this.grounded && !this.climbing ? this.speed : 0;
    const amp = (this.sprinting ? 0.045 : this.crouching ? 0.012 : 0.022) * (1 - this.ads);
    if (bobSpeed > 0.5) this.bobPhase += dt * (this.sprinting ? 10.5 : 8.2);
    const targetBobY = bobSpeed > 0.5 ? Math.abs(Math.sin(this.bobPhase)) * amp - amp * 0.5 : 0;
    const targetBobX = bobSpeed > 0.5 ? Math.cos(this.bobPhase) * amp * 0.5 : 0;
    this.bobY = damp(this.bobY, targetBobY, 16, dt); this.bobX = damp(this.bobX, targetBobX, 16, dt);
    // land dip (spring)
    this.landDip = damp(this.landDip, 0, 7, dt);
    if (this.landVel > 0) { this.landDip += this.landVel * 0.16; this.landVel = 0; }
    // recoil springs
    const springStep = (x: number, v: number, k: number, d: number) => { const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n; for(let i=0;i<n;i++){v += (-k*x-d*v)*h; x += v*h;} return [x, v]; };
    [this.recoilP, this.recoilVP] = springStep(this.recoilP, this.recoilVP, 260, 22);
    [this.recoilY, this.recoilVY] = springStep(this.recoilY, this.recoilVY, 260, 22);
    [this.punchP, this.punchVP] = springStep(this.punchP, this.punchVP, 200, 18);
    [this.punchY, this.punchVY] = springStep(this.punchY, this.punchVY, 200, 18);
    this.shake = damp(this.shake, 0, 6, dt);
    const t = performance.now() / 1000;
    const shX = this.shake * Math.sin(t * 61) * 0.02, shY = this.shake * Math.sin(t * 47 + 1) * 0.02, shR = this.shake * Math.sin(t * 53 + 2) * 0.012;
    // strafe roll + slide roll
    const rollT = -(this.vel.dot(this.flatRight) / 7) * 0.9 * DEG * (1 - this.ads) + (this.sliding ? -4 * DEG : 0);
    this.roll = damp(this.roll, rollT, 10, dt);
    // ADS stays still until the player moves, fires, or takes a hit.
    // death camera: collapse to the ground and roll over
    let deathDrop = 0, deathRoll = 0, deathPitch = 0;
    if (!this.alive) { this.deathT += dt; const t = Math.min(1, this.deathT / 1.1); const e = 1 - (1 - t) * (1 - t); deathDrop = e * (this.eyeCur - 0.35); deathRoll = e * 1.15; deathPitch = e * 0.35; }
    // final rig transform
    const eye = this.feetY + this.eyeCur - this.landDip - deathDrop;
    this.rig.position.set(this.pos.x + this.bobX * 0.5 + shX, eye + this.bobY + shY, this.pos.z);
    const pitch = this.pitch + this.recoilP + this.punchP - this.landDip * 0.8 + deathPitch;
    const yaw = this.yaw + this.recoilY + this.punchY;
    this.rig.rotation.set(0, 0, 0, 'YXZ'); this.rig.rotation.y = yaw; this.rig.rotation.x = pitch; this.rig.rotation.z = this.roll + shR + deathRoll;
    // FOV
    const fovT = ctx ? lerp(this.fovBase + (this.sprinting ? 5 : 0) + (this.sliding ? 6 : 0), ctx.adsFov, this.ads) : this.fovBase;
    this.fovCur = damp(this.fovCur, fovT, 16, dt);
    if (Math.abs(this.camera.fov - this.fovCur) > 0.01) { this.camera.fov = this.fovCur; this.camera.updateProjectionMatrix(); }
  }
}
function strideLen(p: Player) { return p.sprinting ? 2.7 : p.crouching ? 1.4 : 1.95; }
