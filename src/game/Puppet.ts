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
const wristBasis = [new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0))),new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,-1,0),new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,1)))];
const wristWorld = new THREE.Quaternion(), wristParent = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _boneDirection = new THREE.Vector3(), _boneAxis = new THREE.Vector3();
const _v = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => new THREE.Vector3());
/** Rotate a bone (minimal rotation) so its child direction points along dirWorld. */
function pointBone(bone: THREE.Object3D, child: THREE.Object3D, dirWorld: THREE.Vector3) {
  const qWorld = bone.getWorldQuaternion(_q1);
  // Preserve the requested direction: callers use shared IK scratch vectors.
  _boneDirection.copy(dirWorld).normalize();
  const axisWorld = _boneAxis.copy(child.position).normalize().applyQuaternion(qWorld);
  const delta = _q2.setFromUnitVectors(axisWorld, _boneDirection);
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

export interface PuppetState { pos: THREE.Vector3; feetY: number; yaw: number; aimYaw: number; aimPitch: number; speed: number; alive: boolean; deathT: number; deathStyle?:number; deathDir?: THREE.Vector3; flinch?: number; crouch?: boolean; riding?: boolean; motorcycle?:boolean; }

/** An animated soldier body holding a weapon, driven by explicit state (used for bots, the player's shadow and killcam replays). */
export class SoldierPuppet {
  model!: THREE.Group; mixer!: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction> = {};
  gunPivot = new THREE.Group(); gunHolder = new THREE.Group(); muzzle = new THREE.Object3D(); gunModel: THREE.Object3D | null = null;
  gripR = new THREE.Vector3(0, -0.08, 0.13); gripL = new THREE.Vector3(0, -0.05, -0.1);
  bones: { rArm?: THREE.Object3D; rFore?: THREE.Object3D; rHand?: THREE.Object3D; lArm?: THREE.Object3D; lFore?: THREE.Object3D; lHand?: THREE.Object3D; spine1?: THREE.Object3D; spine2?: THREE.Object3D; neck?: THREE.Object3D; head?: THREE.Object3D; rShoulder?: THREE.Object3D } = {};
  private legs: { thigh:THREE.Object3D; shin:THREE.Object3D; foot:THREE.Object3D }[]=[];
  private scene!: THREE.Scene; private _e = new THREE.Euler(); private _q = new THREE.Quaternion(); private _p = new THREE.Vector3(); private _off = new THREE.Vector3();
  def: WeaponDef | null = null; shadowOnly = false; private crouchBlend = 0; private gunMats: THREE.Material[] = []; private bodyMats: THREE.Material[] = []; private fingerRest = new Map<THREE.Object3D,THREE.Quaternion>();

  static async create(scene: THREE.Scene): Promise<SoldierPuppet> {
    const s = await loadSoldier(); const p = new SoldierPuppet();
    p.model = skClone(s.scene) as THREE.Group;
    p.model.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material = o.material.clone(); o.material.envMapIntensity = 0.8; p.bodyMats.push(o.material); } } });
    p.mixer = new THREE.AnimationMixer(p.model);
    for (const clip of s.animations) { const a = p.mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(clip.name === 'Idle' ? 1 : 0); a.play(); p.actions[clip.name] = a; }
    // the gun pivot lives in world space (not under the animated hierarchy) so it can be aimed exactly and follow the twisting torso
    p.gunPivot.add(p.gunHolder); p.gunHolder.add(p.muzzle); scene.add(p.gunPivot); p.scene = scene;
    p.model.traverse((o) => { const n = o.name; if (n === 'mixamorigRightArm') p.bones.rArm = o; else if (n === 'mixamorigRightForeArm') p.bones.rFore = o; else if (n === 'mixamorigRightHand') p.bones.rHand = o; else if (n === 'mixamorigLeftArm') p.bones.lArm = o; else if (n === 'mixamorigLeftForeArm') p.bones.lFore = o; else if (n === 'mixamorigLeftHand') p.bones.lHand = o; else if (n === 'mixamorigSpine1') p.bones.spine1 = o; else if (n === 'mixamorigSpine2') p.bones.spine2 = o; else if (n === 'mixamorigNeck') p.bones.neck = o; else if (n === 'mixamorigHead') p.bones.head = o; else if (n === 'mixamorigRightShoulder') p.bones.rShoulder = o; });
    p.model.traverse(o=>{if(/Hand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(o.name))p.fingerRest.set(o,o.quaternion.clone());});
    for(const side of ['Left','Right'])p.legs.push({thigh:p.model.getObjectByName('mixamorig'+side+'UpLeg')!,shin:p.model.getObjectByName('mixamorig'+side+'Leg')!,foot:p.model.getObjectByName('mixamorig'+side+'Foot')!});
    scene.add(p.model);
    return p;
  }

  async setWeapon(def: WeaponDef) {
    if (this.def === def && this.gunModel) return;
    this.def = def;
    for(const material of this.gunMats)material.dispose();this.gunMats=[];
    if (this.gunModel) { this.gunHolder.remove(this.gunModel); this.gunModel = null; }
    const gm = await loadWeaponModel(def);
    if(this.def!==def)return;
    const M = def.model; gm.rotation.set(M.rot[0], M.rot[1], M.rot[2]); gm.scale.setScalar(M.scale * (M.worldScale ?? 1)); if (M.offset) gm.position.set(M.offset[0], M.offset[1], M.offset[2]);
    this.gunMats = [];
    gm.traverse((o: any) => { o.layers.set(0); if (o.isMesh) { o.castShadow = true; const ms = Array.isArray(o.material) ? o.material : [o.material]; const cl = ms.map((m: THREE.Material) => m.clone()); o.material = Array.isArray(o.material) ? cl : cl[0]; this.gunMats.push(...cl); } });
    const mn = new THREE.Vector3(), mx = new THREE.Vector3(); centerModel(gm, mn, mx);
    this.muzzle.position.set(0, 0.02, mn.z + 0.01);
    if (def.cls === 'pistol') { this.gunHolder.position.set(0.02, 0.06, -0.36); this.gripR.set(.035, -.08, .16); this.gripL.set(-.09, -.08, .03); }
    else { this.gunHolder.position.set(0.0, 0.03, -0.38); this.gripR.set(.035, -.08, .25); this.gripL.set(-.12, -.065, -.07); }
    this.gunHolder.add(gm); this.gunModel = gm;
    if (this.shadowOnly) this.setShadowOnly(true);
  }

  dispose(){
    this.mixer.stopAllAction();this.mixer.uncacheRoot(this.model);this.model.removeFromParent();this.gunPivot.removeFromParent();
    for(const m of new Set([...this.bodyMats,...this.gunMats]))m.dispose();
    const skeletons=new Set<THREE.Skeleton>();this.model.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((o as THREE.SkinnedMesh).skeleton);});for(const s of skeletons)s.dispose();
  }
  /** Shadow-only puppets cast shadows but write no color/depth (the player's own body). */
  setShadowOnly(on: boolean) {
    this.shadowOnly = on;
    for (const m of [...this.bodyMats, ...this.gunMats]) { (m as any).colorWrite = !on; (m as any).depthWrite = !on; }
  }
  setVisible(v: boolean) { this.model.visible = v; this.gunPivot.visible = v; }
  /** Slight per-operator uniform tint so bots are distinguishable. */
  setTint(hex: number) { for (const m of this.bodyMats) { const mm = m as THREE.MeshStandardMaterial; if (mm.color) mm.color.set(hex); } }

  equip(index: number) {
    // Mixamo bones are in centimeters; keep the added equipment in meters.
    const uniform=[0x76806a,0x9a957c,0x707c7f,0x94937b][index%4];this.setTint(uniform);
    const fabric=new THREE.MeshStandardMaterial({color:[0x384335,0x625d45,0x333d44,0x53583e][index%4],roughness:.92});
    const black=new THREE.MeshStandardMaterial({color:0x121b1c,roughness:.42,metalness:.35});
    const attach=(bone:THREE.Object3D|undefined)=>{const group=new THREE.Group();group.scale.setScalar(100);bone?.add(group);return group;};
    const gear=attach(this.bones.head);
    const helmet=new THREE.Mesh(new THREE.SphereGeometry(.14,24,16,0,Math.PI*2,0,Math.PI*.58),fabric);helmet.scale.z=1.1;helmet.position.set(0,.15,.008);gear.add(helmet);
    const goggles=new THREE.Mesh(new THREE.BoxGeometry(.195,.057,.045),black);goggles.position.set(0,.14,.104);gear.add(goggles);
    for(const x of [-.125,.125]){const ear=new THREE.Mesh(new THREE.BoxGeometry(.038,.087,.07),fabric);ear.position.set(x,.11,.005);gear.add(ear);}
    const chest=attach(this.bones.spine2);
    for(const x of [-.073,0,.073]){const pouch=new THREE.Mesh(new THREE.BoxGeometry(.063,.115,.055),fabric);pouch.position.set(x,-.045,.135);chest.add(pouch);}
    const radio=new THREE.Mesh(new THREE.BoxGeometry(.06,.10,.055),black);radio.position.set(-.135,.05,.10);chest.add(radio);
    const antenna=new THREE.Mesh(new THREE.CylinderGeometry(.0025,.003,.17,6),black);antenna.position.set(-.135,.175,.10);chest.add(antenna);
    for(const group of [gear,chest])group.traverse((o:any)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;this.bodyMats.push(o.material);}});
  }

  private gripHand(hand:THREE.Object3D,left:boolean) {
    // Set the wrist in weapon space. The trigger hand is vertical; the support palm cups the fore-end.
    wristWorld.copy(this.gunPivot.quaternion).multiply(wristBasis[left?1:0]);
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(wristParent).invert().multiply(wristWorld));
    for(const [bone,rest]of this.fingerRest){if(!bone.name.includes(left?'Left':'Right'))continue;bone.quaternion.copy(rest);
      const thumb=bone.name.includes('Thumb'),index=bone.name.includes('Index'),joint=Number(bone.name.slice(-1));
      bone.rotateZ(thumb ? .38 : (!left&&index ? .45 : (joint===1 ? .92 : 1.1)));
      if(thumb)bone.rotateY(left?-.4:.4);
    }
    hand.updateWorldMatrix(false,true);
  }
  private setAnim(name: string, w: number, dt: number) { const a = this.actions[name]; if (!a) return; a.setEffectiveWeight(damp(a.getEffectiveWeight(), w, 10, dt)); }

  private placeGun(s: PuppetState) {
    // pivot sits just in front of the right shoulder joint and points exactly along the aim
    const B = this.bones; const fwd = this._off.set(Math.sin(s.aimYaw), 0, Math.cos(s.aimYaw)); const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (B.rArm) B.rArm.getWorldPosition(this._p); else this._p.set(s.pos.x, s.feetY + 1.45, s.pos.z);
    this.gunPivot.position.copy(this._p).addScaledVector(right, 0.09).addScaledVector(fwd, 0.04).add(new THREE.Vector3(0, -.025, 0));
    this.gunPivot.quaternion.setFromEuler(this._e.set(s.aimPitch, s.aimYaw + Math.PI, 0, 'YXZ'));
    this.gunPivot.updateMatrixWorld(true);
  }

  update(dt: number, s: PuppetState) {
    if (!s.alive) {
      const style=(s.deathStyle||0)%6,t=clamp(s.deathT/(style===3?1.15:.88),0,1),e=1-Math.pow(1-t,3),impact=Math.sin(t*Math.PI);
      const dd=s.deathDir??new THREE.Vector3(Math.sin(s.yaw),0,Math.cos(s.yaw));
      this.setAnim('Idle',1,dt);this.setAnim('Walk',0,dt);this.setAnim('Run',0,dt);this.mixer.update(dt*.2);
      const spin=style===4?e*2.4:0,kneel=style===3?Math.sin(Math.min(1,t*1.6)*Math.PI/2)*.58:0;
      this.model.position.set(s.pos.x+dd.x*(style===5?e*.65:0),s.feetY+.08+impact*(style===5?.55:.08)-kneel*(1-e),s.pos.z+dd.z*(style===5?e*.65:0));
      this.model.rotation.set(0,s.yaw+MODEL_YAW+spin,0);
      if(style===1||style===2)this.model.rotateZ((style===1?1:-1)*e*1.5);
      else if(style===3)this.model.rotateX(e*1.48);
      else this.model.rotateOnWorldAxis(new THREE.Vector3(dd.z,0,-dd.x),-e*1.5);
      for(const {thigh,shin}of this.legs){thigh?.rotateX(style===3?-kneel*1.8:impact*.4);shin?.rotateX(style===3?kneel*2.4:impact*.8);}
      this.bones.rArm?.rotateZ(-impact*(style===5?1.9:.65));this.bones.lArm?.rotateZ(impact*(style===4?1.8:.7));
      this.bones.head?.rotateX(impact*.3);this.model.updateWorldMatrix(true,true);
      this.placeGun({...s,aimPitch:-.6-e*.8});this.gunPivot.position.y=Math.max(s.feetY+.16,this.gunPivot.position.y-e*.7);this.gunPivot.rotateZ((style%2?1:-1)*e*.6);
      return;
    }

    const walk = s.riding ? 0 : clamp(s.speed / 3.2, 0, 1), run = s.riding ? 0 : clamp((s.speed - 3.2) / 3.2, 0, 1);
    this.setAnim('Idle', 1 - walk, dt); this.setAnim('Walk', walk * (1 - run), dt); this.setAnim('Run', run, dt);
    this.mixer.update(dt);
    this.crouchBlend = damp(this.crouchBlend,s.riding?1.35:s.crouch?1:0,12,dt);
    this.model.position.set(s.pos.x, s.feetY - this.crouchBlend*.4, s.pos.z); this.model.rotation.set(0, s.yaw + MODEL_YAW, 0);
    for(const {thigh,shin} of this.legs) { if(!s.riding){if(thigh)thigh.rotateX(-this.crouchBlend*.72);if(shin)shin.rotateX(this.crouchBlend*1.15);} }
    // torso twist + head look toward the aim; flinch pitches the chest back briefly
    const dYaw = clamp(wrapAngle(s.aimYaw - s.yaw), -1.2, 1.2); const pitch = clamp(s.aimPitch, -0.9, 0.9); const fl = s.flinch ?? 0;
    const B = this.bones;
    if (B.spine1) { B.spine1.rotateY(dYaw * 0.35); B.spine1.rotateX(pitch * 0.25 + fl * 0.35 + this.crouchBlend*.23); }
    if (B.spine2) { B.spine2.rotateY(dYaw * 0.35); B.spine2.rotateX(pitch * 0.35 + fl * 0.3); }
    if (B.head) { B.head.rotateY(dYaw * 0.3); B.head.rotateX(pitch * 0.4); }
    this.model.updateWorldMatrix(true, true);
    if(s.riding){
      const footQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
      this.legs.forEach(({thigh,shin,foot},index)=>{
        const side=index===0?-1:1;
        foot.getWorldQuaternion(footQ);
        const target=new THREE.Vector3(side*(s.motorcycle?.24:.57),.17,0).applyQuaternion(this.model.quaternion).add(new THREE.Vector3(s.pos.x,s.feetY,s.pos.z));
        const hint=new THREE.Vector3(side*.2,0,-1).applyQuaternion(this.model.quaternion);
        armIK(thigh,shin,foot,target,hint);
        foot.quaternion.copy(foot.parent!.getWorldQuaternion(parentQ).invert().multiply(footQ));foot.updateWorldMatrix(false,true);
      });
    }
    this.placeGun(s);
    this.gunPivot.visible=this.model.visible;
    if (B.rArm && B.rFore && B.rHand && B.lArm && B.lFore && B.lHand) {
      const right = _right.set(1, 0, 0).applyQuaternion(this.model.quaternion); const fwd = _fwd.set(0, 0, -1).applyQuaternion(this.model.quaternion);
      const tR = this.gunHolder.localToWorld(_tR.copy(this.gripR)); const tL = this.gunHolder.localToWorld(_tL.copy(this.gripL));
      if(s.riding){
        // Hands meet the handlebar grips, with the legs folded around the saddle.
        const q=this.model.quaternion;
        // Right hand holds the forward-facing weapon; left hand steers.
        tL.set(s.motorcycle?-.29:-.38,s.motorcycle?.11:-.01,s.motorcycle?-.66:-.42).applyQuaternion(q).add(new THREE.Vector3(s.pos.x,s.feetY+.9,s.pos.z));
      }
      armIK(B.rArm, B.rFore, B.rHand, tR, _hint.set(0, -1, 0).addScaledVector(right, 0.6).addScaledVector(fwd, -0.25));
      armIK(B.lArm, B.lFore, B.lHand, tL, _hint.set(0, -1, 0).addScaledVector(right, -0.5).addScaledVector(fwd, 0.1));
      this.gripHand(B.rHand,false);this.gripHand(B.lHand,true);
    }
  }
}
