import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/** Collision groups (16-bit membership / filter). */
export const G = { WORLD: 0x0001, PLAYER: 0x0002, BOT: 0x0004, DEBRIS: 0x0008, GRENADE: 0x0010, HITBOX: 0x0020, ALL: 0xffff } as const;
export const cg = (member: number, filter: number = G.ALL) => ((member & 0xffff) << 16) | (filter & 0xffff);

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
  owner: any;
}

export class Physics {
  world!: RAPIER.World;
  owners = new Map<number, any>();
  private static _tmpDir = new THREE.Vector3();

  static async create(): Promise<Physics> {
    await RAPIER.init();
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    p.world.timestep = 1 / 60;
    return p;
  }

  get R() { return RAPIER; }

  setOwner(c: RAPIER.Collider, owner: any) { this.owners.set(c.handle, owner); }
  ownerOf(c: RAPIER.Collider) { return this.owners.get(c.handle); }

  addStaticBox(pos: THREE.Vector3, size: THREE.Vector3, quat?: THREE.Quaternion, member: number = G.WORLD, owner?: any) {
    const d = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(pos.x, pos.y, pos.z).setCollisionGroups(cg(member)).setFriction(0.8);
    if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const c = this.world.createCollider(d);
    if (owner !== undefined) this.setOwner(c, owner);
    return c;
  }

  addStaticCylinder(pos: THREE.Vector3, radius: number, height: number, quat?: THREE.Quaternion, member: number = G.WORLD, owner?: any) {
    const d = RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(pos.x, pos.y, pos.z).setCollisionGroups(cg(member)).setFriction(0.8);
    if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const c = this.world.createCollider(d);
    if (owner !== undefined) this.setOwner(c, owner);
    return c;
  }

  /** Static triangle mesh collider from a THREE mesh (world-space). */
  addStaticTrimesh(mesh: THREE.Mesh, member: number = G.WORLD, owner?: any) {
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    mesh.updateWorldMatrix(true, false);
    const verts = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z;
    }
    let idx: Uint32Array;
    if (geo.index) idx = new Uint32Array(geo.index.array as ArrayLike<number>);
    else { idx = new Uint32Array(pos.count); for (let i = 0; i < pos.count; i++) idx[i] = i; }
    const d = RAPIER.ColliderDesc.trimesh(verts, idx).setCollisionGroups(cg(member)).setFriction(0.9);
    const c = this.world.createCollider(d);
    if (owner !== undefined) this.setOwner(c, owner);
    return c;
  }

  /** Cast a ray. `filter` = bitmask of groups the ray may hit. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter: number = G.ALL, exclude?: RAPIER.Collider, predicate?: (c: RAPIER.Collider) => boolean): RayHit | null {
    const d = Physics._tmpDir.copy(dir).normalize();
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: d.x, y: d.y, z: d.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, cg(G.ALL, filter), exclude, undefined, predicate);
    if (!hit) return null;
    const toi: number = (hit as any).timeOfImpact ?? (hit as any).toi;
    const point = new THREE.Vector3(origin.x + d.x * toi, origin.y + d.y * toi, origin.z + d.z * toi);
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    return { point, normal, distance: toi, collider: hit.collider, owner: this.owners.get(hit.collider.handle) };
  }

  /** Line of sight between two points against WORLD geometry only. */
  clearLine(a: THREE.Vector3, b: THREE.Vector3, filter: number = G.WORLD): boolean {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length(); if (len < 1e-4) return true;
    dir.divideScalar(len);
    const ray = new RAPIER.Ray({ x: a.x, y: a.y, z: a.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, len, true, undefined, cg(G.ALL, filter));
    return !hit;
  }

  stepDebug = { tries: 0, ok: 0, last: '' };
  /**
   * Move a kinematic character. Rapier's built-in autostep is unreliable once the shape already touches the
   * obstacle, so when horizontal motion is blocked we retry as up → forward → down using explicit shape casts.
   */
  moveCharacter(cc: RAPIER.KinematicCharacterController, collider: RAPIER.Collider, pos: THREE.Vector3, desired: { x: number; y: number; z: number }, groups: number, groundedBefore: boolean, stepHeight = 0.55): { x: number; y: number; z: number; grounded: boolean } {
    cc.computeColliderMovement(collider, desired, undefined, groups);
    const m0 = cc.computedMovement(); let m = { x: m0.x, y: m0.y, z: m0.z }; let grounded = cc.computedGrounded();
    const wantH = Math.hypot(desired.x, desired.z), gotH = Math.hypot(m.x, m.z);
    if (groundedBefore && wantH > 1e-5 && gotH < wantH * 0.7) {
      this.stepDebug.tries++;
      const shape = collider.shape; const rot = collider.rotation(); const margin = 0.02;
      // up/forward casts ignore an initial penetration (the controller can leave the shape slightly embedded in a slope wedge)
      const cast = (from: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, stopAtPen = false) => {
        const hit = this.world.castShape(from, rot, vel, shape, 0, 1, stopAtPen, undefined, groups, collider, undefined, undefined);
        const toi: number = hit ? ((hit as any).time_of_impact ?? (hit as any).timeOfImpact ?? (hit as any).toi) : 1;
        return { toi, hit: !!hit };
      };
      const p0 = { x: pos.x, y: pos.y, z: pos.z };
      // probe a bit further than this frame's motion so a near-zero velocity can still resolve the step, then scale back
      const probe = Math.max(wantH, 0.06); const px = desired.x / wantH * probe, pz = desired.z / wantH * probe;
      const upCast = cast(p0, { x: 0, y: stepHeight, z: 0 });
      const upY = Math.max(0, stepHeight * upCast.toi - (upCast.hit ? margin : 0));
      if (upY > 0.03) {
        const p1 = { x: p0.x, y: p0.y + upY, z: p0.z };
        const fwCast = cast(p1, { x: px, y: 0, z: pz });
        const fwK = Math.max(0, fwCast.toi - (fwCast.hit ? margin / probe : 0));
        const p2 = { x: p1.x + px * fwK, y: p1.y, z: p1.z + pz * fwK };
        const dnDist = upY + 0.1; const dnCast = cast(p2, { x: 0, y: -dnDist, z: 0 }, true);
        if (dnCast.hit) {
          const dnY = Math.max(0, dnDist * dnCast.toi - margin);
          const p3 = { x: p2.x, y: p2.y - dnY, z: p2.z };
          const climbed = p3.y - p0.y; const fwH = probe * fwK;
          this.stepDebug.last = `up=${upY.toFixed(3)} fwK=${fwK.toFixed(2)} climbed=${climbed.toFixed(3)} gotH=${gotH.toFixed(4)} wantH=${wantH.toFixed(4)}`;
          if (fwH > gotH + 1e-4 && climbed > 0.004 && climbed <= stepHeight) {
            const k = Math.min(1, wantH / Math.max(1e-6, fwH)); // scale the probe result back to this frame's motion
            m = { x: (p3.x - p0.x) * k, y: (p3.y - p0.y) * k, z: (p3.z - p0.z) * k }; grounded = true; this.stepDebug.ok++;
          }
        } else this.stepDebug.last = `no-ground up=${upY.toFixed(3)} fwK=${fwK.toFixed(2)}`;
      } else this.stepDebug.last = `ceiling up=${upY.toFixed(3)}`;
    }
    return { x: m.x, y: m.y, z: m.z, grounded };
  }

  step(dt: number) { this.world.timestep = dt; this.world.step(); }
}
