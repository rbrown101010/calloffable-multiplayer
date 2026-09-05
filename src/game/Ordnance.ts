import * as THREE from 'three';
import type { Game } from './Game';
import { WEAPONS } from './WeaponDefs';
import { G } from './Physics';
export type ProjectileState={id:number;weapon:string;owner:string;p:number[];v:number[];age:number};
/** Swept projectiles: one damage simulation on the host, bounded visual replicas elsewhere. */
export class Ordnance {
  list:{id:number;weapon:string;owner:any;p:THREE.Vector3;v:THREE.Vector3;age:number;mesh:THREE.Mesh}[]=[];
  private next=0;private geo=new THREE.CapsuleGeometry(.065,.35,2,6).rotateX(Math.PI/2);
  private material=new THREE.MeshStandardMaterial({color:0x73704a,emissive:0xff791f,emissiveIntensity:.7,roughness:.5});
  constructor(private g:Game){}
  launch(owner:any,weapon:string){
    const def=WEAPONS[weapon],shot=def?.projectile;if(!shot||this.list.length>=32||!owner?.alive)return;
    const local=owner===this.g.player,dir=local?owner.forward.clone():new THREE.Vector3(0,0,1).applyEuler(new THREE.Euler(-owner.aimPitch,owner.aimYaw,0,'YXZ'));
    const p=owner.eyePos.clone();const vehicle=this.g.vehicles?.list.find(v=>v.driver===(local?(this.g.online?.connected?this.g.online.id:'solo'):owner.netId));
    if(vehicle){dir.set(-Math.sin(vehicle.yaw),0,-Math.cos(vehicle.yaw));p.addScaledVector(dir,1.5);}
    const mesh=new THREE.Mesh(this.geo,this.material);this.g.scene.add(mesh);mesh.position.copy(p);
    this.list.push({id:++this.next,weapon,owner,p,v:dir.normalize().multiplyScalar(shot.speed),age:0,mesh});
  }
  snapshot():ProjectileState[]{return this.list.map(s=>({id:s.id,weapon:s.weapon,owner:this.g.online.entityId(s.owner),p:s.p.toArray(),v:s.v.toArray(),age:s.age}));}
  apply(states:ProjectileState[]){
    const ids=new Set(states.map(s=>s.id));for(let i=this.list.length-1;i>=0;i--)if(!ids.has(this.list[i].id))this.remove(i);
    for(const s of states.slice(0,32)){if(!WEAPONS[s.weapon]?.projectile)continue;let item=this.list.find(i=>i.id===s.id);if(!item){const mesh=new THREE.Mesh(this.geo,this.material);this.g.scene.add(mesh);item={id:s.id,weapon:s.weapon,owner:this.g.online.entity(s.owner),p:new THREE.Vector3(),v:new THREE.Vector3(),age:s.age,mesh};this.list.push(item);}item.p.fromArray(s.p);item.v.fromArray(s.v);item.age=s.age;}
  }
  update(dt:number){
    const authority=!this.g.online?.connected||this.g.online.isHost;
    for(let i=this.list.length-1;i>=0;i--){const s=this.list[i],def=WEAPONS[s.weapon],shot=def.projectile!;s.age+=dt;s.v.y-=shot.gravity*dt;const delta=s.v.clone().multiplyScalar(dt),distance=delta.length();
      const hit=authority?this.g.physics.raycast(s.p,delta.clone().normalize(),distance+.08,G.WORLD|G.HITBOX|G.PLAYER|G.BOT|G.VEHICLE,undefined,c=>{const o=this.g.physics.ownerOf(c);return o?.entity!==s.owner&&!(o?.vehicle?.driver===this.g.online?.entityId(s.owner));}):null;
      s.p.add(delta);if(authority&&(hit||s.age>=shot.fuse||s.p.y<-15)){const pos=hit?hit.point.clone().addScaledVector(hit.normal,.12):s.p;this.g.grenades.explodeAt(pos,s.owner,this.g.online?.connected?this.g.online.victims:this.g.bots.victims,shot.radius,shot.damage,def.name);this.remove(i);continue;}
      s.mesh.position.copy(s.p);s.mesh.lookAt(s.p.clone().add(s.v));if(!authority&&s.age>shot.fuse+.5)this.remove(i);
    }
  }
  private remove(i:number){this.list[i].mesh.removeFromParent();this.list.splice(i,1);}
  clear(){while(this.list.length)this.remove(this.list.length-1);}
}
