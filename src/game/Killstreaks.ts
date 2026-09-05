import * as THREE from 'three';
import type { Game } from './Game';
import { G } from './Physics';
import { clamp, el } from './util';
import { WEAPONS } from './WeaponDefs';

export type RandomReward='airstrike'|'advanced-uav'|'resupply';
export type Support='precision'|'escort'|'bomber';
export type Reward='uav'|RandomReward|'chopper'|Support;
export type Skycraft={id:string;owner:string;kind:Support|'uav';start:number;end:number;p:number[];yaw:number;next:number};
export type Rewards={uav:boolean;random:RandomReward|null;chopper:boolean;radarUntil:number;precision:boolean;escort:boolean;bomber:boolean};
export type Copter={id:string;life:number;start:number;end:number;center:number[];yaw:number;pitch:number;heat:number;rockets:number;input?:{at:number;f:number;s:number;u:number}};
export type StreakState={rewards:Record<string,Rewards>;copters:Copter[];sky:Skycraft[]};
export const REWARD_NAMES:Record<Reward,string>={uav:'UAV',airstrike:'AIRSTRIKE','advanced-uav':'ADVANCED UAV',resupply:'RESUPPLY',chopper:'CHOPPER GUNNER',precision:'PRECISION STRIKE',escort:'ATTACK HELICOPTER',bomber:'STEALTH BOMBER'};
const RANDOM:RandomReward[]=['airstrike','advanced-uav','resupply'];
const empty=():Rewards=>({uav:false,random:null,chopper:false,radarUntil:0,precision:false,escort:false,bomber:false});

/** Rewards and cannon damage are authorized by the same host that owns kills. */
export class Killstreaks {
  state:StreakState={rewards:{},copters:[],sky:[]};
  private models=new Map<string,THREE.Group>();private lastFire=new Map<string,number>();private localFire=0;private lastRocket=new Map<string,number>();private lastAim=0;
  private activeId='';private yaw=0;private pitch=-.7;eye=new THREE.Vector3();private rotation=new THREE.Quaternion();
  private strikes:{at:number;pos:THREE.Vector3;owner:string}[]=[];
  private targeting=false;
  constructor(private g:Game){}
  private get self(){return this.g.online?.connected?this.g.online.id:'self';}
  private get authority(){return !this.g.online?.connected||this.g.online.isHost;}
  private entity(id:string):any{return this.g.online?.connected?this.g.online.entity(id):id==='self'?this.g.player:this.g.bots.bots.find(b=>'bot-'+b.id===id);}
  get mine(){return this.state.rewards[this.self]||empty();}
  get controlling(){return this.state.copters.some(c=>c.id===this.self&&c.end>Date.now())&&this.g.player.alive&&!this.g.match.over;}
  get radar(){return this.mine.radarUntil>Date.now();}
  snapshot():StreakState{return this.state;}
  apply(state:StreakState){if(state?.rewards&&Array.isArray(state.copters))this.state={...state,sky:state.sky||[]};}
  award(id:string,streak:number){
    if(!this.authority)return null;
    const inventory=this.state.rewards[id]??=empty();let reward:Reward|null=null;
    if(streak===3&&!inventory.uav){inventory.uav=true;reward='uav';}
    if(streak===5&&!inventory.random){inventory.random=RANDOM[Math.floor(Math.random()*RANDOM.length)];reward=inventory.random;}
    for(const [n,key] of [[6,'precision'],[7,'escort'],[8,'bomber']] as [number,Support][])if(streak===n&&!inventory[key]){inventory[key]=true;reward=key;}
    if(streak===9&&!inventory.chopper){inventory.chopper=true;reward='chopper';}
    return reward;
  }
  announce(reward:Reward){this.g.hud.streak(REWARD_NAMES[reward]+' READY · PRESS '+(reward==='uav'?'3':reward==='chopper'?'5':reward==='precision'?'6':reward==='escort'?'7':reward==='bomber'?'8':'4'));this.g.audio.streakEarned();}
  private request(reward:Reward,p?:number[],d?:number[]){
    const data={kind:'streak-use',reward,p,d};
    if(this.g.online?.connected)this.g.online.streakAction(data);else this.authorize(this.self,data);
  }
  authorize(id:string,data:any){
    const e=this.entity(id),r=this.state.rewards[id],now=Date.now();
    if(!this.authority||!e?.alive||!r||this.g.match.over||this.g.countdown>0||this.g.vehicles.list.some(v=>v.driver===id))return false;
    const reward=data.reward as Reward;
    if(reward==='chopper'){
      if(!r.chopper||this.state.copters.some(c=>c.id===id)||this.state.copters.length>=2)return false;
      const bound=this.g.map.bounds-5;
      const center=[clamp(e.pos.x,-bound,bound),52,clamp(e.pos.z,-bound,bound)];
      r.chopper=false;this.state.copters.push({id,life:e.life,start:now,end:now+35000,center,yaw:Math.PI/2,pitch:-1,heat:0,rockets:6});
    }else if(reward==='uav'){
      if(!r.uav)return false;r.uav=false;r.radarUntil=now+35000;this.addSky(id,'uav',e.pos,35000);
    }else if(['precision','escort','bomber'].includes(reward)){
      const key=reward as Support;if(!r[key])return false;r[key]=false;this.addSky(id,key,e.pos,key==='escort'?30000:12000);
    }else{
      if(!RANDOM.includes(reward as RandomReward)||r.random!==reward)return false;
      if(reward==='airstrike'){
        if(!validVector(data.p)||!validVector(data.d))return false;
        const p=new THREE.Vector3(...data.p as [number,number,number]),d=new THREE.Vector3(...data.d as [number,number,number]);d.y=0;d.normalize();
        if(Math.abs(p.x)>this.g.map.bounds+5||Math.abs(p.z)>this.g.map.bounds+5||p.y<-10||p.y>60||d.lengthSq()<.9)return false;
        for(let i=0;i<5;i++)this.strikes.push({at:now+2300+i*170,pos:p.clone().addScaledVector(d,(i-2)*7),owner:id});
      }else if(reward==='advanced-uav'){r.radarUntil=now+60000;this.addSky(id,'uav',e.pos,60000);}
      else if(reward==='resupply'){e.health=100;(e as any).nades=2;}
      r.random=null;
    }
    if(this.g.online?.connected)this.g.online.streakEvent({kind:'streak-used',to:id,reward});else this.used({to:id,reward});
    return true;
  }
  used(data:{to:string;reward:Reward}){
    if(data.to!==this.self)return;
    this.g.hud.centerMsg(REWARD_NAMES[data.reward]+' '+(data.reward==='airstrike'?'INBOUND':'ONLINE'));this.g.audio.uiClick();
    if(data.reward==='resupply'){this.g.gunplay.refill();this.g.gunplay.lethals=2;}
    if(data.reward==='airstrike')this.g.audio.jetFlyby();
  }
  private addSky(owner:string,kind:Skycraft['kind'],p:THREE.Vector3,duration:number){
    if(this.state.sky.length>=12)this.state.sky.shift();const now=Date.now();this.state.sky.push({id:owner+kind+now,owner,kind,start:now,end:now+duration,p:[p.x,kind==='escort'?48:75,p.z],yaw:Math.random()*Math.PI*2,next:now+1800});
    if(kind!=='uav')this.g.audio.jetFlyby();
  }
  position(c:Copter,_now=Date.now(),out=new THREE.Vector3()){return out.fromArray(c.center);}
  control(id:string,data:any){const c=this.state.copters.find(c=>c.id===id);if(!this.authority||!c||![data.f,data.s,data.u].every(Number.isFinite))return;this.aim(id,data.yaw,data.pitch);c.input={at:Date.now(),f:clamp(data.f,-1,1),s:clamp(data.s,-1,1),u:clamp(data.u,-1,1)};}
  cameraFor(id:string){const c=this.state.copters.find(c=>c.id===id);if(!c)return null;return{p:this.position(c).toArray(),yaw:id===this.self?this.yaw:c.yaw,pitch:id===this.self?this.pitch:c.pitch};}
  aim(id:string,yaw:number,pitch:number){const c=this.state.copters.find(c=>c.id===id);if(!this.authority||!c||![yaw,pitch].every(Number.isFinite))return;c.yaw=yaw;c.pitch=clamp(pitch,-1.48,-.12);}
  fire(id:string,data:{yaw:number;pitch:number;rocket?:boolean}){
    const c=this.state.copters.find(c=>c.id===id),e=this.entity(id),now=Date.now();
    if(!this.authority||!c||c.end<=now||!e?.alive||e.life!==c.life||(!data.rocket&&now-(this.lastFire.get(id)||0)<110)||![data.yaw,data.pitch].every(Number.isFinite))return;
    if(data.rocket){if(c.rockets<=0||now-(this.lastRocket.get(id)||0)<1200)return;c.rockets--;this.lastRocket.set(id,now);}else{if(c.heat>.88)return;c.heat=Math.min(1,c.heat+.11);}
    if(!data.rocket)this.lastFire.set(id,now);this.aim(id,data.yaw,data.pitch);
    const origin=this.position(c),dir=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(c.pitch,c.yaw,0,'YXZ'));
    const hit=this.g.physics.raycast(origin,dir,250,G.WORLD|G.HITBOX|G.PLAYER|G.VEHICLE,undefined,col=>this.g.physics.ownerOf(col)?.entity!==e);
    const end=hit?.point||origin.clone().addScaledVector(dir,250);
    if(hit)this.g.grenades.explodeAt(end.clone().addScaledVector(hit.normal,.18),e,this.g.online?.connected?this.g.online.victims:this.g.bots.victims,data.rocket?8:3.6,data.rocket?180:68,data.rocket?'CHOPPER ROCKET':'CHOPPER GUNNER');
    const event={kind:'copter-shot',id,p:origin.toArray(),end:end.toArray(),rocket:!!data.rocket};
    if(this.g.online?.connected)this.g.online.streakShot(event);else this.shot(event);
  }
  shot(data:{id:string;p:number[];end:number[]}){
    if(!validVector(data.p)||!validVector(data.end))return;
    const origin=new THREE.Vector3(...data.p as [number,number,number]),end=new THREE.Vector3(...data.end as [number,number,number]),owner=this.entity(data.id);if(!owner)return;
    const def=WEAPONS.m249,dir=end.clone().sub(origin).normalize();
    this.g.bullets.fire({...def,bulletSpeed:700,range:origin.distanceTo(end)},origin,dir,owner,{tracer:true});(this.g.bullets.list.at(-1) as any).visualOnly=true;
    this.g.effects.impact(end,new THREE.Vector3(0,1,0),'metal',dir);
    this.g.deathReplay.recordShot(owner,def.id);
    if(data.id===this.self)this.g.audio.play(this.g.audio.pick(def.audio!.shot),{vol:.5,bus:'gun'});else this.g.audio.play3D(def.sounds.far,origin,{vol:.65,ref:12});
  }
  exit(id=this.self){if(this.g.online?.connected&&!this.authority)this.g.online.streakAction({kind:'copter-exit'});else this.state.copters=this.state.copters.filter(c=>c.id!==id);}
  update(dt:number,canControl:boolean){
    const g=this.g,now=Date.now();
    if(this.authority){
      for(const c of this.state.copters){c.heat=Math.max(0,c.heat-dt*.28);const input=c.input;if(input&&now-input.at<350){const f=new THREE.Vector3(-Math.sin(c.yaw),0,-Math.cos(c.yaw)),r=new THREE.Vector3(Math.cos(c.yaw),0,-Math.sin(c.yaw));const move=f.multiplyScalar(input.f).addScaledVector(r,input.s);if(move.length()>1)move.normalize();c.center[0]=clamp(c.center[0]+move.x*dt*22,-g.map.bounds+5,g.map.bounds-5);c.center[2]=clamp(c.center[2]+move.z*dt*22,-g.map.bounds+5,g.map.bounds-5);c.center[1]=clamp(c.center[1]+input.u*dt*12,42,95);}}
      this.updateSupport(now);
      this.state.copters=this.state.copters.filter(c=>c.end>now&&this.entity(c.id)?.alive&&this.entity(c.id)?.life===c.life&&!g.match.over);
      for(let i=this.strikes.length-1;i>=0;i--)if(this.strikes[i].at<=now){const s=this.strikes.splice(i,1)[0],owner=this.entity(s.owner);if(!owner||g.match.over)continue;const down=g.physics.raycast(s.pos.clone().add(new THREE.Vector3(0,55,0)),new THREE.Vector3(0,-1,0),100,G.WORLD);if(down)g.grenades.explodeAt(down.point.clone().add(new THREE.Vector3(0,.2,0)),owner,g.online?.connected?g.online.victims:g.bots.victims,9.5,200,'AIRSTRIKE');}
    }
    this.updateModels(now);
    const c=this.state.copters.find(c=>c.id===this.self);
    const active=!!c&&this.controlling;
    el('chopper-view').classList.toggle('hidden',!active||g.state!=='playing');document.body.classList.toggle('gunning',active&&g.state==='playing');
    if(active&&c){
      if(this.activeId!==String(c.start)){this.activeId=String(c.start);this.yaw=c.yaw;this.pitch=c.pitch;g.input.reset();this.targeting=false;g.airTargeting=false;g.vehicles.silence();}
      if(canControl&&(g.input.locked||g.input.forceLocked)){this.yaw-=g.input.mouseDX*.002*g.settings.sens;this.pitch=clamp(this.pitch-g.input.mouseDY*.002*g.settings.sens,-1.48,-.12);}
      this.position(c,now,this.eye);this.rotation.setFromEuler(new THREE.Euler(this.pitch,this.yaw,0,'YXZ'));
      if(canControl&&g.input.hit('KeyE'))this.exit();
      if(canControl&&now-this.lastAim>100){this.lastAim=now;if(g.online?.connected)g.online.streakAction({kind:'copter-control',yaw:this.yaw,pitch:this.pitch,f:Number(g.input.down('KeyW'))-Number(g.input.down('KeyS')),s:Number(g.input.down('KeyD'))-Number(g.input.down('KeyA')),u:Number(g.input.down('Space'))-Number(g.input.down('ControlLeft'))});else this.control(this.self,{yaw:this.yaw,pitch:this.pitch,f:Number(g.input.down('KeyW'))-Number(g.input.down('KeyS')),s:Number(g.input.down('KeyD'))-Number(g.input.down('KeyA')),u:Number(g.input.down('Space'))-Number(g.input.down('ControlLeft'))});}
      if(canControl&&(g.input.btn(0)||g.input.down('KeyF'))&&now-this.localFire>125){this.localFire=now;if(g.online?.connected)g.online.streakAction({kind:'copter-fire',yaw:this.yaw,pitch:this.pitch});else this.fire(this.self,{yaw:this.yaw,pitch:this.pitch});}
      if(canControl&&g.input.btnHit(2)){const data={kind:'copter-fire',yaw:this.yaw,pitch:this.pitch,rocket:true};if(g.online?.connected)g.online.streakAction(data);else this.fire(this.self,data);}
      el('chopper-time').textContent=Math.ceil((c.end-now)/1000)+'s · '+c.rockets+' ROCKETS · HEAT '+Math.round(c.heat*100)+'%';
    }else{
      this.activeId='';
      if(canControl){
        for(const [key,reward]of [['Digit6','precision'],['Digit7','escort'],['Digit8','bomber']] as [string,Support][])if(g.input.hit(key)&&this.mine[reward])this.request(reward);
        if(g.input.hit('Digit3')&&this.mine.uav)this.request('uav');
        if(g.input.hit('Digit5')&&this.mine.chopper)this.request('chopper');
        if(g.input.hit('Digit4')){if(this.mine.random==='airstrike')this.targeting=!this.targeting;else if(this.mine.random)this.request(this.mine.random);}
        if(this.targeting&&(g.input.btnHit(0)||g.input.hit('KeyF'))){const hit=g.physics.raycast(g.player.eyePos,g.player.forward,250,G.WORLD);if(hit){this.request('airstrike',hit.point.toArray(),g.player.flatForward.toArray());this.targeting=false;}else g.hud.centerMsg('AIM AT THE GROUND');}
      }else this.targeting=false;
    }
    g.airTargeting=this.targeting;g.gunplay.blockFire=active||this.targeting;
    g.uavUntil=this.radar?g.time+1:-1;
    g.hud.setStreaks(g.player.streak,this.radar?'active':this.mine.uav?'ready':'locked',this.targeting?'active':this.mine.random?'ready':'locked',active?'active':this.mine.chopper?'ready':'locked',this.mine.random?REWARD_NAMES[this.mine.random]:'RANDOM REWARD',[this.mine.precision,this.mine.escort,this.mine.bomber]);
    if(this.targeting)g.hud.hint('AIRSTRIKE · CLICK / F TO MARK · 4 TO CANCEL');
    void dt;
  }
  private updateSupport(now:number){
    this.state.sky=this.state.sky.filter(s=>s.end>now&&!this.g.match.over);
    for(const s of this.state.sky){if(s.kind==='uav'||now<s.next)continue;const owner=this.entity(s.owner);if(!owner)continue;
      const victims=this.g.online?.connected?this.g.online.victims:this.g.bots.victims;
      const targets=victims.filter(v=>v.alive&&v.entity!==owner).sort((a,b)=>a.pos.distanceToSquared(new THREE.Vector3(...s.p as [number,number,number]))-b.pos.distanceToSquared(new THREE.Vector3(...s.p as [number,number,number])));
      if(s.kind==='escort'){s.next=now+1000;const target=targets.find(t=>this.g.physics.clearLine(new THREE.Vector3(...s.p as [number,number,number]),t.pos));if(target)this.g.grenades.explodeAt(target.pos.clone(),owner,victims,2.3,38,'ATTACK HELICOPTER');}
      else {s.next=now+(s.kind==='precision'?650:380);const target=targets[0];const along=(now-s.start)/1000*9-50;const pos=s.kind==='precision'&&target?target.pos.clone():new THREE.Vector3(s.p[0]+Math.sin(s.yaw)*along,80,s.p[2]+Math.cos(s.yaw)*along);const down=this.g.physics.raycast(pos.clone().setY(100),new THREE.Vector3(0,-1,0),120,G.WORLD);if(down)this.g.grenades.explodeAt(down.point.add(new THREE.Vector3(0,.25,0)),owner,victims,s.kind==='bomber'?10:6,s.kind==='bomber'?200:120,s.kind==='bomber'?'STEALTH BOMBER':'PRECISION AIRSTRIKE');}
    }
  }
  private updateModels(now:number){
    const ids=new Set([...this.state.copters.map(c=>c.id),...this.state.sky.map(s=>s.id)]);for(const [id,m]of this.models)if(!ids.has(id)){disposeCopter(m);this.models.delete(id);}
    for(const c of this.state.copters){let model=this.models.get(c.id);if(!model){model=makeCopter();this.models.set(c.id,model);this.g.scene.add(model);}model.visible=true;this.position(c,now,model.position);model.rotation.y=c.yaw;model.getObjectByName('rotor')!.rotation.y=now*.035;}
    for(const s of this.state.sky){let model=this.models.get(s.id);if(!model){model=s.kind==='escort'?makeCopter():makeJet(s.kind==='bomber');if(s.kind==='uav')model.scale.setScalar(.6);this.models.set(s.id,model);this.g.scene.add(model);}const t=(now-s.start)/1000;if(s.kind==='escort'||s.kind==='uav'){const a=t*.16;model.position.set(s.p[0]+Math.cos(a)*24,s.p[1],s.p[2]+Math.sin(a)*24);model.rotation.y=-a;const rotor=model.getObjectByName('rotor');if(rotor)rotor.rotation.y=now*.035;}else{const d=(t/12-.5)*this.g.map.bounds*2.6;model.position.set(s.p[0]+Math.sin(s.yaw)*d,s.p[1],s.p[2]+Math.cos(s.yaw)*d);model.rotation.y=s.yaw+Math.PI;}}
  }
  beforeRender(){
    if(!this.controlling||this.g.state!=='playing')return null;
    const g=this.g,rig=g.player.rig,pos=rig.position.clone(),q=rig.quaternion.clone(),fov=g.camera.fov,visible=g.vm.root.visible,model=this.models.get(this.self);
    rig.position.copy(this.eye);rig.quaternion.copy(this.rotation);rig.updateMatrixWorld(true);g.camera.fov=65;g.camera.updateProjectionMatrix();g.vm.root.visible=false;if(model)model.visible=false;
    return()=>{rig.position.copy(pos);rig.quaternion.copy(q);rig.updateMatrixWorld(true);g.camera.fov=fov;g.camera.updateProjectionMatrix();g.vm.root.visible=visible;if(model)model.visible=true;};
  }
  reset(){this.state={rewards:{},copters:[],sky:[]};this.strikes=[];this.lastFire.clear();this.targeting=false;this.activeId='';for(const m of this.models.values())disposeCopter(m);this.models.clear();el('chopper-view').classList.add('hidden');document.body.classList.remove('gunning');}
}
function validVector(v:any):v is number[]{return Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);}
function makeCopter(){
  const group=new THREE.Group(),body=new THREE.MeshStandardMaterial({color:0x29312b,roughness:.65,metalness:.55}),glass=new THREE.MeshStandardMaterial({color:0x172c37,roughness:.2,metalness:.8});
  const box=(x:number,y:number,z:number,px:number,py:number,pz:number,mat=body)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(x,y,z),mat);m.position.set(px,py,pz);group.add(m);return m;};
  const hull=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),body);hull.scale.set(1.1,1.1,3);group.add(hull);box(1.55,.8,1.7,0,.3,-1.8,glass);box(.3,.4,5,0,.3,4.5);box(.15,1.8,1,0,1.1,6.5);box(4,.12,.8,0,.2,4.8);
  box(.15,.9,.15,0,1.5,0);const rotor=box(12,.06,.16,0,2,0);rotor.name='rotor';const cross=new THREE.Mesh(new THREE.BoxGeometry(.16,.06,12),body);rotor.add(cross);
  for(const x of[-1.2,1.2]){box(.1,.7,.1,x,-1,1);box(.1,.7,.1,x,-1,-1);box(.15,.15,4.5,x,-1.4,0);}box(.2,.2,1.6,0,-.8,-2.8);group.name='CHOPPER GUNNER';return group;
}

function disposeCopter(model:THREE.Group){model.removeFromParent();const mats=new Set<THREE.Material>();model.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;m.geometry.dispose();for(const mat of Array.isArray(m.material)?m.material:[m.material])mats.add(mat);});for(const m of mats)m.dispose();}

function makeJet(bomber:boolean){const g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:bomber?0x222a30:0x849497,metalness:.6,roughness:.5});const body=new THREE.Mesh(new THREE.ConeGeometry(.8,9,8).rotateX(-Math.PI/2),mat);g.add(body);const wing=new THREE.Mesh(new THREE.BoxGeometry(bomber?20:12,.15,3),mat);wing.rotation.y=.12;g.add(wing);const tail=new THREE.Mesh(new THREE.BoxGeometry(4,.12,1.5),mat);tail.position.z=3;g.add(tail);const fin=new THREE.Mesh(new THREE.BoxGeometry(.1,1.8,1.5),mat);fin.position.set(0,.8,3);g.add(fin);return g;}
