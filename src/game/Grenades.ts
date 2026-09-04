import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics, G, cg } from './Physics';
import { Effects } from './Effects';
import { AudioManager } from './Audio';
import { buildGrenade } from './ProceduralGuns';
import { clamp, lerp, smoothstep } from './util';

export interface GrenadeVictim { entity: any; pos: THREE.Vector3; alive: boolean; }

export class Grenades {
  list: { body: RAPIER.RigidBody; mesh: THREE.Object3D; fuse: number; owner: any; lastSpeed: number; age: number }[] = [];
  private proto = buildGrenade();
  onExplode?: (pos: THREE.Vector3, owner: any) => void;
  onVictimHit?: (victim: any, killed: boolean, owner: any) => void;
  constructor(private scene: THREE.Scene, private physics: Physics, private effects: Effects, private audio: AudioManager) {}

  throw(pos: THREE.Vector3, vel: THREE.Vector3, fuse: number, owner: any) {
    const R = this.physics.R;
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: Math.random() * 12, y: Math.random() * 12, z: Math.random() * 12 }).setLinearDamping(0.12).setAngularDamping(0.5).setCcdEnabled(true));
    this.physics.world.createCollider(R.ColliderDesc.ball(0.045).setRestitution(0.38).setFriction(0.55).setDensity(3).setCollisionGroups(cg(G.GRENADE, G.WORLD | G.VEHICLE | G.PLAYER | G.BOT)), body);
    const mesh = this.proto.clone(); mesh.position.copy(pos); this.scene.add(mesh);
    this.list.push({ body, mesh, fuse, owner, lastSpeed: vel.length(), age: 0 });
  }

  clear() { for(const g of this.list){this.physics.world.removeRigidBody(g.body);this.scene.remove(g.mesh);}this.list=[]; }

  update(dt: number, victims: () => GrenadeVictim[]) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i]; g.fuse -= dt; g.age += dt;
      const p = g.body.translation(), q = g.body.rotation(); g.mesh.position.set(p.x, p.y, p.z); g.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      const v = g.body.linvel(); const sp = Math.hypot(v.x, v.y, v.z);
      if (g.lastSpeed - sp > 2.5 && g.age > 0.1) this.audio.grenadeBounce(g.mesh.position, clamp((g.lastSpeed - sp) / 10, 0.3, 1));
      g.lastSpeed = sp;
      if (g.fuse <= 0 || p.y < -10) {
        const pos = new THREE.Vector3(p.x, p.y, p.z);
        this.physics.world.removeRigidBody(g.body); this.scene.remove(g.mesh); this.list.splice(i, 1);
        this.explode(pos, g.owner, victims());
      }
    }
  }

  private explode(pos: THREE.Vector3, owner: any, victims: GrenadeVictim[]) { this.explodeAt(pos, owner, victims, 8, 165, 'FRAG'); }

  /** Generic explosion with line-of-sight damage falloff (grenades, airstrikes). */
  explodeAt(pos: THREE.Vector3, owner: any, victims: GrenadeVictim[], radius = 8, maxDmg = 165, weapon = 'FRAG') {
    const down = this.physics.raycast(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, -1, 0), 2.5, G.WORLD);
    this.effects.explosion(pos, down ? down.normal : undefined);
    this.onExplode?.(pos, owner);
    const origin = pos.clone().add(new THREE.Vector3(0, 0.35, 0));
    for (const v of victims) {
      if (!v.alive) continue;
      const d = v.pos.distanceTo(pos); if (d > radius) continue;
      const los = this.physics.clearLine(origin, v.pos.clone().add(new THREE.Vector3(0, 0.3, 0))) || this.physics.clearLine(origin, v.pos.clone().add(new THREE.Vector3(0, -0.6, 0)));
      if (!los) continue;
      const dmg = lerp(maxDmg, 12, smoothstep(radius * 0.15, radius, d));
      if (v.entity.takeDamage) { const killed: boolean = v.entity.takeDamage(dmg, owner, 'body', weapon, pos); this.onVictimHit?.(v.entity, killed, owner); }
    }
  }
}
