import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G, cg } from './Physics';
import { clamp, damp, el, wrapAngle } from './util';
import type { Game } from './Game';

export type VehicleState = { id:number; p:number[]; yaw:number; pitch:number; roll:number; speed:number; vy:number; driver:string; grounded:boolean };
export const VEHICLE_WEAPON='KESTREL ATV';
// Walking-speed bumps are harmless; a direct 45 km/h hit defeats a full-health operator.
const IMPACT_MIN_SPEED=4,IMPACT_LETHAL_SPEED=12.5;
export type ATV = { id:number; pos:THREE.Vector3; spawn:THREE.Vector3; spawnYaw:number; yaw:number; pitch:number; roll:number; speed:number; vy:number; driver:string; grounded:boolean; model:THREE.Group; wheels:THREE.Group[]; front:THREE.Group[]; body:RAPIER.RigidBody; collider:RAPIER.Collider; target?:VehicleState; lastPacket:number; abandoned:number; steer:number; boost:number; boostLocked:boolean };
const DOWN=new THREE.Vector3(0,-1,0),UP=new THREE.Vector3(0,1,0);
const paint=new THREE.MeshStandardMaterial({color:0x78836b,metalness:.48,roughness:.5});
const metal=new THREE.MeshStandardMaterial({color:0x242c2d,metalness:.72,roughness:.4});
const rubber=new THREE.MeshStandardMaterial({color:0x151a19,roughness:.97});
const amber=new THREE.MeshStandardMaterial({color:0xefb34e,metalness:.4,roughness:.3});
const lamp=new THREE.MeshStandardMaterial({color:0xffefcb,emissive:0xffd17b,emissiveIntensity:2.4});
const tail=new THREE.MeshStandardMaterial({color:0x9d3127,emissive:0xff3020,emissiveIntensity:1.2});
const box=new THREE.BoxGeometry(1,1,1), tire=new THREE.CylinderGeometry(.42,.42,.32,16).rotateZ(Math.PI/2), hub=new THREE.CylinderGeometry(.21,.21,.335,10).rotateZ(Math.PI/2);

/** Responsive local driving; the session host grants seats and validates/relays driver transforms. */
export class Vehicles {
  list:ATV[]=[];
  private engine?: {osc:OscillatorNode;harmonic:OscillatorNode;gain:GainNode;filter:BiquadFilterNode};
  private previous=-1;private actionAt=0;private cameraPos=new THREE.Vector3();private orbit=0;private elevation=.27;private lastHud='';
  private contacts=new Map<number,Map<any,{pass:boolean}>>();
  constructor(private g:Game){
    if(g.mapName==='RUST')return;
    for(const [x,z,yaw]of [[45,29,0],[-75,31,Math.PI/2],[49,-96,Math.PI],[92,89,Math.PI/2],[-102,100,0],[19,34,Math.PI]])this.create(x,z,yaw);
  }
  get self(){return this.g.online?.connected?this.g.online.id:'solo';}
  get current(){return this.list.find(v=>v.driver===this.self);}
  get mounted(){return !!this.current;}
  private create(x:number,z:number,yaw:number){
    const model=new THREE.Group(),wheels:THREE.Group[]=[],front:THREE.Group[]=[];
    const part=(mat:THREE.Material,s:number[],p:number[],rot:number[]=[])=>{const m=new THREE.Mesh(box,mat);m.scale.set(...s as [number,number,number]);m.position.set(...p as [number,number,number]);if(rot.length)m.rotation.set(...rot as [number,number,number]);m.castShadow=true;m.receiveShadow=true;model.add(m);return m;};
    part(metal,[1.12,.22,2.05],[0,-.04,.04]);part(paint,[.72,.42,.78],[0,.19,-.56],[.12,0,0]);
    part(rubber,[.59,.16,1.04],[0,.36,.37]);part(metal,[.66,.18,.58],[0,.14,.66]);
    for(const side of [-1,1]){
      part(paint,[.42,.13,.82],[side*.58,.12,-.84],[0,0,side*-.13]);part(paint,[.4,.12,.82],[side*.58,.17,.9],[0,0,side*.12]);
      part(metal,[.18,.07,1],[side*.66,-.04,.22]);part(amber,[.19,.065,.57],[side*.68,0,.25]);
      part(lamp,[.23,.12,.06],[side*.27,.26,-1.01]);part(tail,[.17,.08,.06],[side*.38,.24,1.17]);
      part(metal,[.08,.14,2.38],[side*.44,-.02,.05]);
    }
    part(metal,[1.36,.1,.1],[0,-.04,-1.3]);part(metal,[1.3,.1,.1],[0,-.04,1.3]);
    part(metal,[.09,.59,.09],[0,.496,-.347],[.6,0,0]);part(metal,[.91,.055,.055],[0,.74,-.18]);
    for(const side of [-1,1])part(rubber,[.2,.075,.09],[side*.38,.74,-.18]);
    part(metal,[.73,.05,.63],[0,.34,1.04]);
    for(const xw of [-.72,.72])for(const zw of [-.87,.9]){
      const pivot=new THREE.Group();pivot.position.set(xw,-.24,zw);model.add(pivot);if(zw<0)front.push(pivot);
      const wheel=new THREE.Group();pivot.add(wheel);const t=new THREE.Mesh(tire,rubber),h=new THREE.Mesh(hub,metal);t.castShadow=h.castShadow=true;wheel.add(t,h);
      for(let k=0;k<12;k++){const tread=new THREE.Mesh(box,rubber);const a=k/12*Math.PI*2;tread.scale.set(.34,.085,.12);tread.position.set(0,Math.cos(a)*.4,Math.sin(a)*.4);tread.rotation.x=a;wheel.add(tread);}
      mergeParts(wheel);wheels.push(wheel);
      part(metal,[1.35,.055,.055],[0,-.24,zw]);part(amber,[.065,.38,.065],[xw*.75,-.04,zw],[0,0,xw>0?-.25:.25]);
    }
    mergeParts(model);
    const y=this.g.map.groundHeight(x,z)+.7,pos=new THREE.Vector3(x,y,z),R=this.g.physics.R;
    const body=this.g.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x,y,z));
    const collider=this.g.physics.world.createCollider(R.ColliderDesc.cuboid(.66,.24,1.14).setCollisionGroups(cg(G.VEHICLE)),body);
    const v:ATV={id:this.list.length,pos,spawn:pos.clone(),spawnYaw:yaw,yaw,pitch:0,roll:0,speed:0,vy:0,driver:'',grounded:true,model,wheels,front,body,collider,lastPacket:0,abandoned:0,steer:0,boost:1,boostLocked:false};
    this.g.physics.setOwner(collider,{vehicle:v,surface:'metal'});this.g.scene.add(model);this.list.push(v);this.place(v);
  }
  reset(){this.detach();this.contacts.clear();for(const v of this.list){v.pos.copy(v.spawn);v.yaw=v.spawnYaw;v.pitch=v.roll=v.speed=v.vy=0;v.driver='';v.target=undefined;v.grounded=true;v.boost=1;v.boostLocked=false;this.place(v);}}
  snapshot():VehicleState[]{return this.list.map(v=>({id:v.id,p:v.pos.toArray(),yaw:v.yaw,pitch:v.pitch,roll:v.roll,speed:v.speed,vy:v.vy,driver:v.driver,grounded:v.grounded}));}
  apply(states:VehicleState[]){for(const s of states||[]){const v=this.list[s.id];if(!v||!this.valid(s))continue;const newlyOurs=s.driver===this.self&&v.driver!==this.self;v.driver=s.driver;if(v.driver!==this.self||newlyOurs){v.target=s;if(newlyOurs)this.copy(v,s);}}}
  private valid(s:VehicleState){return Array.isArray(s.p)&&s.p.length===3&&s.p.every(Number.isFinite)&&[s.yaw,s.pitch,s.roll,s.speed,s.vy].every(Number.isFinite)&&Math.abs(s.p[0])<119&&Math.abs(s.p[2])<119&&s.p[1]>-8&&s.p[1]<40;}
  receiveFrame(from:string,s:VehicleState){
    const v=this.list[s?.id];if(!this.g.online?.isHost||!v||v.driver!==from||!this.valid(s))return;
    const now=performance.now(),elapsed=(now-v.lastPacket)/1000,dt=clamp(elapsed,.066,1);
    const delta=new THREE.Vector3(...s.p as [number,number,number]).sub(v.pos);
    if(delta.length()>34*dt+2)return;
    // Validate impacts along the accepted movement, never from client-supplied damage/target IDs.
    // Large packet gaps cannot sweep through operators who may have just spawned into the path.
    const speed=Math.min(26,Math.max(Math.abs(v.speed),Math.abs(s.speed)),Math.hypot(delta.x,delta.z)/dt+2);
    if(elapsed<=.35)this.sweep(v,delta,new THREE.Quaternion().setFromAxisAngle(UP,s.yaw),speed,.12);
    v.lastPacket=now;v.target={...s,speed:clamp(s.speed,-7,26),driver:from};this.copy(v,v.target);
  }
  authorize(who:string,id:number,action:'enter'|'exit'){
    const v=this.list[id],e=who===this.self?this.g.player:this.g.online?.entity(who);if(!v||!e)return false;
    if(action==='enter'){
      if(!e.alive||v.driver||this.list.some(v=>v.driver===who)||e.pos.distanceTo(v.pos)>4.2||Math.abs(v.speed)>3)return false;
      v.driver=who;v.lastPacket=performance.now();v.abandoned=0;this.contacts.delete(v.id);return true;
    }
    if(v.driver!==who)return false;v.driver='';return true;
  }
  release(who:string){for(const v of this.list)if(v.driver===who){v.driver='';v.target=undefined;}}
  private action(v:ATV,action:'enter'|'exit'){
    if(performance.now()-this.actionAt<350)return;this.actionAt=performance.now();
    if(this.g.online?.connected)this.g.online.vehicleAction(v.id,action);else this.authorize(this.self,v.id,action);
  }
  update(dt:number,canControl:boolean){
    const g=this.g,p=g.player,inp=g.input,authority=!g.online?.connected||g.online.isHost;
    if(authority)for(const v of this.list)if(v.driver){const e=v.driver===this.self?p:g.online?.entity(v.driver);if(!e?.alive||g.match.over||(v.driver!==this.self&&!g.online?.peers.has(v.driver)))v.driver='';}
    let current=this.current;
    if(canControl&&inp.hit('KeyE')){
      const near=current||this.list.filter(v=>!v.driver&&Math.abs(v.speed)<3).sort((a,b)=>a.pos.distanceToSquared(p.pos)-b.pos.distanceToSquared(p.pos))[0];
      if(near&&(current||near.pos.distanceTo(p.pos)<3.5)){inp.pressed.delete('KeyE');this.action(near,current?'exit':'enter');}
    }
    current=this.current;
    if(current?.id!==this.previous){if(this.previous>=0)this.detach();if(current)this.attach(current);}
    for(const v of this.list){
      if(v===current){
        const throttle=canControl?(Number(inp.down('KeyW'))-Number(inp.down('KeyS'))):0,steer=canControl?(Number(inp.down('KeyA'))-Number(inp.down('KeyD'))):0;
        const n=Math.max(1,Math.ceil(dt*90));for(let i=0;i<n;i++)this.drive(v,dt/n,throttle,steer,canControl&&inp.down('Space'),canControl&&(inp.down('ShiftLeft')||inp.down('ShiftRight')));
      }else if(v.driver){if(v.target){const s=v.target,t=1-Math.exp(-dt*15);if(v.pos.distanceToSquared(new THREE.Vector3(...s.p as [number,number,number]))>64)this.copy(v,s);else{v.pos.lerp(new THREE.Vector3(...s.p as [number,number,number]),t);v.yaw+=wrapAngle(s.yaw-v.yaw)*t;v.pitch=damp(v.pitch,s.pitch,12,dt);v.roll=damp(v.roll,s.roll,12,dt);v.speed=s.speed;}}}
      else if(authority){if(Math.abs(v.speed)>.02||!v.grounded)this.drive(v,dt,0,0,true,false);v.abandoned+=dt;if(v.abandoned>50&&v.pos.distanceTo(v.spawn)>12&&p.pos.distanceTo(v.pos)>20){v.pos.copy(v.spawn);v.yaw=v.spawnYaw;v.speed=v.vy=0;v.abandoned=0;}}
      else if(v.target)this.copy(v,v.target);
      this.place(v);for(const w of v.wheels)w.rotation.x-=v.speed*dt/.42;for(const f of v.front)f.rotation.y=v.steer*.4;
    }
    this.engineSound(current,canControl);
    if(current){this.rider(current,dt,canControl);this.hud(current);}else{const near=this.list.find(v=>!v.driver&&Math.abs(v.speed)<3&&v.pos.distanceTo(p.pos)<3.5);this.hud(undefined,canControl&&near?'E  ·  DRIVE KESTREL ATV':'');}
  }
  private drive(v:ATV,dt:number,throttle:number,steer:number,brake:boolean,boost:boolean){
    v.steer=damp(v.steer,steer,9,dt);if(!boost)v.boostLocked=false;const turbo=boost&&!v.boostLocked&&throttle>0&&v.boost>.03;
    v.boost=clamp(v.boost+(turbo?-.25:.16)*dt,0,1);if(v.boost<=.03)v.boostLocked=true;
    const limit=turbo?26:19;
    if(throttle>0&&v.speed<limit)v.speed=Math.min(limit,v.speed+(turbo?22:15)*dt);
    else if(throttle<0)v.speed=Math.max(-7,v.speed-15*dt);
    v.speed=damp(v.speed,0,brake?6:throttle? .12:1.15,dt);if(v.speed>limit)v.speed=damp(v.speed,limit,1.5,dt);v.speed=clamp(v.speed,-7,26);
    const turn=clamp(Math.abs(v.speed)/5,0,1)*1.25*(v.speed<0?-1:1)*(v.grounded?1:.18);
    v.yaw+=v.steer*turn*dt;
    const dx=-Math.sin(v.yaw)*v.speed*dt,dz=-Math.cos(v.yaw)*v.speed*dt;
    const q=new THREE.Quaternion().setFromAxisAngle(UP,v.yaw),oldY=v.pos.y;
    const fraction=this.sweep(v,new THREE.Vector3(dx,0,dz),q,Math.abs(v.speed));
    v.pos.x=clamp(v.pos.x+dx*fraction,-117.5,117.5);v.pos.z=clamp(v.pos.z+dz*fraction,-117.5,117.5);if(fraction<.9)v.speed*=Math.pow(.08,dt);
    const heights:number[]=[];
    for(const [x,z]of [[-.58,-.87],[.58,-.87],[-.58,.87],[.58,.87]]){
      const at=new THREE.Vector3(x,.95,z).applyQuaternion(q).add(v.pos);
      const hit=this.g.physics.raycast(at,DOWN,8,G.WORLD);
      heights.push(hit&&hit.normal.y>.5?hit.point.y:this.g.map.groundHeight(at.x,at.z));
    }
    const floor=(heights.reduce((a,b)=>a+b,0)/4)+.69;
    const front=(heights[0]+heights[1])/2,rear=(heights[2]+heights[3])/2,left=(heights[0]+heights[2])/2,right=(heights[1]+heights[3])/2;
    if(v.grounded&&floor>=v.pos.y-.22&&floor<v.pos.y+.55){v.pos.y=floor;v.vy=clamp((v.pos.y-oldY)/Math.max(.001,dt),-8,12);}
    else{v.grounded=false;v.vy-=19*dt;v.pos.y+=v.vy*dt;if(v.pos.y<=floor&&v.vy<=0){v.pos.y=floor;v.vy=0;v.grounded=true;}}
    const pitch=v.grounded?Math.atan2(front-rear,1.74):clamp(v.vy*.026,-.35,.35);
    const roll=v.grounded?Math.atan2(right-left,1.16)-v.steer*v.speed*.005:0;
    v.pitch=damp(v.pitch,clamp(pitch,-.55,.55),12,dt);v.roll=damp(v.roll,clamp(roll,-.45,.45),10,dt);
    // Keep shape queries in sync between the small suspension steps.
    v.body.setTranslation(v.pos,true);v.body.setRotation(q,true);v.body.setNextKinematicTranslation(v.pos);
  }
  /** Swept chassis queries prevent tunneling, respect walls/height, and allow lethal hits to carry through. */
  private sweep(v:ATV,delta:THREE.Vector3,q:THREE.Quaternion,speed:number,targetDistance=.04){
    const g=this.g,physics=g.physics,length=delta.length();if(length<1e-5)return 1;
    let contacts=this.contacts.get(v.id);if(!contacts){contacts=new Map();this.contacts.set(v.id,contacts);}
    // One impact per encounter. Holding the throttle against a survivor cannot repeatedly deal damage.
    for(const [e]of contacts)if(!e.alive||Math.hypot(e.pos.x-v.pos.x,e.pos.z-v.pos.z)>3||Math.abs(e.pos.y-v.pos.y)>3)contacts.delete(e);
    const wall=physics.world.castShape(v.pos,q,delta,v.collider.shape,0,1,false,undefined,cg(G.VEHICLE,G.WORLD|G.VEHICLE),v.collider);
    const maxTime=wall?wall.time_of_impact:1,margin=.03/Math.max(.03,length);
    const driver=v.driver===this.self?g.player:g.online?.entity(v.driver);
    const seen=new Set<any>();
    for(let i=0;i<24;i++){
      const hit=physics.world.castShape(v.pos,q,delta,v.collider.shape,targetDistance,maxTime,false,undefined,cg(G.VEHICLE,G.BOT|G.PLAYER),v.collider,undefined,c=>{
        const e=physics.ownerOf(c)?.entity;return !!e?.alive&&e!==driver&&!seen.has(e)&&!contacts.get(e)?.pass;
      });
      if(!hit)break;
      const target=physics.ownerOf(hit.collider)?.entity;if(!target)break;
      seen.add(target);
      if(!contacts.has(target)){
        const amount=speed<IMPACT_MIN_SPEED?0:Math.min(200,Math.floor(100*(speed/IMPACT_LETHAL_SPEED)**2));
        const entry={pass:false};contacts.set(target,entry);
        if(driver?.alive&&amount>0&&!g.match.over){
          const point=target.pos.clone(),from=v.pos.clone().addScaledVector(delta,hit.time_of_impact);
          if(g.online?.connected){
            if(g.online.isHost)entry.pass=g.online.vehicleImpact(v.id,target,amount,from);
            else entry.pass=amount>=target.health; // Predict traversal only; health and score remain host-owned.
          }else{entry.pass=target.takeDamage(amount,driver,'body',VEHICLE_WEAPON,from);this.impactFeedback(v.driver,point,entry.pass);}
        }
      }
      if(!target.alive||contacts.get(target)?.pass)continue;
      return Math.max(0,hit.time_of_impact-margin);
    }
    return wall?Math.max(0,maxTime-margin):1;
  }
  impactFeedback(driver:string,point:THREE.Vector3,killed:boolean){
    this.g.audio.bodyHit(point);
    if(driver===this.self){this.g.hud.hitmarker(killed?'kill':'hit');if(this.current)this.cameraPos.y+=.12;}
  }
  private copy(v:ATV,s:VehicleState){v.pos.fromArray(s.p);v.yaw=s.yaw;v.pitch=s.pitch;v.roll=s.roll;v.speed=s.speed;v.vy=s.vy;v.grounded=s.grounded;}
  private place(v:ATV){v.model.position.copy(v.pos);v.model.rotation.set(v.pitch,v.yaw,v.roll,'YXZ');v.body.setTranslation(v.pos,true);v.body.setNextKinematicTranslation(v.pos);const q=new THREE.Quaternion().setFromAxisAngle(UP,v.yaw);v.body.setRotation(q,true);v.body.setNextKinematicRotation(q);}
  private attach(v:ATV){const g=this.g;this.previous=v.id;this.orbit=0;this.elevation=.27;this.cameraPos.copy(v.pos).add(new THREE.Vector3(Math.sin(v.yaw)*5,2.8,Math.cos(v.yaw)*5));g.player.setCrouch(false);g.player.setMounted(true);g.player.ads=0;g.player.climbing=null;g.gunplay.adsLatched=g.gunplay.adsHeld=false;g.playerPuppet?.setShadowOnly(false);g.vm.root.visible=false;el('weapon').classList.add('hidden');el('streaks').classList.add('hidden');g.hud.centerMsg('KESTREL ATV');this.startEngine();}
  detach(){if(this.previous<0)return;if(this.engine){this.engine.osc.stop();this.engine.harmonic.stop();this.engine.gain.disconnect();this.engine=undefined;}const g=this.g,v=this.list[this.previous];g.player.setMounted(false);g.player.vel.set(0,0,0);if(v&&g.player.alive){const exit=this.exitPoint(v);g.player.teleport(exit);g.player.yaw=v.yaw+this.orbit;g.player.pitch=0;g.player.eyeCur=1.62;}g.playerPuppet?.setShadowOnly(true);g.vm.root.visible=g.player.alive;this.previous=-1;el('weapon').classList.remove('hidden');el('streaks').classList.remove('hidden');this.hud();}
  private exitPoint(v:ATV){const physics=this.g.physics;for(const a of [Math.PI/2,-Math.PI/2,Math.PI,0,Math.PI*.75,-Math.PI*.75]){
      const x=v.pos.x+Math.sin(v.yaw+a)*2.4,z=v.pos.z+Math.cos(v.yaw+a)*2.4;
      const hit=physics.raycast(new THREE.Vector3(x,v.pos.y+2,z),DOWN,12,G.WORLD);if(!hit||hit.normal.y<.65)continue;
      const feet=hit.point.clone().add(new THREE.Vector3(0,.08,0));
      const overlap=physics.world.intersectionWithShape(feet.clone().add(new THREE.Vector3(0,.93,0)),{x:0,y:0,z:0,w:1},new physics.R.Capsule(.54,.36),undefined,cg(G.PLAYER,G.WORLD|G.VEHICLE|G.BOT),this.g.player.collider);
      if(!overlap)return feet;
    }return v.pos.clone().add(new THREE.Vector3(0,1.1,0));}
  private rider(v:ATV,dt:number,canControl:boolean){
    const g=this.g,p=g.player;const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(v.pitch,v.yaw,v.roll,'YXZ'));
    p.pos.copy(v.pos).add(new THREE.Vector3(0,.75,.24).applyQuaternion(q));p.yaw=v.yaw;p.pitch=0;p.speed=Math.abs(v.speed);p.grounded=v.grounded;p.vel.set(-Math.sin(v.yaw)*v.speed,v.vy,-Math.cos(v.yaw)*v.speed);p.body.setTranslation(p.pos,true);p.body.setNextKinematicTranslation(p.pos);
    if(!g.online?.connected&&p.alive&&performance.now()/1000-p.lastDamage>p.regenDelay)p.health=Math.min(100,p.health+dt*p.regenRate);
    if(canControl){this.orbit-=g.input.mouseDX*.0021*g.settings.sens;this.elevation=clamp(this.elevation+g.input.mouseDY*.0017,-.12,.85);}
    const aim=v.pos.clone().add(new THREE.Vector3(0,1.1,0)),yaw=v.yaw+this.orbit,distance=5.3+Math.abs(v.speed)*.025;
    const offset=new THREE.Vector3(Math.sin(yaw)*Math.cos(this.elevation),Math.sin(this.elevation),Math.cos(yaw)*Math.cos(this.elevation)).multiplyScalar(distance);
    const obstruction=g.physics.raycast(aim,offset,distance,G.WORLD);if(obstruction)offset.setLength(Math.max(.6,obstruction.distance-.35));
    this.cameraPos.lerp(aim.clone().add(offset),1-Math.exp(-dt*14));p.rig.position.copy(this.cameraPos);p.rig.lookAt(aim);p.rig.rotateY(Math.PI);g.camera.fov=damp(g.camera.fov,82+Math.abs(v.speed)*.25,8,dt);g.camera.updateProjectionMatrix();
  }
  silence(){if(this.engine)this.engine.gain.gain.setTargetAtTime(0,this.g.audio.ctx.currentTime,.08);}
  private startEngine(){
    const ctx=this.g.audio.ctx,osc=ctx.createOscillator(),harmonic=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
    osc.type='sawtooth';harmonic.type='triangle';osc.frequency.value=35;harmonic.frequency.value=71;filter.type='lowpass';filter.frequency.value=270;gain.gain.value=.035;
    osc.connect(filter);harmonic.connect(filter);filter.connect(gain);gain.connect(this.g.audio.sfx);osc.start();harmonic.start();this.engine={osc,harmonic,gain,filter};
  }
  private engineSound(v:ATV|undefined,enabled:boolean){if(!this.engine||!v)return;const e=this.engine,t=this.g.audio.ctx.currentTime,rpm=35+Math.abs(v.speed)*3.4+(this.g.input.down('KeyW')?12:0);e.osc.frequency.setTargetAtTime(rpm,t,.12);e.harmonic.frequency.setTargetAtTime(rpm*2.01,t,.12);e.filter.frequency.setTargetAtTime(250+Math.abs(v.speed)*18,t,.1);e.gain.gain.setTargetAtTime(enabled?.033+Math.abs(v.speed)*.0012:0,t,.1);}
  private hud(v?:ATV,hint=''){const text=v?`${Math.round(Math.abs(v.speed)*3.6)} KM/H · ${v.grounded?'KESTREL ATV':'AIRBORNE'}|${Math.round(v.boost*100)}`:hint;if(text===this.lastHud)return;this.lastHud=text;const node=el('vehicle-hud');node.classList.toggle('hidden',!text);node.innerHTML=v?`<div class="vehicle-name">KESTREL <span>LIGHT RECON ATV</span></div><div class="vehicle-speed">${Math.round(Math.abs(v.speed)*3.6)}<small>KM/H</small></div><div class="vehicle-boost"><i style="width:${v.boost*100}%"></i></div><div class="vehicle-keys">WASD DRIVE &nbsp; SPACE BRAKE &nbsp; SHIFT BOOST &nbsp; E EXIT</div>${!v.grounded?'<b class="airborne">AIRBORNE</b>':''}`:`<div class="vehicle-prompt">${hint}</div>`;}
}

function mergeParts(group:THREE.Group){
  const buckets=new Map<THREE.Material,THREE.BufferGeometry[]>();
  for(const child of [...group.children])if(child instanceof THREE.Mesh){child.updateMatrix();const geo=child.geometry.clone().applyMatrix4(child.matrix);const mat=child.material as THREE.Material;if(!buckets.has(mat))buckets.set(mat,[]);buckets.get(mat)!.push(geo);group.remove(child);}
  for(const [mat,geos] of buckets){const merged=mergeGeometries(geos,false)!;for(const geo of geos)geo.dispose();const mesh=new THREE.Mesh(merged,mat);mesh.castShadow=mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;group.add(mesh);}
}
