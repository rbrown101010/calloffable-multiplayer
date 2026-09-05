import { SableMap } from './SableMap';
import { pbr } from './Materials';
import * as THREE from 'three';
import { G } from './Physics';
import type { Game } from './Game';
export type FieldState={id:number;readyAt:number};
type Item={id:number;kind:'health'|'ammo'|'launch';pos:THREE.Vector3;model:THREE.Group;marker:THREE.Object3D;readyAt:number;push?:THREE.Vector3};
const DOWN=new THREE.Vector3(0,-1,0);
/** Shared, respawning supplies plus reusable jump pads for reaching the upper routes. */
export class FieldItems {
  list:Item[]=[];private requested=new Map<number,number>();private launchAt=0;
  constructor(private g:Game){
    if(g.mapName==='RUST')return;
    const definitions:[Item['kind'],number,number,number,number?,number?][]=[['health',-4,-50,3.34],['ammo',2,-54,6.34],['health',-39,58,.2],['ammo',79,-23,5.65],['health',-73,42,0],['ammo',43,33,0],['ammo',94,94,0],['health',34,-92,0],['launch',22,-59,0,-7,-3],['launch',69,-17,0,8,-6],['launch',-69,56,0,-3,-9]];
    for(const [kind,x,z,y,dx,dz]of definitions){
      const ground=y||g.map.groundHeight(x,z),pos=new THREE.Vector3(x,ground,z),model=new THREE.Group();model.position.copy(pos);
      const dark=pbr('metal_plate_02',{color:0x626861,tile:.8,roughness:.8});
      const marker=new THREE.Group();model.add(marker);
      if(kind==='launch'){
        const deck=new THREE.Mesh(new THREE.BoxGeometry(2.7,.16,2.7),pbr('metal_grate_rusty',{tile:1.6,color:0x73736a}));deck.position.y=.18;marker.add(deck);
        for(const x of[-1.15,1.15])for(const z of[-1.15,1.15]){const jack=new THREE.Mesh(new THREE.CylinderGeometry(.13,.18,.22,8),dark);jack.position.set(x,.11,z);marker.add(jack);}
        const stripe=new THREE.MeshStandardMaterial({color:0xb99b4d,roughness:.9});
        for(const z of[-1.25,1.25]){const edge=new THREE.Mesh(new THREE.BoxGeometry(2.5,.025,.08),stripe);edge.position.set(0,.27,z);marker.add(edge);}
        for(const x of[-.22,.22]){const arrow=new THREE.Mesh(new THREE.BoxGeometry(.08,.018,.7),stripe);arrow.rotation.y=x<0?-.55:.55;arrow.position.set(x,.276,0);marker.add(arrow);}
      }else{
        const source=SableMap.scenery.get(kind==='ammo'?'old_military_crate':'wooden_military_crate');
        if(source){const crate=source.clone();for(const c of [...crate.children])if(c.name.endsWith('_b'))crate.remove(c);const bb=new THREE.Box3().setFromObject(crate),size=bb.getSize(new THREE.Vector3()),center=bb.getCenter(new THREE.Vector3());crate.position.sub(new THREE.Vector3(center.x,bb.min.y,center.z));const normal=new THREE.Group();normal.add(crate);normal.scale.setScalar(.65/size.y);marker.add(normal);}
        else{const crate=new THREE.Mesh(new THREE.BoxGeometry(1,.65,.6),dark);crate.position.y=.325;marker.add(crate);}
        if(kind==='health'){
          const patch=new THREE.Mesh(new THREE.BoxGeometry(.35,.28,.025),new THREE.MeshStandardMaterial({color:0x294f3d,roughness:1}));patch.position.set(0,.4,.34);marker.add(patch);
          const white=new THREE.MeshStandardMaterial({color:0xd3d1b8,roughness:1});for(const dims of[[.06,.2,.01],[.2,.06,.01]]){const cross=new THREE.Mesh(new THREE.BoxGeometry(...dims as [number,number,number]),white);cross.position.set(0,.4,.36);marker.add(cross);}
        }
      }
      marker.traverse((o:any)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      if(kind!=='launch')g.physics.addStaticBox(pos.clone().add(new THREE.Vector3(0,.08,0)),new THREE.Vector3(1.6,.16,1.6),undefined,G.WORLD,{surface:'metal'});
      g.scene.add(model);this.list.push({id:this.list.length,kind,pos,model,marker,readyAt:0,push:dx!==undefined?new THREE.Vector3(dx,17,dz):undefined});
    }
  }
  reset(){this.requested.clear();this.launchAt=0;for(const item of this.list)item.readyAt=0;}
  snapshot(){return this.list.filter(i=>i.kind!=='launch').map(i=>({id:i.id,readyAt:i.readyAt}));}
  apply(states:FieldState[]){for(const s of states||[])if(this.list[s.id]&&Number.isFinite(s.readyAt))this.list[s.id].readyAt=s.readyAt;}
  claim(who:string,id:number){const item=this.list[id],g=this.g,e=who===(g.online?.connected?g.online.id:'solo')?g.player:g.online?.entity(who);if(!item||item.kind==='launch'||!e?.alive||Date.now()<item.readyAt||e.pos.distanceTo(item.pos)>3)return false;if(item.kind==='health'&&e.health>=100)return false;item.readyAt=Date.now()+22000;if(item.kind==='health')e.health=Math.min(100,e.health+60);if(e===g.player)this.grant(id,e.health);else g.online.fieldGrant(who,id,e.health);return true;}
  grant(id:number,health:number){const item=this.list[id];if(!item)return;if(item.kind==='ammo')this.g.gunplay.refill();else this.g.player.health=health;this.g.hud.centerMsg(item.kind==='ammo'?'AMMUNITION RESUPPLIED':'MEDICAL SUPPLIES +60');this.g.audio.uiClick();}
  update(_dt:number,canControl:boolean){const g=this.g,p=g.player,now=Date.now();for(const item of this.list){
    const ready=now>=item.readyAt;item.marker.visible=ready;
    if(!canControl||p.mounted||!ready||p.pos.distanceTo(item.pos)>2.1)continue;
    if(item.kind==='launch'){if(now-this.launchAt<1600||!p.grounded)continue;this.launchAt=now;p.vel.copy(item.push!);p.grounded=false;p.airTime=.1;p.jumpCooldown=.5;g.hud.centerMsg('JUMP PAD');continue;}
    if(now-(this.requested.get(item.id)||0)<1400)continue;if(item.kind==='health'&&p.health>=100)continue;if(item.kind==='ammo'&&g.gunplay.slots.every(s=>s.reserve>=s.def.reserve))continue;
    this.requested.set(item.id,now);if(g.online?.connected)g.online.fieldClaim(item.id);else this.claim('solo',item.id);
  }}
}
