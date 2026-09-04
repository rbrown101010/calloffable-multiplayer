import * as THREE from 'three';
import type { Game } from './Game';
import { SoldierPuppet } from './Puppet';
import { ViewModel, cloneLoadedWeapon } from './Weapons';
import { WEAPONS } from './WeaponDefs';
import { el, lerp, wrapAngle } from './util';
import type { VehicleState } from './Vehicles';

const FRAME_LIMIT=64,SHOT_LIMIT=512,INTERVAL=.1,LOOKBACK=3,HOLD=.35;
type Pose={id:string;x:number;y:number;z:number;feet:number;yaw:number;pitch:number;speed:number;alive:boolean;crouch:boolean;riding:boolean;motorcycle:boolean;weapon:string;skin:number;ads:number;camera?:{p:number[];yaw:number;pitch:number}};
type Frame={t:number;poses:Pose[];vehicles:VehicleState[]};
type Shot={t:number;id:string;weapon:string};
type Death={killer:string;name:string;weapon:string;headshot:boolean;life:number;at:number};
type Clip={death:Death;frames:Frame[];shots:Shot[];start:number;end:number;started:number;index:number;actors:string[];shotIndex:number;hit:boolean};

/** A small local replay. No physics bodies, network messages, or authoritative state are rewound. */
export class DeathReplay {
  private frames:(Frame|undefined)[]=Array(FRAME_LIMIT);private frameNext=0;frameCount=0;
  private shots:(Shot|undefined)[]=Array(SHOT_LIMIT);private shotNext=0;shotCount=0;
  private viewFov=76;private playedLife=-1;private nextCapture=0;private pending:Death|null=null;private clip:Clip|null=null;
  private group=new THREE.Group();private ghosts:SoldierPuppet[]=[];private vm:ViewModel;
  private vehicleModels=new Map<number,THREE.Object3D>();private vehicleMap='';
  private models=new Map<string,THREE.Object3D>();private viewWeapon='';private ghostsFor:string[]=[];
  eye=new THREE.Vector3();private orientation=new THREE.Quaternion();private point=new THREE.Vector3();private riding=false;
  private rigPosition=new THREE.Vector3();private rigRotation=new THREE.Quaternion();private hidden:THREE.Object3D[]=[];
  get active(){return !!this.clip;}

  constructor(private g:Game){
    this.group.name='Death replay visuals';this.group.visible=false;g.scene.add(this.group);
    this.vm=new ViewModel(g.camera);this.vm.root.visible=false;
    el('death-replay-skip').onclick=()=>this.stop();
    el('death-replay-class').onclick=()=>{this.stop();g.openClassPicker();};
  }
  async preload(){
    // Reuse four visual actors: the victim plus the closest bystanders. No collision or AI copies.
    for(let i=0;i<4;i++){const p=await SoldierPuppet.create(this.g.scene);p.equip(i);await p.setWeapon(WEAPONS.scarh);this.group.add(p.model,p.gunPivot);p.setVisible(false);this.ghosts.push(p);}
  }
  id(entity:any){return this.g.online?.connected?this.g.online.entityId(entity):entity===this.g.player?'self':'bot-'+entity?.id;}
  recordShot(entity:any,weapon:string){
    if(this.g.params.has('nokillcam')||!entity||!WEAPONS[weapon])return;
    this.shots[this.shotNext]={t:this.g.time,id:this.id(entity),weapon};this.shotNext=(this.shotNext+1)%SHOT_LIMIT;this.shotCount=Math.min(SHOT_LIMIT,this.shotCount+1);
  }
  private ordered<T>(slots:(T|undefined)[],next:number,count:number):T[]{return Array.from({length:count},(_,i)=>slots[(next-count+i+slots.length)%slots.length]!);}
  capture(force=false){
    const g=this.g;if(g.params.has('nokillcam')||g.mapChanging||g.match.over||g.countdown>0||!['playing','paused'].includes(g.state))return;
    if(!force&&g.time<this.nextCapture)return;this.nextCapture=g.time+INTERVAL;
    const entities=[g.player,...g.bots.bots.filter(b=>b.alive),...(g.online?.connected?[...g.online.remotes.values()]:[])].slice(0,16);
    const vehicles=g.vehicles.snapshot();
    const poses=entities.map(e=>{const local=e===g.player,id=this.id(e),b=e as any;return{id,x:e.pos.x,y:e.pos.y,z:e.pos.z,feet:e.feetY,yaw:local?g.player.yaw+Math.PI:b.aimYaw,pitch:local?g.player.pitch:b.aimPitch,speed:local?g.player.speed:Math.hypot(b.vel.x,b.vel.z),alive:e.alive,crouch:local?g.player.crouching:b.crouch,riding:vehicles.some(v=>v.driver===id),motorcycle:g.vehicles.list.find(v=>v.driver===id)?.kind==='motorcycle',weapon:local?g.gunplay.def.id:b.def.id,skin:local?0:b.id%4,ads:local?g.player.ads:b.netADS||0,camera:g.killstreaks.cameraFor(id)||undefined};});
    this.frames[this.frameNext]={t:g.time,poses,vehicles};this.frameNext=(this.frameNext+1)%FRAME_LIMIT;this.frameCount=Math.min(FRAME_LIMIT,this.frameCount+1);
  }
  killedBy(killer:string,name:string,weapon:string,headshot:boolean,life=this.g.player.life){
    if(this.g.params.has('nokillcam')||killer===this.id(this.g.player)||life!==this.g.player.life||this.active||life===this.playedLife)return;
    this.pending={killer,name,weapon,headshot,life,at:this.g.time};
  }
  update(dt:number){
    const g=this.g;
    if(this.pending){
      const d=this.pending;
      if(g.player.life!==d.life||g.time-d.at>1||!['playing','paused','ended'].includes(g.state))this.pending=null;
      else if(!g.player.alive){this.pending=null;if(['playing','ended'].includes(g.state)&&el('class-picker').classList.contains('hidden')&&el('lobby').classList.contains('hidden'))this.start(d);}
    }
    const c=this.clip;if(!c)return;
    if(g.player.alive||g.player.life!==c.death.life||!['playing','ended'].includes(g.state)||g.mapChanging||!el('lobby').classList.contains('hidden')||!el('class-picker').classList.contains('hidden')){this.stop();return;}
    const elapsed=(performance.now()-c.started)/1000,t=c.start+elapsed;
    if(t>c.end+HOLD||g.input.hit('Enter')||g.input.hit('Space')||g.input.btnHit(0)){this.stop();return;}
    while(c.index<c.frames.length-2&&c.frames[c.index+1].t<t)c.index++;
    const a=c.frames[c.index],b=c.frames[Math.min(c.index+1,c.frames.length-1)],k=Math.min(1,Math.max(0,(t-a.t)/Math.max(.001,b.t-a.t)));
    const sample=(id:string):Pose|undefined=>{const x=a.poses.find(p=>p.id===id),y=b.poses.find(p=>p.id===id);if(!x)return y;if(!y)return x;return{...x,x:lerp(x.x,y.x,k),y:lerp(x.y,y.y,k),z:lerp(x.z,y.z,k),feet:lerp(x.feet,y.feet,k),yaw:x.yaw+wrapAngle(y.yaw-x.yaw)*k,pitch:lerp(x.pitch,y.pitch,k),ads:lerp(x.ads,y.ads,k),camera:x.camera&&y.camera?{p:x.camera.p.map((v,i)=>lerp(v,y.camera!.p[i],k)),yaw:x.camera.yaw+wrapAngle(y.camera.yaw-x.camera.yaw)*k,pitch:lerp(x.camera.pitch,y.camera.pitch,k)}:x.camera,alive:k>=1?y.alive:x.alive};};
    const killer=sample(c.death.killer);if(!killer){this.stop();return;}
    this.riding=killer.riding||!!killer.camera;this.viewFov=killer.camera?65:lerp(76,WEAPONS[killer.weapon]?.adsFov||60,killer.ads);
    el('death-replay').classList.toggle('scoped',!!WEAPONS[killer.weapon]?.scope&&killer.ads>.8);
    this.eye.set(killer.x,killer.feet+(killer.crouch?1.08:1.62),killer.z);
    if(killer.camera){this.eye.fromArray(killer.camera.p);this.orientation.setFromEuler(new THREE.Euler(killer.camera.pitch,killer.camera.yaw,0,'YXZ'));}
    else if(killer.riding){this.eye.addScaledVector(this.point.set(Math.sin(killer.yaw),0,Math.cos(killer.yaw)),-4.8);this.eye.y+=1.8;this.orientation.setFromEuler(new THREE.Euler(-.2,killer.yaw+Math.PI,0,'YXZ'));}
    else this.orientation.setFromEuler(new THREE.Euler(killer.pitch,killer.yaw+Math.PI,0,'YXZ'));
    if(killer.weapon!==this.viewWeapon){const def=WEAPONS[killer.weapon],model=def&&(this.models.get(def.id)||cloneLoadedWeapon(def));if(model){this.models.set(def.id,model);this.vm.setWeapon(def,model);this.vm.drawT=1;this.viewWeapon=killer.weapon;}}
    this.ghosts.forEach((p,i)=>{const id=c.actors[i],s=id&&sample(id);p.setVisible(!!s);if(!s)return;if(this.ghostsFor[i]!==id){p.setTint([0x76806a,0x9a957c,0x707c7f,0x94937b][s.skin]||0x76806a);this.ghostsFor[i]=id;}if(WEAPONS[s.weapon]&&p.def!==WEAPONS[s.weapon])void p.setWeapon(WEAPONS[s.weapon]);p.update(dt,{pos:this.point.set(s.x,s.y,s.z),feetY:s.feet,yaw:s.yaw,aimYaw:s.yaw,aimPitch:s.pitch,speed:s.speed,crouch:s.crouch,riding:s.riding,motorcycle:s.motorcycle,alive:s.alive,deathT:s.alive?0:Math.max(0,t-c.end)});});
    for(const v of b.vehicles){const model=this.vehicleModels.get(v.id);if(!model)continue;const previous=a.vehicles.find(x=>x.id===v.id)||v;model.position.set(lerp(previous.p[0],v.p[0],k),lerp(previous.p[1],v.p[1],k),lerp(previous.p[2],v.p[2],k));model.rotation.set(lerp(previous.pitch,v.pitch,k),previous.yaw+wrapAngle(v.yaw-previous.yaw)*k,lerp(previous.roll,v.roll,k),'YXZ');}
    // Never catch up a burst of old sounds after a slow frame. Only the killer's recent report is audible.
    let shot:Shot|undefined;while(c.shotIndex<c.shots.length&&c.shots[c.shotIndex].t<=t)shot=c.shots[c.shotIndex++];
    if(shot&&t-shot.t<.16){const def=WEAPONS[shot.weapon];this.vm.fire(def.viewKick);g.audio.replaySound(()=>g.audio.play(g.audio.pick(def.audio?.shot||def.sounds.shot),{vol:.65,bus:'gun'}));}
    this.vm.update(dt,{ads:killer.ads,sprinting:false,speed:killer.speed,grounded:true,crouching:killer.crouch,sliding:false,mouseDX:0,mouseDY:0,bobPhase:elapsed*8,time:elapsed,climbing:false,lowered:0});
    if(!c.hit&&t>=c.end){c.hit=true;el('death-replay').classList.add('confirmed');g.audio.replaySound(()=>g.audio.hitmarker(c.death.headshot));}
    el('death-replay-fill').style.width=Math.min(100,(t-c.start)/(c.end-c.start)*100)+'%';
    el('death-replay-time').textContent=g.match.over?'FINAL ELIMINATION · MATCH COMPLETE':'RESPAWNING IN '+Math.max(0,Math.ceil(g.respawnT))+'s';
  }
  private start(death:Death){
    this.capture(true);
    const frames=this.ordered(this.frames,this.frameNext,this.frameCount).filter(f=>f.t>=this.g.time-LOOKBACK&&f.poses.some(p=>p.id===death.killer));
    if(frames.length<3||frames.at(-1)!.t-frames[0].t<.2)return;
    const last=frames.at(-1)!,killer=last.poses.find(p=>p.id===death.killer)!;
    // Death is confirmed by the host event even if the latest pose arrived a frame earlier.
    const self=this.id(this.g.player);last.poses=last.poses.map(p=>p.id===self?{...p,alive:false}:p);
    const actors=[self,...last.poses.filter(p=>p.id!==self&&p.id!==death.killer).sort((a,b)=>Math.hypot(a.x-killer.x,a.z-killer.z)-Math.hypot(b.x-killer.x,b.z-killer.z)).map(p=>p.id)].slice(0,this.ghosts.length);
    const shots=this.ordered(this.shots,this.shotNext,this.shotCount).filter(s=>s.id===death.killer&&s.t>=frames[0].t&&s.t<=last.t);
    this.playedLife=death.life;this.clip={death,frames,shots,start:frames[0].t,end:last.t,started:performance.now(),index:0,actors,shotIndex:0,hit:false};
    if(this.vehicleMap!==this.g.mapId){for(const m of this.vehicleModels.values())this.group.remove(m);this.vehicleModels.clear();this.vehicleMap=this.g.mapId;for(const v of this.g.vehicles.list){const model=v.model.clone(true);this.group.add(model);this.vehicleModels.set(v.id,model);}}
    this.g.input.reset();this.g.audio.setReplayMode(true);this.g.vehicles.silence();
    el('death-replay').classList.remove('hidden','confirmed');el('death-replay-killer').textContent=death.name;el('death-replay-weapon').textContent=death.weapon+(death.headshot?' · HEADSHOT':'');el('death-replay-fill').style.width='0%';document.body.classList.add('replaying');
  }
  /** Temporarily switch only render transforms. Restore them synchronously before networking or physics can run. */
  beforeRender():null|(()=>void){
    if(!this.active)return null;
    const g=this.g,rig=g.player.rig,fov=g.camera.fov,vmVisible=g.vm.root.visible;
    this.rigPosition.copy(rig.position);this.rigRotation.copy(rig.quaternion);
    this.hidden=[];for(const object of g.scene.children)if(object.visible&&object!==g.map.group&&object!==rig&&object!==this.group&&!(object as THREE.Light).isLight){object.visible=false;this.hidden.push(object);}
    rig.position.copy(this.eye);rig.quaternion.copy(this.orientation);rig.updateMatrixWorld(true);g.camera.fov=this.viewFov;g.camera.updateProjectionMatrix();
    this.group.visible=true;g.vm.root.visible=false;this.vm.root.visible=!this.riding;
    return()=>{rig.position.copy(this.rigPosition);rig.quaternion.copy(this.rigRotation);g.camera.fov=fov;g.camera.updateProjectionMatrix();rig.updateMatrixWorld(true);for(const o of this.hidden)o.visible=true;this.hidden=[];this.group.visible=false;this.vm.root.visible=false;g.vm.root.visible=vmVisible;};
  }
  stop(){this.pending=null;if(!this.clip)return;this.clip=null;this.group.visible=false;this.vm.root.visible=false;this.g.audio.setReplayMode(false);document.body.classList.remove('replaying');el('death-replay').classList.add('hidden');this.g.input.reset();}
  reset(){this.stop();this.frames.fill(undefined);this.shots.fill(undefined);this.frameCount=this.shotCount=this.frameNext=this.shotNext=0;this.nextCapture=0;this.playedLife=-1;}
}
