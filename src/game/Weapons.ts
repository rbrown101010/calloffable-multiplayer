import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { WeaponDef, WEAPONS, Loadout } from './WeaponDefs';
import { Physics, G } from './Physics';
import { Effects, makeFlash } from './Effects';
import { AudioManager } from './Audio';
import { Player } from './Player';
import { Input } from './Input';
import { clamp, damp, lerp, rand, DEG } from './util';
import { buildIntervention, buildGrenade, buildAK47 } from './ProceduralGuns';

export const VIEW_LAYER = 1;
export const FRAG_RELEASE=.24,FRAG_RECOVER=.72;

// ------------------------------------------------------------- model loading
const gltfLoader = new GLTFLoader(); gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map<string, Promise<THREE.Object3D>>();
const spasSteel=new THREE.MeshStandardMaterial({color:0x1b1b1d,roughness:.42,metalness:.8}),spasPolymer=new THREE.MeshStandardMaterial({color:0x141414,roughness:.75,metalness:.15});
const loadedModels = new Map<string, THREE.Object3D>();
export function loadWeaponModel(def: WeaponDef): Promise<THREE.Object3D> {
  const url = def.model.url;
  if (!modelCache.has(url)) {
    const p: Promise<THREE.Object3D> = url.startsWith('proc:')
      ? Promise.resolve(url === 'proc:intervention' ? buildIntervention() : url==='proc:ak47'?buildAK47():new THREE.Group())
      : new Promise((res, rej) => gltfLoader.load(url, (g) => res(g.scene), undefined, (e) => rej(e)));
    modelCache.set(url, p.catch((e) => { console.warn('weapon model failed', url, e); return placeholderGun(); }).then(m => { loadedModels.set(url, m); return m; }));
  }
  return modelCache.get(url)!.then(m => cloneWeaponModel(def, m));
}
/** Clone a weapon already loaded at boot without an asynchronous equip race. */
export function cloneLoadedWeapon(def:WeaponDef){const model=loadedModels.get(def.model.url);return model?cloneWeaponModel(def,model):null;}
function cloneWeaponModel(def: WeaponDef, m: THREE.Object3D) {
    const c = skClone(m);
    if (def.id === 'spas12') {
      // the low-poly SPAS-12 ships without textures: give it a proper blued-steel / polymer look
      const steel=spasSteel;
      const polymer=spasPolymer;
      let i = 0; c.traverse((o: any) => { if (o.isMesh) { o.material = (i++ % 3 === 0) ? polymer : steel; } });
    }
    c.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mt: any) => { if (mt && 'envMapIntensity' in mt) mt.envMapIntensity = 1.0; }); } });
    return c;
}
/** Shift a parent-less model so its bounding box center sits on its parent origin. */
export function centerModel(model: THREE.Object3D, outMin?: THREE.Vector3, outMax?: THREE.Vector3) {
  model.updateWorldMatrix(false, true);
  const bb = new THREE.Box3().setFromObject(model); const c = bb.getCenter(new THREE.Vector3());
  model.position.sub(c); outMin?.copy(bb.min).sub(c); outMax?.copy(bb.max).sub(c);
  return c;
}
function placeholderGun() { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.6), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.6 })); m.position.z = -0.2; g.add(m); return g; }

// ------------------------------------------------------------- view model
export interface VMState { ads: number; sprinting: boolean; speed: number; grounded: boolean; crouching: boolean; sliding: boolean; mouseDX: number; mouseDY: number; bobPhase: number; time: number; climbing: boolean; lowered: number; cookTime?:number; }

export class ViewModel {
  root = new THREE.Group(); pivot = new THREE.Group(); holder = new THREE.Group(); modelRoot = new THREE.Group();
  muzzle = new THREE.Object3D(); ejectPt = new THREE.Object3D();
  flash: THREE.Sprite; flashLight: THREE.PointLight; flashT = 0;
  def: WeaponDef | null = null;
  kickPos = new THREE.Vector3(); kickVel = new THREE.Vector3(); kickRot = new THREE.Vector3(); kickRotVel = new THREE.Vector3();
  swayRot = new THREE.Vector3(); swayPos = new THREE.Vector3();
  sprintBlend = 0; lowerBlend = 0;
  reloadT = -1; reloadDur = 1; boltT = -1; boltDur = 1; drawT = 1; drawDur = 0.4; holsterT = -1; holsterDur = 0.25; throwT = -1;
  magNode: THREE.Object3D | null = null; magRest = new THREE.Vector3();
  scopedHidden = false; bboxMin = new THREE.Vector3(); bboxMax = new THREE.Vector3();
  optic=new THREE.Group();private reticle=new THREE.Mesh(new THREE.CircleGeometry(.0015,16),new THREE.MeshBasicMaterial({color:0xff3026,depthTest:false,toneMapped:false}));
  fragRoot=new THREE.Group();private fragHand=new THREE.Group();private frag=buildGrenade();
  private _e = new THREE.Euler(); private _v = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    camera.add(this.root); this.root.add(this.pivot); this.pivot.add(this.holder); this.holder.add(this.modelRoot); this.holder.add(this.muzzle); this.holder.add(this.ejectPt);
    this.holder.add(this.optic);const opticMat=new THREE.MeshStandardMaterial({color:0x202623,roughness:.55,metalness:.6});
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.045,.005,6,24),opticMat);this.optic.add(rim);
    const mount=new THREE.Mesh(new THREE.BoxGeometry(.055,.04,.07),opticMat);mount.position.y=-.058;this.optic.add(mount);
    const lens=new THREE.Mesh(new THREE.CircleGeometry(.042,24),new THREE.MeshBasicMaterial({color:0x97c9bc,transparent:true,opacity:.045,depthWrite:false}));this.optic.add(lens);
    this.root.add(this.reticle);this.reticle.position.set(0,0,-.35);this.reticle.visible=false;
    this.root.add(this.fragRoot);this.fragRoot.add(this.fragHand);this.fragRoot.visible=false;
    const sleeve=new THREE.Mesh(new THREE.CapsuleGeometry(.055,.34,4,8),new THREE.MeshStandardMaterial({color:0x59624d,roughness:.95}));sleeve.rotation.x=Math.PI/2;sleeve.position.z=.22;this.fragHand.add(sleeve);
    const glove=new THREE.Mesh(new THREE.BoxGeometry(.1,.07,.13),new THREE.MeshStandardMaterial({color:0x242a25,roughness:.85}));glove.position.set(0,-.012,.015);this.fragHand.add(glove);
    for(let i=0;i<4;i++){const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.011,.047,3,6),glove.material);finger.rotation.x=Math.PI/2;finger.position.set((i-1.5)*.022,.024,-.04);this.fragHand.add(finger);}
    this.frag.scale.setScalar(1.35);this.frag.position.set(0,.06,-.02);this.fragHand.add(this.frag);
    const fm = new THREE.SpriteMaterial({ map: makeFlash(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, color: 0xffe0b0 });
    this.flash = new THREE.Sprite(fm); this.flash.visible = false; this.flash.scale.setScalar(0.35); this.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 8, 2); this.flashLight.position.set(0, 0, -0.1); this.muzzle.add(this.flashLight);
    this.root.traverse((o) => o.layers.set(VIEW_LAYER)); this.flash.layers.set(VIEW_LAYER); this.flashLight.layers.enableAll();
  }

  setWeapon(def: WeaponDef, model: THREE.Object3D) {
    this.modelRoot.clear(); this.def = def;
    const M = def.model;
    model.rotation.set(M.rot[0], M.rot[1], M.rot[2]); model.scale.setScalar(M.scale);
    if (M.offset) model.position.set(M.offset[0], M.offset[1], M.offset[2]);
    model.traverse((o) => o.layers.set(VIEW_LAYER));
    // auto-center the geometry on the holder origin (Sketchfab pivots are arbitrary). Computed before parenting so the box is in holder space.
    centerModel(model, this.bboxMin, this.bboxMax);
    this.modelRoot.add(model);this.optic.visible=def.mode==='auto';this.optic.position.set(0,this.bboxMax.y+.06,0);this.reticle.visible=false;
    const mags: THREE.Object3D[] = []; model.traverse((o) => { if (/mag(azine)?/i.test(o.name) && !/base|fde/i.test(o.name)) mags.push(o); });
    this.magNode = mags[0] ?? null; if (this.magNode) this.magRest.copy(this.magNode.position);
    this.muzzle.position.set(M.muzzle[0], M.muzzle[1], this.bboxMin.z + 0.01); this.ejectPt.position.set(M.eject[0], M.eject[1], M.eject[2]);
    this.flash.scale.setScalar(0.32 * def.flashScale);
    this.fragRoot.visible=false;this.reloadT = -1; this.boltT = -1; this.throwT = -1; this.holsterT = -1; this.drawT = 0; this.drawDur = def.drawTime;
    this.kickPos.set(0, 0, 0); this.kickVel.set(0, 0, 0); this.kickRot.set(0, 0, 0); this.kickRotVel.set(0, 0, 0);
  }

  fire(strength: number) {
    const d = this.def!;
    this.kickVel.z += 0.9 * strength; this.kickVel.y += 0.12 * strength; this.kickVel.x += rand(-0.15, 0.15) * strength;
    this.kickRotVel.x += 5.0 * strength; this.kickRotVel.z += rand(-1.5, 1.5) * strength; this.kickRotVel.y += rand(-0.6, 0.6) * strength;
    this.flashT = 0.045; this.flash.visible = true; this.flash.material.rotation = Math.random() * Math.PI * 2; this.flash.scale.setScalar(rand(0.28, 0.4) * d.flashScale);
    this.flashLight.intensity = 14 * d.flashScale;
  }

  update(dt: number, s: VMState) {
    const d = this.def; if (!d) return;
    const M = d.model;
    // ---- flash
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; } else { this.flashLight.intensity *= 0.6; } }
    // ---- pose blend (hip -> ads -> sprint)
    const sprintTarget = s.sprinting && s.ads < 0.2 && this.reloadT < 0 ? 1 : 0;
    this.sprintBlend = damp(this.sprintBlend, sprintTarget, 10, dt);
    this.lowerBlend = damp(this.lowerBlend, s.lowered, 10, dt);
    const px = lerp(M.hip[0], d.mode==='auto'?0:M.ads[0], s.ads), py = lerp(M.hip[1], d.mode==='auto'?-this.optic.position.y:M.ads[1], s.ads), pz = lerp(M.hip[2], M.ads[2], s.ads);
    const pos = this._v.set(lerp(px, M.sprint[0], this.sprintBlend), lerp(py, M.sprint[1], this.sprintBlend), lerp(pz, M.sprint[2], this.sprintBlend));
    const rot = this._e.set(M.sprintRot[0] * this.sprintBlend, M.sprintRot[1] * this.sprintBlend, M.sprintRot[2] * this.sprintBlend);
    // lowered (grenade / climbing)
    pos.y -= 0.35 * this.lowerBlend; rot.x -= 0.9 * this.lowerBlend; rot.y += 0.4 * this.lowerBlend;
    // ---- reload animation (procedural)
    if (this.reloadT >= 0) {
      this.reloadT += dt; const t = clamp(this.reloadT / this.reloadDur, 0, 1); const w = Math.sin(Math.PI * t);
      rot.z += 0.32 * w; rot.x += 0.22 * w; pos.y -= 0.06 * w; pos.x += 0.02 * w;
      // little jolt at mag insert
      const ins = clamp((t - 0.62) / 0.08, 0, 1); if (ins > 0 && ins < 1) pos.y += Math.sin(ins * Math.PI) * 0.02;
      if (this.magNode) { const mt = clamp((t - 0.22) / 0.5, 0, 1); const mo = Math.sin(mt * Math.PI); this.magNode.position.copy(this.magRest); this.magNode.position.y -= 0.16 * mo * M.scale; this.magNode.position.z += 0.02 * mo * M.scale; }
      if (t >= 1) { this.reloadT = -1; if (this.magNode) this.magNode.position.copy(this.magRest); }
    }
    // ---- bolt / pump
    if (this.boltT >= 0) {
      this.boltT += dt; const t = clamp(this.boltT / this.boltDur, 0, 1); const w = Math.sin(Math.PI * t);
      rot.z -= 0.28 * w; rot.x += 0.14 * w; pos.x += 0.035 * w; pos.z += 0.03 * w; pos.y -= 0.02 * w;
      if (t >= 1) this.boltT = -1;
    }
    // Pin pull, cocked hand, overarm release and follow-through share the projectile clock.
    const cooking=s.cookTime!==undefined;
    this.fragRoot.visible=cooking||this.throwT>=0;
    if(cooking){
      const t=clamp(s.cookTime!/.22,0,1),ease=1-(1-t)**3;
      this.fragHand.position.set(.27,-.48+.29*ease,-.42);
      this.fragHand.rotation.set(-.25,.1,-.12+Math.sin(t*Math.PI)*.25);this.frag.visible=true;
    }
    if(this.throwT>=0){
      const time=this.throwT;
      if(time<FRAG_RELEASE){const t=time/FRAG_RELEASE,e=t*t*(3-2*t);this.fragHand.position.set(.27-.12*e,-.19+.22*Math.sin(e*Math.PI),-.42-.4*e);this.fragHand.rotation.set(-.25-1.3*e,.1,-.12+.4*e);}
      else{const t=clamp((time-FRAG_RELEASE)/(FRAG_RECOVER-FRAG_RELEASE),0,1);this.fragHand.position.set(.15+.18*t,-.19-.65*t,-.82+.5*t);this.fragHand.rotation.set(-1.55+t,.1,.28-.4*t);}
      this.frag.visible=time<FRAG_RELEASE;
      pos.y-=.32*(1-clamp((time-.35)/.37,0,1));rot.z-=.3*(1-clamp((time-.35)/.37,0,1));
    }
    // ---- draw / holster
    if (this.drawT < 1) { this.drawT = Math.min(1, this.drawT + dt / Math.max(0.05, this.drawDur)); const k = 1 - this.drawT; const kk = k * k; pos.y -= 0.42 * kk; pos.x += 0.08 * kk; rot.x -= 1.1 * kk; rot.z -= 0.35 * kk; }
    if (this.holsterT >= 0) { this.holsterT += dt; const t = clamp(this.holsterT / this.holsterDur, 0, 1); const kk = t * t; pos.y -= 0.42 * kk; pos.x += 0.08 * kk; rot.x -= 1.1 * kk; rot.z -= 0.35 * kk; }
    // ---- sway (mouse lag) & bob & breathing
    const adsK = Math.pow(1 - s.ads, 2);
    const swTX = clamp(-s.mouseDY * 0.0022, -0.06, 0.06) * adsK, swTY = clamp(-s.mouseDX * 0.0022, -0.06, 0.06) * adsK, swTZ = clamp(s.mouseDX * 0.0012, -0.04, 0.04) * adsK;
    this.swayRot.x = damp(this.swayRot.x, swTX, 9, dt); this.swayRot.y = damp(this.swayRot.y, swTY, 9, dt); this.swayRot.z = damp(this.swayRot.z, swTZ, 9, dt);
    this.swayPos.x = damp(this.swayPos.x, clamp(-s.mouseDX * 0.00025, -0.03, 0.03) * adsK, 9, dt);
    this.swayPos.y = damp(this.swayPos.y, clamp(s.mouseDY * 0.00025, -0.03, 0.03) * adsK, 9, dt);
    const moving = s.grounded && s.speed > 0.5 && !s.climbing;
    const amp = (s.sprinting ? 0.03 : s.crouching ? 0.006 : 0.011) * adsK * (moving ? 1 : 0);
    const bobX = Math.cos(s.bobPhase) * amp, bobY = Math.abs(Math.sin(s.bobPhase)) * amp * 0.8 - amp * 0.4;
    const breatheY = Math.sin(s.time * 1.5) * 0.0025 * adsK + Math.sin(s.time * 0.7) * 0.0015 * adsK;
    const breatheR = Math.sin(s.time * 1.1) * 0.004 * adsK;
    // ---- kick springs
    const step = (p: THREE.Vector3, v: THREE.Vector3, k: number, dmp: number) => { for (const a of ['x', 'y', 'z'] as const) { const n = Math.max(1, Math.ceil(dt*120)), h = dt/n; for(let i=0;i<n;i++){v[a] += (-k*p[a]-dmp*v[a])*h; p[a] += v[a]*h;} } };
    step(this.kickPos, this.kickVel, 320, 24); step(this.kickRot, this.kickRotVel, 260, 20);
    // ---- compose
    this.holder.position.set(pos.x, pos.y, pos.z); this.holder.rotation.set(rot.x, rot.y, rot.z);
    this.pivot.position.set(this.swayPos.x * adsK + bobX + this.kickPos.x, this.swayPos.y * adsK + bobY + breatheY + this.kickPos.y, this.kickPos.z);
    this.pivot.rotation.set(this.swayRot.x * adsK + this.kickRot.x * 0.06 + breatheR * 0.3, this.swayRot.y * adsK + this.kickRot.y * 0.05, this.swayRot.z * adsK + this.kickRot.z * 0.05 + breatheR + (s.sliding ? -0.12 : 0));
    this.reticle.visible=d.mode==='auto'&&s.ads>.75&&this.reloadT<0&&!s.lowered&&this.throwT<0;
    // ---- hide when fully scoped
    const hide = !!d.scope && s.ads > 0.82;
    if (hide !== this.scopedHidden) { this.scopedHidden = hide; this.modelRoot.visible = !hide; }
  }

  muzzleWorld(out: THREE.Vector3) { return this.muzzle.getWorldPosition(out); }
  ejectWorld(out: THREE.Vector3) { return this.ejectPt.getWorldPosition(out); }
}

// ------------------------------------------------------------- bullets
export interface Bullet { pos: THREE.Vector3; dir: THREE.Vector3; speed: number; traveled: number; range: number; def: WeaponDef; owner: any; tracer: THREE.Mesh | null; dmgMul: number; whizzed: boolean; age: number; }
export interface EntityHit { bullet: Bullet; point: THREE.Vector3; normal: THREE.Vector3; owner: any; }

export class Bullets {
  list: Bullet[] = [];
  private tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6).rotateX(Math.PI / 2);
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  onEntityHit?: (h: EntityHit) => void;
  listener = new THREE.Vector3(); listenerOwner: any = null;
  private _a = new THREE.Vector3(); private _b = new THREE.Vector3(); private _q = new THREE.Quaternion();

  constructor(private scene: THREE.Scene, private physics: Physics, private effects: Effects, private audio: AudioManager) {}

  fire(def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, owner: any, o: { tracerStart?: THREE.Vector3; dmgMul?: number; tracer?: boolean } = {}) {
    let tracer: THREE.Mesh | null = null;
    if (o.tracer ?? def.tracer) {
      tracer = new THREE.Mesh(this.tracerGeo, this.tracerMat); tracer.frustumCulled = false; tracer.scale.set(1, 1, 0.01);
      tracer.position.copy(o.tracerStart ?? origin); this.scene.add(tracer);
    }
    this.list.push({ pos: origin.clone(), dir: dir.clone().normalize(), speed: def.bulletSpeed, traveled: 0, range: def.range, def, owner, tracer, dmgMul: o.dmgMul ?? 1, whizzed: false, age: 0 });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i]; b.age += dt;
      const segLen = b.speed * dt;
      // gravity drop (subtle, realistic ballistic arc)
      b.dir.y -= 9.81 * dt / b.speed; b.dir.normalize();
      const hit = this.physics.raycast(b.pos, b.dir, segLen, G.WORLD | G.VEHICLE | G.HITBOX | G.PLAYER, undefined, (c) => { const ow = this.physics.ownerOf(c); return !(ow && ow.entity === b.owner); });
      if (hit) {
        const ow = hit.owner;
        if (ow && ow.entity) { this.onEntityHit?.({ bullet: b, point: hit.point, normal: hit.normal, owner: ow }); }
        else { this.effects.impact(hit.point, hit.normal, ow?.surface ?? 'concrete', b.dir); }
        this.kill(i); continue;
      }
      // whizz-by for the listener (player)
      if (!b.whizzed && b.owner !== this.listenerOwner && b.age > 0.02) {
        const rel = this._a.subVectors(this.listener, b.pos); const along = rel.dot(b.dir);
        if (along > 0 && along < segLen + 0.5) { const perp = this._b.copy(rel).addScaledVector(b.dir, -along).length(); if (perp < 2.2) { b.whizzed = true; const side = new THREE.Vector3().crossVectors(b.dir, new THREE.Vector3(0, 1, 0)).dot(rel); this.audio.whizz(clamp(-side, -1, 1)); } }
      }
      b.pos.addScaledVector(b.dir, segLen); b.traveled += segLen;
      if (b.tracer) {
        const len = Math.min(2.2, b.traveled); b.tracer.scale.set(1, 1, len);
        b.tracer.position.copy(b.pos).addScaledVector(b.dir, -len * 0.5);
        b.tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.dir);
      }
      if (b.traveled > b.range || b.pos.y < -30) this.kill(i);
    }
  }
  clear() { while(this.list.length)this.kill(this.list.length-1); }
  private kill(i: number) { const b = this.list[i]; if (b.tracer) this.scene.remove(b.tracer); this.list.splice(i, 1); }
}

/** Random direction inside a cone (degrees, uniform over the disk). */
export function coneDir(fwd: THREE.Vector3, spreadDeg: number, out = new THREE.Vector3()) {
  const theta = spreadDeg * DEG * Math.sqrt(Math.random()); const phi = Math.random() * Math.PI * 2;
  const up = Math.abs(fwd.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize(); const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
  return out.copy(fwd).multiplyScalar(Math.cos(theta)).addScaledVector(right, Math.cos(phi) * Math.sin(theta)).addScaledVector(up2, Math.sin(phi) * Math.sin(theta)).normalize();
}

// ------------------------------------------------------------- player gunplay
export interface Slot { def: WeaponDef; mag: number; reserve: number; model: THREE.Object3D | null; }
export type GunEvent = { type: 'shot'; pos: THREE.Vector3; def: WeaponDef } | { type: 'reload' } | { type: 'switch'; def: WeaponDef } | { type: 'grenade'; pos: THREE.Vector3; vel: THREE.Vector3; fuse: number } | { type: 'ammo' };

export class Gunplay {
  slots: Slot[] = []; cur = 0; pending = -1;
  fireTimer = 0; bloom = 0; reloading = false; reloadT = 0; reloadDur = 0; magDone = false; bolting = false; boltT = 0; holstering = false; holsterT = 0; drawing = false; drawT = 0;
  lethals = 1; cooking = false; cookT = 0; throwing = false; throwT = 0; grenadeSpawned = false;
  triggerWasDown = false; adsHeld = false; firing = false; lastShotT = -9;
  /** Aim mode: hold (default) or toggle. */
  adsToggle = false; adsLatched = false; trackpad = false; blockFire = false;
  ready = false;
  private _m = new THREE.Vector3(); private _e = new THREE.Vector3(); private _d = new THREE.Vector3();

  constructor(private player: Player, private input: Input, public vm: ViewModel, private bullets: Bullets, private effects: Effects, private audio: AudioManager, private emit: (e: GunEvent) => void) {}

  get slot() { return this.slots[this.cur]; }
  get def() { return this.slot?.def; }
  get busy() { return this.reloading || this.bolting || this.holstering || this.drawing || this.cooking || this.throwing; }

  setLoadout(l: Loadout) {
    // Boot preloads every weapon. Equip atomically so a late promise cannot replace a newer life.
    const defs = [WEAPONS[l.primary], WEAPONS[l.secondary]];
    const models = defs.map(d => cloneWeaponModel(d, loadedModels.get(d.model.url)!));
    this.ready = false;
    this.slots = defs.map((d, i) => ({ def: d, mag: d.mag, reserve: d.reserve, model: models[i] }));
    this.lethals = l.lethal; this.cur = 0; this.pending = -1;
    this.reloading = false; this.bolting = false; this.holstering = false; this.cooking = false; this.throwing = false; this.bloom = 0; this.fireTimer = 0;
    this.adsHeld = this.adsLatched = this.triggerWasDown = this.firing = false;
    this.reloadT = this.boltT = this.holsterT = this.cookT = this.throwT = 0;
    this.grenadeSpawned = this.magDone = false;
    this.vm.setWeapon(this.slots[0].def, this.slots[0].model!); this.drawing = true; this.drawT = 0;
    this.ready = true; this.emit({ type: 'switch', def: this.slots[0].def }); this.emit({ type: 'ammo' });
  }

  refill() { for (const s of this.slots) { s.mag = s.def.mag; s.reserve = s.def.reserve; } this.emit({ type: 'ammo' }); }

  /** Current spread cone in degrees. */
  spread(): number {
    const d = this.def; if (!d) return 0; const p = this.player;
    let s = lerp(d.hipSpread, d.adsSpread, p.ads);
    s += d.moveSpread * clamp(p.speed / 5, 0, 1.4) * lerp(1, 0.35, p.ads);
    if (!p.grounded) s += d.jumpSpread;
    if (p.crouching) s *= d.crouchMul;
    s += this.bloom * lerp(1, 0.6, p.ads);
    return s;
  }

  updateAim(canControl: boolean) {
    const p=this.player, inp=this.input, d=this.def;
    if(!d)return;
    const alive=p.alive && canControl && !this.holstering;
    const adsBtn = inp.btn(2) || inp.down('AltLeft') || inp.down('AltRight');
    if (alive && inp.hit('KeyE')) this.adsLatched = !this.adsLatched; // E always toggles aim
    if (alive && this.adsToggle) { if (inp.btnHit(2) || inp.hit('AltLeft') || inp.hit('AltRight')) this.adsLatched = !this.adsLatched; }
    const adsIn = this.adsToggle ? this.adsLatched : (adsBtn || this.adsLatched);
    const adsBlocked = !alive || this.reloading || this.cooking || this.throwing || p.sprinting || !!p.climbing || (this.bolting && d.mode === 'bolt');
    if (adsBlocked && this.adsToggle && (this.reloading || this.cooking || this.throwing || !alive)) this.adsLatched = false;
    this.adsHeld = adsIn && !adsBlocked;
  }

  update(dt: number, canControl: boolean) {
    const p = this.player, inp = this.input; const d = this.def; if (!d || !this.ready) return;
    const slot = this.slot;
    this.bloom = Math.max(0, this.bloom - d.bloomDecay * dt);
    this.fireTimer -= dt; this.firing = false;
    const alive = p.alive && canControl;
    // ---- weapon switching
    if (alive && !this.holstering && !this.throwing && !this.cooking) {
      let want = -1;
      if (inp.hit('Digit1')) want = 0; else if (inp.hit('Digit2')) want = 1; else if (inp.hit('KeyQ') || inp.wheel !== 0) want = 1 - this.cur;
      if (want >= 0 && want !== this.cur && want < this.slots.length) { this.pending = want; this.holstering = true; this.holsterT = 0; this.vm.holsterT = 0; this.reloading = false; this.bolting = false; this.vm.reloadT = -1; this.vm.boltT = -1; }
    }
    if (this.holstering) {
      this.holsterT += dt;
      if (this.holsterT >= this.vm.holsterDur) {
        this.holstering = false; this.cur = this.pending; this.pending = -1; const ns = this.slot;
        this.vm.setWeapon(ns.def, ns.model!); this.drawing = true; this.drawT = 0;
        if (this.audio.has('draw_1')) this.audio.play(this.audio.pick(['draw_1', 'draw_2']), { vol: 0.6, rateVar: 0.05 }); else this.audio.weaponSwitch();
        this.emit({ type: 'switch', def: ns.def }); this.emit({ type: 'ammo' });
      }
      this.adsHeld = false; this.adsLatched = false; this.vm.update(dt, this.vmState()); return;
    }
    if (this.drawing) { this.drawT += dt; if (this.drawT >= d.drawTime) this.drawing = false; }
    // ---- reload
    if (this.reloading) {
      this.reloadT += dt;
      if (!this.magDone && this.reloadT >= this.reloadDur * d.magOutT) {
        this.magDone = true;
        if (d.mode === 'pump') { slot.mag += 1; slot.reserve -= 1; }
        else { const need = d.mag - slot.mag; const take = Math.min(need, slot.reserve); slot.mag += take; slot.reserve -= take; }
        this.emit({ type: 'ammo' });
      }
      if (this.reloadT >= this.reloadDur) {
        this.reloading = false;
        // shotgun: continue shell by shell
        if (d.mode === 'pump' && slot.mag < d.mag && slot.reserve > 0 && !(inp.btn(0) && slot.mag > 0)) this.startReload(true);
      }
    }
    const wantReload = alive && inp.hit('KeyR');
    if (wantReload && !this.reloading && !this.bolting && !this.drawing && !this.cooking && !this.throwing && slot.mag < d.mag && slot.reserve > 0) this.startReload();
    // ---- bolt / pump cycle
    if (this.bolting) { this.boltT += dt; if (this.boltT >= d.boltTime) this.bolting = false; }
    // ---- grenade
    if (alive && inp.hit('KeyG') && this.lethals > 0 && !this.cooking && !this.throwing && !this.reloading && !this.bolting) { this.cooking = true; this.cookT = 0; this.audio.grenadePin(); }
    if (this.cooking) {
      this.cookT += dt;
      if (!inp.down('KeyG') || this.cookT > 3.6 || !p.alive) { this.cooking = false; this.throwing = true; this.throwT = 0; this.grenadeSpawned = false; this.vm.throwT = 0; }
    }
    if (this.throwing) {
      this.throwT += dt;this.vm.throwT=this.throwT;
      if (!this.grenadeSpawned && this.throwT >= FRAG_RELEASE) {
        this.grenadeSpawned = true; this.lethals--;
        const origin = p.eyePos.clone().addScaledVector(p.right, 0.25).addScaledVector(p.forward, 0.35).add(new THREE.Vector3(0, -0.1, 0));
        const vel = p.forward.clone().multiplyScalar(19).add(new THREE.Vector3(0, 3.5, 0)).addScaledVector(p.vel, 0.6);
        this.emit({ type: 'grenade', pos: origin, vel, fuse: Math.max(0.05, 4.0 - this.cookT) });
      }
      if (this.throwT >= FRAG_RECOVER){this.throwing=false;this.vm.throwT=-1;}
    }
    // ---- firing
    const trigger = alive && !this.blockFire && (inp.btn(0) || inp.down('KeyF'));
    const canFire = alive && !this.reloading && !this.bolting && !this.holstering && !this.drawing && !this.cooking && !this.throwing && !p.climbing;
    const want = d.mode === 'auto' ? trigger : trigger && !this.triggerWasDown;
    if (want && canFire) {
      if (p.sprinting) { this.firing = true; } // cancels sprint via ctx, fires next frame
      else if (this.fireTimer <= 0) {
        if (slot.mag <= 0) { if (!this.triggerWasDown) { this.audio.dryFire(); if (slot.reserve > 0) this.startReload(); } }
        else { this.shoot(); }
      }
    }
    // shotgun: interrupt reload to fire
    if (trigger && !this.triggerWasDown && this.reloading && d.mode === 'pump' && slot.mag > 0) { this.reloading = false; }
    this.triggerWasDown = trigger;
    if (trigger) this.firing = true;
    // ---- view model
    this.vm.update(dt, this.vmState());
  }

  private vmState(): VMState {
    const p = this.player;
    return { ads: p.ads, sprinting: p.sprinting, speed: p.speed, grounded: p.grounded, crouching: p.crouching, sliding: p.sliding, mouseDX: this.input.mouseDX, mouseDY: this.input.mouseDY, bobPhase: p.bobPhase, time: performance.now() / 1000, climbing: !!p.climbing, lowered: (this.cooking || this.throwing || !!p.climbing) ? 1 : 0, cookTime:this.cooking?this.cookT:undefined };
  }

  startReload(continuing = false) {
    const d = this.def, slot = this.slot; if (!d) return;
    this.reloading = true; this.reloadT = 0; this.magDone = false;
    this.reloadDur = slot.mag === 0 && d.mode !== 'pump' ? d.reloadEmptyTime : d.reloadTime;
    this.vm.reloadT = 0; this.vm.reloadDur = this.reloadDur;
    const rl = d.audio && this.audio.has(d.audio.reload[0]) ? this.audio.pick(d.audio.reload) : d.sounds.reload;
    if (d.mode === 'pump') { this.audio.play(rl, { vol: continuing ? 0.6 : 0.7, rate: continuing ? 1.15 : 1.1, rateVar: 0.05 }); }
    else this.audio.play(rl, { vol: 0.9, rate: d.reloadTime > 2.2 ? 0.92 : 1.0, rateVar: 0.03, bus: 'gun' });
    this.emit({ type: 'reload' });
  }

  private shoot() {
    const d = this.def!, slot = this.slot, p = this.player;
    slot.mag--; this.fireTimer = 60 / d.rpm; this.lastShotT = performance.now() / 1000;
    const spread = this.spread(); const fwd = p.forward.clone(); const origin = p.eyePos.clone();
    const muzzle = this.vm.muzzleWorld(this._m).clone();
    for (let i = 0; i < d.pellets; i++) {
      const dir = coneDir(fwd, spread + (d.pellets > 1 ? d.pelletSpread : 0));
      this.bullets.fire(d, origin, dir, p, { tracerStart: muzzle, tracer: d.tracer && (d.pellets === 1 || i % 3 === 0) });
    }
    // recoil & feel
    const recoilP = -d.recoilPitch * rand(0.85, 1.15) * lerp(1, 0.75, p.ads) * (p.crouching ? 0.85 : 1);
    const recoilY = d.recoilYaw * (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 1) * d.recoilRand * lerp(1, 0.75, p.ads);
    p.applyRecoil(recoilP, recoilY); p.addShake(d.viewKick * 0.06);
    this.bloom = Math.min(d.bloomMax, this.bloom + d.bloom);
    this.vm.fire(d.viewKick);
    const ej = this.vm.ejectWorld(this._e).clone();
    if (d.mode !== 'bolt') this.effects.shell(ej, p.right, new THREE.Vector3(0, 1, 0), p.forward.clone().negate(), d.shell);
    if (d.audio && this.audio.has(d.audio.shot[0])) this.audio.playGunshot(d.audio);
    else if (d.cls === 'sniper') this.audio.sniperShot(d.sounds.shot, 'shot_bolt3_near', 'shot_bolt3_far');
    else this.audio.play(d.sounds.shot, { vol: d.sounds.shotVol ?? 0.9, rateVar: 0.035, reverb: d.cls === 'pistol' ? 0.2 : 0.3 });
    this.emit({ type: 'shot', pos: origin, def: d }); this.emit({ type: 'ammo' });
    if (d.mode === 'bolt' || d.mode === 'pump') {
      this.bolting = true; this.boltT = 0; this.vm.boltT = 0; this.vm.boltDur = d.boltTime;
      const delay = d.mode === 'bolt' ? 0.32 : 0.28;
      setTimeout(() => {
        const cyc = d.audio?.cycle && this.audio.has(d.audio.cycle[0]) ? this.audio.pick(d.audio.cycle) : null;
        if (d.mode === 'bolt') { if (cyc) this.audio.play(cyc, { vol: 0.75, rateVar: 0.04, bus: 'gun' }); else this.audio.boltCycle(); this.effects.shell(this.vm.ejectWorld(this._e).clone(), p.right, new THREE.Vector3(0, 1, 0), p.forward.clone().negate(), d.shell); }
        else this.audio.play(cyc ?? 'shotgun_pump', { vol: 0.8, rateVar: 0.05, bus: 'gun' });
      }, delay * 1000);
    }
    if (slot.mag === 0 && slot.reserve > 0 && d.mode !== 'pump') setTimeout(() => { if (this.slot === slot && slot.mag === 0 && !this.reloading && this.player.alive) this.startReload(); }, 350);
  }
}
