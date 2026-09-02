import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { WeaponDef } from './WeaponDefs';
import { loadWeaponModel, centerModel } from './Weapons';
import { clamp, damp, wrapAngle } from './util';

/** Soldier.glb faces -Z in its rest pose; puppet yaw 0 faces +Z (sin yaw, cos yaw), so offset by PI. */
export const MODEL_YAW = Math.PI;

let soldierPromise: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null = null;
function loadSoldier() {
  if (!soldierPromise) soldierPromise = new Promise((res, rej) => new GLTFLoader().load('/models/Soldier.glb', (g) => res({ scene: g.scene as THREE.Group, animations: g.animations }), undefined, rej));
  return soldierPromise;
}

const _right = new THREE.Vector3(), _fwd = new THREE.Vector3(), _tR = new THREE.Vector3(), _tL = new THREE.Vector3(), _hint = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => new THREE.Vector3());
/** Rotate a bone (minimal rotation) so its child direction points along dirWorld. */
function pointBone(bone: THREE.Object3D, child: THREE.Object3D, dirWorld: THREE.Vector3) {
  const qWorld = bone.getWorldQuaternion(_q1);
  const axisWorld = _v[0].copy(child.position).normalize().applyQuaternion(qWorld);
  const delta = _q2.setFromUnitVectors(axisWorld, _v[1].copy(dirWorld).normalize());
  const newWorld = delta.multiply(qWorld);
  const parentQ = (bone.parent as THREE.Object3D).getWorldQuaternion(_q3);
  bone.quaternion.copy(parentQ.invert().multiply(newWorld));
  bone.updateWorldMatrix(false, true);
}
/** Two-bone IK: upper arm + forearm reach `target`, elbow bends toward `hint`. */
function armIK(upper: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, hint: THREE.Vector3) {
  const S = upper.getWorldPosition(_v[2]), E = fore.getWorldPosition(_v[3]), H = hand.getWorldPosition(_v[4]);
  const L1 = S.distanceTo(E), L2 = E.distanceTo(H); if (L1 < 1e-4 || L2 < 1e-4) return;
  const toT = _v[5].subVectors(target, S); let d = toT.length(); const maxR = (L1 + L2) * 0.995; if (d > maxR) d = maxR; if (d < 0.02) return;
  const dir = toT.normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1); const a = Math.acos(cosA);
  const n = _v[6].crossVectors(dir, hint); if (n.lengthSq() < 1e-6) n.set(0, 0, 1); n.normalize();
  const bend = _v[7].crossVectors(n, dir).normalize();
  const elbow = _v[8].copy(S).addScaledVector(dir, Math.cos(a) * L1).addScaledVector(bend, Math.sin(a) * L1);
  pointBone(upper, fore, _v[0].subVectors(elbow, S));
  const E2 = fore.getWorldPosition(_v[3]); pointBone(fore, hand, _v[0].subVectors(target, E2));
}

export interface PuppetState { pos: THREE.Vector3; feetY: number; yaw: number; aimYaw: number; aimPitch: number; speed: number; alive: boolean; deathT: number; }

/** An animated soldier body holding a weapon, driven by explicit state (used for bots, the player's shadow and killcam replays). */
export class SoldierPuppet {
  model!: THREE.Group; mixer!: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction> = {};
  gunPivot = new THREE.Group(); gunHolder = new THREE.Group(); muzzle = new THREE.Object3D(); gunModel: THREE.Object3D | null = null;
  gripR = new THREE.Vector3(0, -0.08, 0.13); gripL = new THREE.Vector3(0, -0.05, -0.1);
  bones: { rArm?: THREE.Object3D; rFore?: THREE.Object3D; rHand?: THREE.Object3D; lArm?: THREE.Object3D; lFore?: THREE.Object3D; lHand?: THREE.Object3D } = {};
  def: WeaponDef | null = null; shadowOnly = false; private gunMats: THREE.Material[] = []; private bodyMats: THREE.Material[] = [];

  static async create(scene: THREE.Scene): Promise<SoldierPuppet> {
    const s = await loadSoldier(); const p = new SoldierPuppet();
    p.model = skClone(s.scene) as THREE.Group;
    p.model.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material = o.material.clone(); o.material.envMapIntensity = 0.8; p.bodyMats.push(o.material); } } });
    p.mixer = new THREE.AnimationMixer(p.model);
    for (const clip of s.animations) { const a = p.mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(clip.name === 'Idle' ? 1 : 0); a.play(); p.actions[clip.name] = a; }
    p.gunPivot.position.set(0.15, 1.41, 0.0); p.gunPivot.add(p.gunHolder); p.gunHolder.add(p.muzzle); p.model.add(p.gunPivot);
    p.model.traverse((o) => { const n = o.name; if (n === 'mixamorigRightArm') p.bones.rArm = o; else if (n === 'mixamorigRightForeArm') p.bones.rFore = o; else if (n === 'mixamorigRightHand') p.bones.rHand = o; else if (n === 'mixamorigLeftArm') p.bones.lArm = o; else if (n === 'mixamorigLeftForeArm') p.bones.lFore = o; else if (n === 'mixamorigLeftHand') p.bones.lHand = o; });
    scene.add(p.model);
    return p;
  }

  async setWeapon(def: WeaponDef) {
    if (this.def === def && this.gunModel) return;
    this.def = def;
    if (this.gunModel) { this.gunHolder.remove(this.gunModel); this.gunModel = null; }
    const gm = await loadWeaponModel(def);
    const M = def.model; gm.rotation.set(M.rot[0], M.rot[1], M.rot[2]); gm.scale.setScalar(M.scale * (M.worldScale ?? 1)); if (M.offset) gm.position.set(M.offset[0], M.offset[1], M.offset[2]);
    this.gunMats = [];
    gm.traverse((o: any) => { o.layers.set(0); if (o.isMesh) { o.castShadow = true; const ms = Array.isArray(o.material) ? o.material : [o.material]; const cl = ms.map((m: THREE.Material) => m.clone()); o.material = Array.isArray(o.material) ? cl : cl[0]; this.gunMats.push(...cl); } });
    const mn = new THREE.Vector3(), mx = new THREE.Vector3(); centerModel(gm, mn, mx);
    this.muzzle.position.set(0, 0.02, mn.z + 0.01);
    if (def.cls === 'pistol') { this.gunHolder.position.set(0.02, 0.06, -0.36); this.gripR.set(0, -0.05, 0.05); this.gripL.set(-0.01, -0.07, 0.03); }
    else { this.gunHolder.position.set(0.0, 0.03, -0.30); this.gripR.set(0, -0.08, 0.13); this.gripL.set(0, -0.05, -0.1); }
    this.gunHolder.add(gm); this.gunModel = gm;
    if (this.shadowOnly) this.setShadowOnly(true);
  }

  /** Shadow-only puppets cast shadows but write no color/depth (the player's own body). */
  setShadowOnly(on: boolean) {
    this.shadowOnly = on;
    for (const m of [...this.bodyMats, ...this.gunMats]) { (m as any).colorWrite = !on; (m as any).depthWrite = !on; m.needsUpdate = true; }
  }
  setVisible(v: boolean) { this.model.visible = v; }

  private setAnim(name: string, w: number, dt: number) { const a = this.actions[name]; if (!a) return; a.setEffectiveWeight(damp(a.getEffectiveWeight(), w, 10, dt)); }

  update(dt: number, s: PuppetState) {
    if (!s.alive) {
      const t = clamp(s.deathT / 0.7, 0, 1); const e = 1 - (1 - t) * (1 - t);
      this.model.position.set(s.pos.x, s.feetY - e * 0.15, s.pos.z); this.model.rotation.set(0, s.yaw + MODEL_YAW, 0); this.model.rotateX(-e * Math.PI / 2 * 0.95); this.model.rotateZ(e * 0.2);
      this.setAnim('Idle', 1, dt); this.setAnim('Walk', 0, dt); this.setAnim('Run', 0, dt); this.mixer.update(dt * 0.3);
      return;
    }
    const walk = clamp(s.speed / 3.2, 0, 1), run = clamp((s.speed - 3.2) / 3.2, 0, 1);
    this.setAnim('Idle', 1 - walk, dt); this.setAnim('Walk', walk * (1 - run), dt); this.setAnim('Run', run, dt);
    this.mixer.update(dt);
    this.model.position.set(s.pos.x, s.feetY, s.pos.z); this.model.rotation.set(0, s.yaw + MODEL_YAW, 0);
    this.gunPivot.rotation.set(s.aimPitch, wrapAngle(s.aimYaw - s.yaw), 0, 'YXZ');
    this.model.updateWorldMatrix(true, true);
    const B = this.bones;
    if (B.rArm && B.rFore && B.rHand && B.lArm && B.lFore && B.lHand) {
      const right = _right.set(1, 0, 0).applyQuaternion(this.model.quaternion); const fwd = _fwd.set(0, 0, -1).applyQuaternion(this.model.quaternion);
      const tR = this.gunHolder.localToWorld(_tR.copy(this.gripR)); const tL = this.gunHolder.localToWorld(_tL.copy(this.gripL));
      armIK(B.rArm, B.rFore, B.rHand, tR, _hint.set(0, -1, 0).addScaledVector(right, 0.6).addScaledVector(fwd, -0.25));
      armIK(B.lArm, B.lFore, B.lHand, tL, _hint.set(0, -1, 0).addScaledVector(right, -0.5).addScaledVector(fwd, 0.1));
    }
  }
}
