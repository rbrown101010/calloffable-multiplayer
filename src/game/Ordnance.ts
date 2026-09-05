import * as THREE from 'three';
import type { Game } from './Game';
import { WEAPONS } from './WeaponDefs';
import { G } from './Physics';
export type ProjectileState={id:number;weapon:string;owner:string;p:number[];v:number[];age:number;travel:number;dud:boolean};
type Round={id:number;weapon:string;owner:any;p:THREE.Vector3;v:THREE.Vector3;age:number;travel:number;dud:boolean;mesh:THREE.Mesh};
/** Swept, host-authoritative rounds. Grenades arm in flight; an early collision makes a harmless dud. */
export class Ordnance {
  list:Round[]=[];
  private next=0;private geo=new THREE.CapsuleGeometry(.065,.22,2,8).rotateX(Math.PI/2);
  private material=new THREE.MeshStandardMaterial({color:0x80724d,metalness:.65,roughness:.46});
  constructor(private g:Game){}
  launch(owner:any,weapon:string){
    const def=WEAPONS[weapon],shot=def?.projectile;if(!shot||this.list.length>=32||!owner?.alive)return;
    const local=owner===this.g.player,dir=local?owner.forward.clone():new THREE.Vector3(0,0,1).applyEuler(new THREE.Euler(-owner.aimPitch,owner.aimYaw,0,'YXZ'));
    const p=owner.eyePos.clone();const vehicle=this.g.vehicles?.list.find(v=>v.driver===(local?(this.g.online?.connected?this.g.online.id:'solo'):owner.netId));
    if(vehicle){dir.set(-Math.sin(vehicle.yaw),0,-Math.cos(vehicle.yaw));p.addScaledVector(dir,1.5);}
    const mesh=new THREE.Mesh(this.geo,this.material);this.g.scene.add(mesh);mesh.position.copy(p);
    this.list.push({id:++this.next,weapon,owner,p,v:dir.normalize().multiplyScalar(shot.speed),age:0,travel:0,dud:false,mesh});
  }
  snapshot():ProjectileState[]{return this.list.map(s=>({id:s.id,weapon:s.weapon,owner:this.g.online.entityId(s.owner),p:s.p.toArray(),v:s.v.toArray(),age:s.age,travel:s.travel,dud:s.dud}));}
  apply(states:ProjectileState[]){
    const ids=new Set(states.map(s=>s.id));for(let i=this.list.length-1;i>=0;i--)if(!ids.has(this.list[i].id))this.remove(i);
    for(const s of states.slice(0,32)){if(!WEAPONS[s.weapon]?.projectile||s.p?.length!==3||s.v?.length!==3||!s.p.every(Number.isFinite)||!s.v.every(Number.isFinite))continue;let item=this.list.find(i=>i.id===s.id);if(!item){const mesh=new THREE.Mesh(this.geo,this.material);this.g.scene.add(mesh);item={id:s.id,weapon:s.weapon,owner:this.g.online.entity(s.owner),p:new THREE.Vector3(),v:new THREE.Vector3(),age:0,travel:0,dud:false,mesh};this.list.push(item);}item.p.fromArray(s.p);item.v.fromArray(s.v);item.age=s.age;item.travel=s.travel||0;item.dud=!!s.dud;}
  }
  update(dt:number){
    const authority=!this.g.online?.connected||this.g.online.isHost;
    // Fixed substeps keep the arc and impacts consistent at low frame rates.
    const steps=Math.max(1,Math.ceil(Math.min(dt,.15)/(1/120))),h=Math.min(dt,.15)/steps;
    for(let i=this.list.length-1;i>=0;i--){const s=this.list[i],def=WEAPONS[s.weapon],shot=def.projectile!;let expired=false;
      for(let n=0;n<steps&&!expired;n++){
        s.age+=h;const delta=s.v.clone().multiplyScalar(h);delta.y-=.5*shot.gravity*h*h;s.v.y-=shot.gravity*h;
        const distance=delta.length(),direction=delta.clone().normalize();
        const hit=authority&&distance>.00001?this.g.physics.raycast(s.p,direction,distance,G.WORLD|G.HITBOX|G.PLAYER|G.BOT|G.VEHICLE,undefined,c=>{const o=this.g.physics.ownerOf(c);return o?.entity!==s.owner&&!(o?.vehicle?.driver===this.g.online?.entityId(s.owner));}):null;
        s.travel+=hit?s.p.distanceTo(hit.point):distance;
        if(hit){
          s.p.copy(hit.point).addScaledVector(hit.normal,.075);
          const armed=!s.dud&&s.travel>=(shot.armingDistance||0);
          if(armed){this.g.grenades.explodeAt(s.p,s.owner,this.g.online?.connected?this.g.online.victims:this.g.bots.victims,shot.radius,shot.damage,def.name);expired=true;}
          else{
            // Close-range direct hits can kill, but never generate splash through a wall.
            const target=hit.owner?.entity;
            if(!s.dud&&target?.alive&&target.takeDamage){const killed=target.takeDamage(shot.impactDamage||100,s.owner,'body',def.name,hit.point);this.g.grenades.onVictimHit?.(target,killed,s.owner);expired=true;}
            else{s.dud=true;s.v.reflect(hit.normal).multiplyScalar(.3);if(s.v.length()>1)this.g.audio.grenadeBounce(s.p,.35);if(s.v.length()<.7)s.v.set(0,0,0);}
          }
        }else s.p.add(delta);
        // The fuse is a lifetime cap, not an airburst timer. Impact rounds expire quietly.
        if(s.age>=shot.fuse||s.p.y< -15)expired=true;
      }
      if(expired){this.remove(i);continue;}s.mesh.position.copy(s.p);if(s.v.lengthSq()>.01)s.mesh.lookAt(s.p.clone().add(s.v));
    }
  }
  private remove(i:number){this.list[i].mesh.removeFromParent();this.list.splice(i,1);}
  clear(){while(this.list.length)this.remove(this.list.length-1);}
}
