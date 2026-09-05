import * as THREE from 'three';
import type { Game } from './Game';
import { pbr } from './Materials';
import { clamp } from './util';
export type ZipRide={who:string;line:number;from:number;start:number};
export const ZIP_LINES=[{name:'CENTRAL ↔ FREIGHT',a:[12,34.275,9],b:[82,5.64,-22],speed:22}] as const;
/** The host grants rides; every peer evaluates the same cable at the same timestamp. */
export class Ziplines {
  group=new THREE.Group();rides=new Map<string,ZipRide>();private lastAction=0;private cancelled='';private wasRiding=false;
  private hint:HTMLElement;private trolley=new THREE.Group();
  constructor(private g:Game){
    this.hint=document.getElementById('zipline-hint')||Object.assign(document.createElement('div'),{id:'zipline-hint'});if(!this.hint.parentElement)document.body.append(this.hint);this.hint.classList.add('hidden');
    if(g.mapName==='RUST')return;
    const steel=pbr('metal_plate_02',{color:0x646b67,roughness:.7,tile:.7}),rubber=new THREE.MeshStandardMaterial({color:0x171b1b,roughness:.8});
    for(const [line,l]of ZIP_LINES.entries()){
      const points=Array.from({length:65},(_,i)=>this.point(line,i/64).add(new THREE.Vector3(0,2.5,0)));
      const cable=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),64,.035,5,false),rubber);this.group.add(cable);
      for(const end of[l.a,l.b]){
        for(const x of[-.75,.75]){const m=new THREE.Mesh(new THREE.CylinderGeometry(.075,.095,3.05,8),steel);m.position.set(end[0]+x,end[1]+1.525,end[2]);m.castShadow=true;this.group.add(m);}
        const beam=new THREE.Mesh(new THREE.BoxGeometry(1.8,.17,.2),steel);beam.position.set(end[0],end[1]+2.95,end[2]);this.group.add(beam);
        const motor=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.3,12).rotateX(Math.PI/2),steel);motor.position.set(end[0]+.55,end[1]+2.75,end[2]);this.group.add(motor);
        const plate=new THREE.Mesh(new THREE.BoxGeometry(.6,.3,.045),steel);plate.position.set(end[0]+.76,end[1]+1.45,end[2]+.09);this.group.add(plate);
      }
    }
    const grip=new THREE.Mesh(new THREE.BoxGeometry(.55,.06,.07),rubber);this.trolley.add(grip);const shank=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.42,8),steel);shank.position.y=.2;this.trolley.add(shank);this.group.add(this.trolley);this.trolley.visible=false;g.scene.add(this.group);
  }
  get self(){return this.g.online?.connected?this.g.online.id:'solo';}
  get current(){return this.rides.get(this.self);}
  get active(){return !!this.current;}
  private key(r:ZipRide){return `${r.who}:${r.start}`;}
  point(line:number,t:number){const l=ZIP_LINES[line];const p=new THREE.Vector3().fromArray(l.a).lerp(new THREE.Vector3().fromArray(l.b),t);const u=clamp((t-.05)/.95,0,1);p.y=l.a[1]+(l.b[1]-l.a[1])*(u*u*(3-2*u))-Math.sin(u*Math.PI)**2*1.25;return p;}
  duration(r:ZipRide){const l=ZIP_LINES[r.line];return new THREE.Vector3().fromArray(l.a).distanceTo(new THREE.Vector3().fromArray(l.b))/l.speed*1000;}
  progress(r:ZipRide,now=Date.now()){return clamp((now-r.start)/this.duration(r),0,1);}
  position(r:ZipRide){const t=this.progress(r);return this.point(r.line,r.from===0?t:1-t);}
  snapshot(){return [...this.rides.values()];}
  apply(states:ZipRide[]){const old=this.current;this.rides.clear();for(const r of (states||[]).slice(0,16))if(ZIP_LINES[r.line]&&(r.from===0||r.from===1)&&Number.isFinite(r.start)&&typeof r.who==='string'&&this.key(r)!==this.cancelled)this.rides.set(r.who,r);if(old&&!this.current)this.finishLocal(old,false);}
  authorize(who:string,line:number,from:number,action:'enter'|'exit'){
    if(action==='exit'){this.rides.delete(who);return true;}
    const l=ZIP_LINES[line],e=who===this.self?this.g.player:this.g.online?.entity(who);if(this.g.mapName==='RUST'||!l||![0,1].includes(from)||!e?.alive||this.rides.has(who)||this.g.vehicles.list.some(v=>v.driver===who)||this.g.killstreaks.state.copters.some(c=>c.id===(who==='solo'?'self':who)&&c.end>Date.now()))return false;
    const end=new THREE.Vector3().fromArray(from?l.b:l.a),feet=new THREE.Vector3(e.pos.x,e.feetY,e.pos.z);
    if(feet.distanceTo(end)>2.7)return false;
    this.rides.set(who,{who,line,from,start:Date.now()+160});return true;
  }
  private action(line:number,from:number,action:'enter'|'exit'){
    if(Date.now()-this.lastAction<450)return;this.lastAction=Date.now();
    if(action==='exit'&&this.current){const ride=this.current;this.cancelled=this.key(ride);this.rides.delete(this.self);this.finishLocal(ride,true);}
    if(this.g.online?.connected)this.g.online.ziplineAction(line,from,action);else this.authorize(this.self,line,from,action);
  }
  release(who:string){const r=this.rides.get(who);this.rides.delete(who);if(r&&who===this.self)this.finishLocal(r,false);}
  reset(){this.rides.clear();this.cancelled='';this.wasRiding=false;this.trolley.visible=false;this.g.vm.root.visible=this.g.player.alive;this.hint.classList.add('hidden');}
  private finishLocal(r:ZipRide,jump:boolean){
    const p=this.g.player;if(!p.alive)return;
    if(this.progress(r)>=.98)p.teleport(this.point(r.line,r.from?0:1));
    p.grounded=false;p.vel.set(0,jump?4:0,0);p.jumpCooldown=.4;p.ladderExitT=.6;this.wasRiding=false;this.trolley.visible=false;this.g.vm.root.visible=p.alive;
  }
  update(canControl:boolean){
    const g=this.g,p=g.player,authority=!g.online?.connected||g.online.isHost;
    for(const [id,r]of this.rides){const e=id===this.self?p:g.online?.entity(id);if(!e?.alive||g.match.over||(authority&&id!==this.self&&!g.online?.peers.has(id))){this.release(id);continue;}if(this.progress(r)>=1){if(id===this.self)this.finishLocal(r,false);this.rides.delete(id);}}
    this.hint.classList.add('hidden');
    const r=this.current;if(r){
      if(canControl&&(g.input.pressed.has('KeyE')||g.input.pressed.has('Space'))){this.action(r.line,r.from,'exit');g.input.pressed.delete('KeyE');g.input.pressed.delete('Space');return;}
      this.hint.textContent='ZIP LINE  ·  SPACE / E TO DROP';this.hint.classList.remove('hidden');return;
    }
    if(!canControl||g.mapName==='RUST'||p.mounted)return;
    const feet=new THREE.Vector3(p.pos.x,p.feetY,p.pos.z);
    for(const [line,l]of ZIP_LINES.entries())for(const from of[0,1])if(feet.distanceTo(new THREE.Vector3().fromArray(from?l.b:l.a))<2.5){this.hint.textContent='E  ·  ZIP LINE TO '+(from?'CENTRAL ROOF':'FREIGHT OVERLOOK');this.hint.classList.remove('hidden');if(g.input.pressed.has('KeyE')){this.action(line,from,'enter');g.input.pressed.delete('KeyE');}return;}
  }
  /** Apply after character movement so the rider stays attached while retaining mouse look. */
  carry(){const r=this.current;if(!r){this.trolley.visible=false;return;}const p=this.g.player;
    if(!this.wasRiding){p.crouching=false;p.sliding=false;p.climbing=null;p.collider.setHalfHeight(.54);this.wasRiding=true;this.g.audio.uiClick();}
    const feet=this.position(r);p.pos.copy(feet).add(new THREE.Vector3(0,.9,0));p.vel.set(0,0,0);p.speed=0;p.grounded=false;this.g.vm.root.visible=false;p.ads=0;p.adsBlend=0;p.sprinting=false;p.body.setTranslation(p.pos,true);p.body.setNextKinematicTranslation(p.pos);p.updateRig(0);
    this.trolley.position.copy(feet).add(new THREE.Vector3(0,2.1,0));this.trolley.visible=true;
  }
}
