import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from './Game';
import { G, cg } from './Physics';
import { el, clamp } from './util';
export type ElevatorState={from:number;floor:number;start:number;duration:number};
export const FLOOR_Y=Array.from({length:8},(_,i)=>.3+i*4.2);
/** One shared lift. Requests are checked against the caller's actual landing/cabin location. */
export class Elevator {
  state:ElevatorState={from:.3,floor:0,start:0,duration:0};group=new THREE.Group();y=.3;open=false;
  private body?:RAPIER.RigidBody;private doors:{mesh:THREE.Mesh;collider:RAPIER.Collider}[]=[];private cabinDoor?:RAPIER.Collider;private cabinDoorMesh?:THREE.Mesh;
  constructor(private g:Game){
    if(g.mapId!=='sable')return;const R=g.physics.R,metal=new THREE.MeshStandardMaterial({color:0x566567,metalness:.75,roughness:.35}),floor=new THREE.MeshStandardMaterial({color:0x252e2e,roughness:.7});
    this.body=g.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(9,.3,5));
    const part=(size:number[],p:number[],mat=metal)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...size as [number,number,number]),mat);m.position.fromArray(p);this.group.add(m);const c=g.physics.world.createCollider(R.ColliderDesc.cuboid(size[0]/2,size[1]/2,size[2]/2).setTranslation(p[0],p[1],p[2]).setCollisionGroups(cg(G.WORLD)),this.body);g.physics.setOwner(c,{surface:'metal',elevator:true});return{mesh:m,collider:c};};
    part([3.9,.2,3.9],[0,-.1,0],floor);part([3.9,.15,3.9],[0,3.5,0]);part([.12,3.4,3.9],[-1.9,1.7,0]);part([.12,3.4,3.9],[1.9,1.7,0]);part([3.9,3.4,.12],[0,1.7,1.9]);
    const door=part([3.7,3.4,.12],[0,1.7,-1.92]);this.cabinDoor=door.collider;this.cabinDoorMesh=door.mesh;
    const light=new THREE.Mesh(new THREE.BoxGeometry(2,.04,1.4),new THREE.MeshBasicMaterial({color:0xe7f5f2}));light.position.set(0,3.4,0);this.group.add(light);g.scene.add(this.group);this.group.position.set(9,.3,5);
    for(const y of FLOOR_Y){const m=new THREE.Mesh(new THREE.BoxGeometry(4,3.4,.16),metal);m.position.set(9,y+1.7,2.9);g.map.group.add(m);const c=g.physics.addStaticBox(m.position,new THREE.Vector3(4,3.4,.16),undefined,G.WORLD,{surface:'metal',elevator:true});this.doors.push({mesh:m,collider:c});}
    this.update(0,false);
  }
  get moving(){return Date.now()<this.state.start+this.state.duration;}
  inside(e:any){return Math.abs(e.pos.x-9)<1.7&&Math.abs(e.pos.z-5)<1.7&&Math.abs(e.feetY-this.y)<1.2;}
  request(floor:number){if(this.g.online?.connected)this.g.online.elevatorAction(floor);else this.authorize(this.g.player,floor);this.close();}
  authorize(e:any,floor:number){if(!this.body||!e?.alive||e.mounted||!Number.isInteger(floor)||floor<0||floor>7||this.moving)return false;
    const near=Math.abs(e.pos.x-9)<3.5&&e.pos.z>-.5&&e.pos.z<7&&FLOOR_Y.some(y=>Math.abs(e.feetY-y)<1);
    if(!this.inside(e)&&!near)return false;this.state={from:this.y,floor,start:Date.now()+750,duration:Math.abs(FLOOR_Y[floor]-this.y)/3.5*1000};return true;
  }
  apply(state:ElevatorState){if(state&&Number.isInteger(state.floor)&&FLOOR_Y[state.floor]!==undefined&&[state.from,state.start,state.duration].every(Number.isFinite))this.state=state;}
  close(){this.open=false;el('elevator-panel').classList.add('hidden');if(this.g.state==='playing'&&!this.g.nolock)this.g.input.lock();}
  update(_dt:number,canControl:boolean){
    if(!this.body)return;const g=this.g,now=Date.now(),oldY=this.y,st=this.state;
    const t=st.duration?clamp((now-st.start)/st.duration,0,1):1;this.y=st.from+(FLOOR_Y[st.floor]-st.from)*t;
    const p=g.player,carried=p.alive&&Math.abs(p.pos.x-9)<1.72&&Math.abs(p.pos.z-5)<1.72&&Math.abs(p.feetY-oldY)<.7;
    if(carried&&Math.abs(this.y-oldY)>0){p.pos.y+=this.y-oldY;p.body.setTranslation(p.pos,true);p.body.setNextKinematicTranslation(p.pos);p.vel.y=0;}
    this.body.setTranslation({x:9,y:this.y,z:5},true);this.body.setNextKinematicTranslation({x:9,y:this.y,z:5});this.group.position.y=this.y;
    const closed=this.moving;this.cabinDoor?.setEnabled(closed);if(this.cabinDoorMesh)this.cabinDoorMesh.visible=closed;
    this.doors.forEach((d,i)=>{const shut=closed||Math.abs(FLOOR_Y[i]-this.y)>.1;d.collider.setEnabled(shut);d.mesh.visible=shut;});
    const nearby=Math.abs(p.pos.x-9)<3&&p.pos.z>0&&p.pos.z<7&&FLOOR_Y.some(y=>Math.abs(p.feetY-y)<1);
    if(this.open&&(!p.alive||!nearby||g.state!=='playing'))this.close();
    const hint=el('elevator-hint');hint.classList.toggle('hidden',!nearby||!p.alive||g.state!=='playing');if(nearby)hint.textContent=closed?'LIFT MOVING → FLOOR '+(st.floor+1):this.inside(p)?'E · SELECT FLOOR':'E · CALL LIFT';
    if(canControl&&nearby&&g.input.hit('KeyE')){g.input.pressed.delete('KeyE');if(closed)return;if(this.inside(p)){this.open=true;g.input.unlock();g.input.reset();el('elevator-panel').classList.remove('hidden');el('elevator-current').textContent='FLOOR '+(st.floor+1);el('elevator-floors').innerHTML=FLOOR_Y.map((_,i)=>`<button data-floor="${i}" class="${i===st.floor?'selected':''}"><b>${i+1}</b><span>${['LOBBY','SECURITY','OPERATIONS','RESEARCH','COMMAND','OBSERVATION','EXECUTIVE','SKY LOUNGE'][i]}</span></button>`).join('');el('elevator-floors').querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>this.request(Number(b.dataset.floor)));el('elevator-close').onclick=()=>this.close();}else this.request(FLOOR_Y.reduce((best,y,i)=>Math.abs(p.feetY-y)<Math.abs(p.feetY-FLOOR_Y[best])?i:best,0));}
  }
  reset(){this.open=false;this.state={from:.3,floor:0,start:0,duration:0};this.y=.3;el('elevator-panel').classList.add('hidden');el('elevator-hint').classList.add('hidden');this.update(0,false);}
}
