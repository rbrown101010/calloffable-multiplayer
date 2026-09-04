import * as THREE from 'three';
import { G } from './Physics';
import type { Game } from './Game';
export type FieldState={id:number;readyAt:number};
type Item={id:number;kind:'health'|'ammo'|'launch';pos:THREE.Vector3;model:THREE.Group;marker:THREE.Mesh;readyAt:number;push?:THREE.Vector3};
const DOWN=new THREE.Vector3(0,-1,0);
/** Shared, respawning supplies plus reusable jump pads for reaching the upper routes. */
export class FieldItems {
  list:Item[]=[];private requested=new Map<number,number>();private launchAt=0;
  constructor(private g:Game){
    if(g.mapName==='RUST')return;
    const definitions:[Item['kind'],number,number,number,number?,number?][]=[['health',-4,-50,3.34],['ammo',2,-54,6.34],['health',-39,58,.2],['ammo',79,-23,5.65],['health',-73,42,0],['ammo',43,33,0],['ammo',94,94,0],['health',34,-92,0],['launch',22,-59,0,-7,-3],['launch',69,-17,0,8,-6],['launch',-69,56,0,-3,-9]];
    for(const [kind,x,z,y,dx,dz]of definitions){
      const ground=y||g.map.groundHeight(x,z),pos=new THREE.Vector3(x,ground,z),model=new THREE.Group();model.position.copy(pos);
      const color=kind==='health'?0x5ee2a2:kind==='ammo'?0xf5b34a:0x69d7ed;
      const paint=new THREE.MeshStandardMaterial({color,metalness:.45,roughness:.5,emissive:color,emissiveIntensity:.18});
      const dark=new THREE.MeshStandardMaterial({color:0x263338,metalness:.6,roughness:.6});
      const base=new THREE.Mesh(new THREE.CylinderGeometry(kind==='launch'?1.55:.78,kind==='launch'?1.7:.9,.16,24),dark);base.position.y=.08;base.receiveShadow=true;model.add(base);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(kind==='launch'?1.38:.7,.045,5,24),paint);ring.rotation.x=Math.PI/2;ring.position.y=.18;model.add(ring);
      const marker=new THREE.Mesh(kind==='launch'?new THREE.ConeGeometry(.42,.6,3):new THREE.BoxGeometry(.85,.55,.57),paint);marker.position.y=kind==='launch'?.3:.65;model.add(marker);
      if(kind==='health')for(const scale of [[.13,.4,.02],[.4,.13,.02]]){const cross=new THREE.Mesh(new THREE.BoxGeometry(...scale as [number,number,number]),new THREE.MeshBasicMaterial({color:0xeafdf1}));cross.position.set(0,0,.295);marker.add(cross);}
      if(kind==='ammo')for(let i=0;i<3;i++){const bullet=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.3,6),dark);bullet.position.set(-.17+i*.17,0,.3);marker.add(bullet);}
      if(kind!=='launch')g.physics.addStaticBox(pos.clone().add(new THREE.Vector3(0,.08,0)),new THREE.Vector3(1.6,.16,1.6),undefined,G.WORLD,{surface:'metal'});
      g.scene.add(model);this.list.push({id:this.list.length,kind,pos,model,marker,readyAt:0,push:dx!==undefined?new THREE.Vector3(dx,17,dz):undefined});
    }
  }
  reset(){this.requested.clear();this.launchAt=0;for(const item of this.list)item.readyAt=0;}
  snapshot(){return this.list.filter(i=>i.kind!=='launch').map(i=>({id:i.id,readyAt:i.readyAt}));}
  apply(states:FieldState[]){for(const s of states||[])if(this.list[s.id]&&Number.isFinite(s.readyAt))this.list[s.id].readyAt=s.readyAt;}
  claim(who:string,id:number){const item=this.list[id],g=this.g,e=who===(g.online?.connected?g.online.id:'solo')?g.player:g.online?.entity(who);if(!item||item.kind==='launch'||!e?.alive||Date.now()<item.readyAt||e.pos.distanceTo(item.pos)>3)return false;if(item.kind==='health'&&e.health>=100)return false;item.readyAt=Date.now()+22000;if(item.kind==='health')e.health=Math.min(100,e.health+60);if(e===g.player)this.grant(id,e.health);else g.online.fieldGrant(who,id,e.health);return true;}
  grant(id:number,health:number){const item=this.list[id];if(!item)return;if(item.kind==='ammo')this.g.gunplay.refill();else this.g.player.health=health;this.g.hud.centerMsg(item.kind==='ammo'?'AMMUNITION RESUPPLIED':'MEDICAL SUPPLIES +60');this.g.audio.uiClick();}
  update(dt:number,canControl:boolean){const g=this.g,p=g.player,now=Date.now();for(const item of this.list){
    const ready=now>=item.readyAt;item.marker.visible=ready;item.marker.rotation.y+=dt*(item.kind==='launch'?1:.45);item.marker.position.y=(item.kind==='launch'?.4:.65)+Math.sin(g.time*2+item.id)*.055;
    if(!canControl||p.mounted||!ready||p.pos.distanceTo(item.pos)>2.1)continue;
    if(item.kind==='launch'){if(now-this.launchAt<1600||!p.grounded)continue;this.launchAt=now;p.vel.copy(item.push!);p.grounded=false;p.airTime=.1;p.jumpCooldown=.5;g.hud.centerMsg('JUMP PAD');continue;}
    if(now-(this.requested.get(item.id)||0)<1400)continue;if(item.kind==='health'&&p.health>=100)continue;if(item.kind==='ammo'&&g.gunplay.slots.every(s=>s.reserve>=s.def.reserve))continue;
    this.requested.set(item.id,now);if(g.online?.connected)g.online.fieldClaim(item.id);else this.claim('solo',item.id);
  }}
}
