import * as THREE from 'three';
import { init, type RoomHandle } from '@instantdb/core';
import { Bot } from './Bots';
import { WEAPONS, LOADOUTS } from './WeaponDefs';
import { VoiceChat } from './VoiceChat';
import { G } from './Physics';
import { clamp, el, smoothstep, lerp } from './util';
import type { Game, MapId } from './Game';
import { VEHICLE_WEAPON, type VehicleState } from './Vehicles';
import type { FieldState } from './FieldItems';
import type { EntityHit } from './Weapons';

type Presence={id:string;name:string;joined:number;ready:boolean;loadout:number;mic:boolean;owner:boolean;preparedRound:string;world?:World;};
type Pose={id:string;name:string;p:number[];yaw:number;pitch:number;speed:number;crouch:boolean;weapon:string;health:number;alive:boolean;kills:number;deaths:number;score:number;streak:number;deathAt:number;life:number;loadout:number;vehicle?:number;};
type World={seq?:number;round:string;map:MapId;phase:'lobby'|'loading'|'playing'|'ended';startAt:number;endsAt:number;limit:number;bots:number;entities:Pose[];vehicles?:VehicleState[];items?:FieldState[];};
const vec=(p:number[])=>new THREE.Vector3(p[0],p[1],p[2]);
const clean=(s:string)=>String(s||'OPERATOR').replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,16);
const classIndex=(i:number)=>Number.isInteger(i)&&!!LOADOUTS[i]?i:0;
const roundNumber=(n:number)=>Math.round(n*1000)/1000;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** One private InstantDB room. The elected browser hosts the simulation; movement is local. */
export class Online {
  connected=false;joining=false;id='';hostId='';owner=false;name='';inviteKey='';ready=false;mic?:VoiceChat;
  peers=new Map<string,Presence>();remotes=new Map<string,Bot>();private pending=new Set<string>();
  world:World={round:'',map:'sable',phase:'lobby',startAt:0,endsAt:0,limit:20,bots:4,entities:[]};
  private db?:ReturnType<typeof init>; private room?:RoomHandle<any,any>; private unsubs:(()=>void)[]=[];
  private lastSend=0;private lastPresence=0;private poseTargets=new Map<string,Pose>();private deathTimes=new Map<string,number>();private hurtTimes=new Map<string,number>();
  private shots=new Map<string,{seq:number;at:number;weapon:string;remaining:number}>();private shotSeq=0;private starting=false;private joinedAt=0;private lastHostPacket=0;private lastPoseSeq=new Map<string,number>();private poseSeq=0;
  private worldHost='';
  private preparedRound='';private preparingRound='';private launching=false;
  private received=new Set<string>();private events:any[]=[];private lastPing=0;ping=0;private copyKey='';private lastRoster='';
  constructor(private g:Game){
    this.world.map=g.mapId;
    el<HTMLSelectElement>('lobby-map').value=g.mapId;
    el('lobby-map').onchange=()=>this.selectMap(el<HTMLSelectElement>('lobby-map').value as MapId);
    el('map-retry').onclick=()=>void this.prepareMap();
    el('map-leave').onclick=()=>this.leave();
    const hash=new URLSearchParams(location.hash.slice(1));
    this.copyKey=hash.get('host')||hash.get('invite')||sessionStorage.getItem('sable-invite')||'';
    if(hash.has('host')||hash.has('invite')){sessionStorage.setItem('sable-invite',this.copyKey);history.replaceState(null,'',location.pathname+location.search);}
    el<HTMLInputElement>('callsign').value=localStorage.getItem('sable-callsign')||'';
    el<HTMLInputElement>('invite-code').value=this.copyKey;
    el('btn-online').onclick=()=>{el('lobby').classList.remove('hidden');};
    el('lobby-close').onclick=()=>{if(this.active){el('lobby').classList.add('hidden');this.g.resume();}else if(!this.connected)el('lobby').classList.add('hidden');else this.status('You are still in the lobby. Ready up to play, or use Leave lobby.');};
    el('lobby-leave').onclick=()=>this.leave();
    el('lobby-resume').onclick=()=>{el('lobby').classList.add('hidden');this.g.resume();};
    el('invite-hint').textContent=this.copyKey?'Invite link loaded. Choose your callsign and join.':'';
    for(const id of ['callsign','invite-code'])el(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void this.join();}});
    el('lobby-join').onclick=()=>void this.join();
    el('lobby-ready').onclick=()=>{this.ready=!this.ready;this.publishPresence();this.render();};
    el('lobby-start').onclick=()=>void this.start();
    el('lobby-invite').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+location.pathname+'#invite='+this.inviteKey);this.status('Invite link copied. Only people with this link can join.');}catch{this.status('Invite code: '+this.inviteKey);}};
    el('lobby-mic').onclick=()=>void this.mic?.toggle();
    el('online-mic').onclick=()=>void this.mic?.toggle();
    el<HTMLInputElement>('voice-ptt').onchange=e=>this.mic?.setPTT((e.target as HTMLInputElement).checked);
    el('lobby-return').onclick=()=>{this.g.input.unlock();el('lobby').classList.remove('hidden');};
    if(this.copyKey)el('lobby').classList.remove('hidden');
  }
  get isHost(){return this.connected&&this.id===this.hostId;}
  get active(){return this.connected&&this.world.phase==='playing';}
  entityId(e:any){return e===this.g.player?this.id:e?.netId||('bot-'+e?.id);}
  entity(id:string):any {return id===this.id?this.g.player:this.remotes.get(id)||this.g.bots.bots.find(b=>'bot-'+b.id===id);}
  get targets(){return [...this.remotes.values()].map(b=>({entity:b,pos:b.chestPos.clone(),head:b.headPos,alive:b.alive,name:b.name}));}
  get victims(){return [...this.g.bots.victims,...[...this.remotes.values()].map(b=>({entity:b,pos:b.pos.clone(),alive:b.alive}))];}
  private status(text:string){el('lobby-status').textContent=text;}
  async join(){
    if(this.joining||this.connected)return;
    if(!el<HTMLInputElement>('callsign').value.trim()){this.status('Enter a callsign so your friends can recognize you.');el('callsign').focus();return;}
    this.joining=true;el<HTMLButtonElement>('lobby-join').disabled=true;this.status('Connecting to the private lobby…');
    try{
      this.copyKey=el<HTMLInputElement>('invite-code').value.trim();
      const response=await fetch('/api/lobby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:this.copyKey,name:el<HTMLInputElement>('callsign').value,token:sessionStorage.getItem('sable-token')})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not join.');
      this.id=data.id;this.name=clean(data.name);this.owner=data.owner;this.inviteKey=data.inviteKey||this.copyKey;this.joinedAt=Date.now();
      localStorage.setItem('sable-callsign',this.name);sessionStorage.setItem('sable-invite',this.copyKey);sessionStorage.setItem('sable-token',data.token);
      this.db=init({appId:import.meta.env.VITE_INSTANT_APP_ID||'ec099d8e-0cbc-4742-87f6-e01fac862c5c'});
      await this.db.auth.signInWithToken(data.token);
      this.connected=true;this.g.player.name=this.name;
      this.mic=new VoiceChat(this.id,data.iceServers,msg=>this.send(msg));
      this.mic.onChange=()=>{this.publishPresence();this.render();};this.mic.onError=m=>this.status(m);
      // Map-loading acknowledgements must not mix with older single-map browser tabs.
      this.room=this.db.joinRoom('sable',data.roomId+'-match-v3',{initialPresence:this.presence()});
      this.unsubs.push(this.room.subscribePresence({},slice=>{
        if(slice.error){this.status('Lobby connection error. Rejoin to try again.');return;}
        if(slice.isLoading)return;
        const list=[slice.user,...Object.values(slice.peers||{})].filter((p:any)=>p?.id&&p?.name) as unknown as Presence[];
        this.peers=new Map(list.map(p=>[p.id,p]));if(!this.peers.has(this.id))this.peers.set(this.id,this.presence());
        const all=[...this.peers.values()].sort((a,b)=>a.joined-b.joined||a.id.localeCompare(b.id));
        if(all.findIndex(p=>p.id===this.id)>=8){this.leave();this.status('The lobby is full (8 players). Try again when a slot opens.');return;}
        const ordered=all.slice(0,8);this.peers=new Map(ordered.map(p=>[p.id,p]));
        const old=this.hostId;this.hostId=ordered[0]?.id||this.id;
        if(old&&old!==this.hostId){if(this.isHost){this.lastPoseSeq.clear();for(const id of this.poseTargets.keys())if(id.startsWith('bot-'))this.poseTargets.delete(id);this.g.bots.frozen=Date.now()<this.world.startAt;}this.status('Host transferred to '+this.peers.get(this.hostId)?.name);this.lastHostPacket=Date.now();}
        for(const p of ordered)if(p.id!==this.id&&!this.remotes.has(p.id)&&!this.pending.has(p.id))void this.addRemote(p);
        for(const [id,b]of this.remotes)if(!this.peers.has(id)){this.g.vehicles.release(id);this.disposeRemote(b);this.remotes.delete(id);this.poseTargets.delete(id);}
        if(!this.isHost){const snapshot=this.peers.get(this.hostId)?.world;if(snapshot)this.receiveWorld(snapshot);}
        void this.mic?.sync(ordered.map(p=>p.id));this.render();
      }));
      this.unsubs.push(this.room.subscribeTopic('wire',(data:any,peer:any)=>{if(!peer?.id||peer.id===this.id||!this.peers.has(peer.id))return;this.receive(peer.id,data);}));
      this.unsubs.push(this.db.subscribeConnectionStatus(s=>{if(!this.connected)return;const ok=s==='authenticated';el('online-status').textContent=ok?'PRIVATE SESSION':'RECONNECTING…';if(!ok)this.status('Connection interrupted. Trying to reconnect…');else if(el('lobby-status').textContent?.startsWith('Connection interrupted'))this.status('Connected to the private lobby.');}));
      el('join-fields').classList.add('hidden');el('lobby-session').classList.remove('hidden');this.status(this.isHost?'You are the host. Copy the invite link, choose a class, then start when everyone is ready.':'Connected. Choose your class and click Ready up. The host starts the match.');this.publishPresence();
    }catch(e){this.status((e as Error).message);this.connected=false;this.db?.shutdown();}
    finally{this.joining=false;el<HTMLButtonElement>('lobby-join').disabled=false;}
  }
  private presence():Presence{return{id:this.id,name:this.name,joined:this.joinedAt,ready:this.ready,loadout:this.g.loadoutIdx,mic:!!this.mic?.enabled,owner:this.owner,preparedRound:this.preparedRound,...(this.isHost?{world:this.world}:{})};}
  publishPresence(){if(this.connected)this.room?.publishPresence(this.presence());}
  private send(data:any){if(this.connected)this.room?.publishTopic('wire',{...data,round:data.round??this.world.round});}
  private async addRemote(p:Presence){
    this.pending.add(p.id);const b=new Bot(this.g.physics,100+this.remotes.size,p.name,LOADOUTS[p.loadout]||LOADOUTS[0],.7);(b as any).netId=p.id;
    (b as any).applyDamage=b.takeDamage.bind(b);
    b.takeDamage=(amount,attacker,part,weapon,from)=>{if(this.isHost)return this.damage(p.id,this.entityId(attacker),amount,part,weapon||'',from||undefined);return false;};
    b.onDeath=(att,w,hs)=>this.onKill(att,b,w,hs);
    await b.loadVisuals(this.g.scene);this.pending.delete(p.id);
    if(!this.connected||!this.peers.has(p.id)){this.disposeRemote(b);return;}
    this.remotes.set(p.id,b);b.alive=false;b.health=0;b.puppet?.setVisible(false);
    for(const c of [b.collider,b.hitHead,b.hitBody,b.hitLegs])c.setEnabled(false);
    if(this.isHost&&this.active&&!this.starting){this.spawnRemote(p.id);this.broadcastWorld();}
    else if(this.active&&!this.starting&&!this.g.mapChanging)this.applyWorld(this.world);
  }
  private disposeRemote(b:Bot){if(b.puppet){this.g.scene.remove(b.puppet.model,b.puppet.gunPivot);}this.g.physics.world.removeRigidBody(b.body);this.g.physics.world.removeCharacterController(b.cc);}
  private render(){
    if(!this.connected)return;
    el<HTMLSelectElement>('lobby-map').value=this.world.map;
    el<HTMLSelectElement>('lobby-map').disabled=!this.isHost||this.active||this.world.phase==='loading';
    el('lobby-map-note').textContent=this.active?'Finish this match to choose a different map for the rematch.':'The host chooses the map. Everyone loads it automatically.';
    const people=[...this.peers.values()].sort((a,b)=>a.joined-b.joined);
    const roster=JSON.stringify(people.map(p=>[p.id,p.name,p.ready,p.loadout,p.mic]))+this.hostId;
    if(roster!==this.lastRoster){this.lastRoster=roster;const wrap=el('lobby-roster');wrap.innerHTML='';people.forEach((p,i)=>{const row=document.createElement('div');row.className='lobby-person';row.innerHTML=`<span class="slot-no">${String(i+1).padStart(2,'0')}</span><div><b>${escape(p.name)} ${p.id===this.id?'<small>YOU</small>':''}</b><span>${LOADOUTS[p.loadout]?.name||'ASSAULT'}${p.id===this.hostId?' · HOST':''}</span></div><span class="ready-dot ${p.ready?'yes':''}">${p.ready?'READY':'PREPARING'}</span>`;const mute=document.createElement('button');mute.className='mute-peer';mute.textContent=p.mic?'MIC ON':'MIC OFF';mute.title='Mute / unmute this player';let muted=!!this.mic?.isPeerMuted(p.id);if(muted)mute.textContent='MUTED';mute.onclick=()=>{muted=!muted;this.mic?.setPeerMuted(p.id,muted);mute.textContent=muted?'MUTED':p.mic?'MIC ON':'MIC OFF';};row.append(mute);wrap.append(row);});}
    el('lobby-count').textContent=`${people.length} / 8 OPERATORS`;
    el('lobby-ready').textContent=this.ready?'READY ✓':'READY UP';
    el('lobby-start').classList.toggle('hidden',!this.isHost||this.active);el('lobby-resume').classList.toggle('hidden',!this.active);el('lobby-ready').classList.toggle('hidden',this.active);el('lobby-close').setAttribute('aria-label',this.active?'Return to match':'Close lobby');el('host-settings').classList.toggle('hidden',!this.isHost);
    el('lobby-start').textContent=this.world.phase==='playing'?'JOIN MATCH':this.world.phase==='ended'?'START REMATCH':'START MATCH';
    el('lobby-mic').textContent=this.mic?.enabled?'DISABLE MICROPHONE':'ENABLE MICROPHONE';
    el('online-mic').textContent=this.mic?.enabled?(this.mic.pushToTalk?'VOICE · HOLD V':'MIC ON'):'MIC OFF';
    el('online-bar').classList.remove('hidden');el('online-status').textContent=this.active?`PRIVATE FFA · ${people.length} PLAYERS · ${this.ping} MS`:'PRIVATE LOBBY';
  }
  selectClass(index:number){
    index=classIndex(index);const me=this.peers.get(this.id);if(me)me.loadout=index;
    this.send({kind:'class',loadout:index});this.publishPresence();this.render();
  }
  selectMap(map:MapId){
    if(!this.isHost||this.active||this.world.phase==='loading'||!['rust','sable'].includes(map))return;
    this.world.map=map;this.broadcastWorld();this.publishPresence();this.render();
  }
  async start(){
    if(!this.isHost||this.starting||this.world.phase==='loading')return;
    if(this.active){el('lobby').classList.add('hidden');this.g.resume();return;}
    if([...this.peers.values()].some(p=>p.id!==this.id&&!p.ready)){this.status('Waiting for the other operators to ready up.');return;}
    this.world={round:crypto.randomUUID(),map:this.world.map,phase:'loading',startAt:Date.now(),endsAt:0,limit:Number(el<HTMLSelectElement>('lobby-limit').value),bots:Number(el<HTMLSelectElement>('lobby-bots').value),entities:[]};
    this.poseTargets.clear();this.lastPoseSeq.clear();this.deathTimes.clear();this.hurtTimes.clear();this.events=[];this.received.clear();this.shots.clear();
    for(const b of this.remotes.values()){b.kills=0;b.deaths=0;b.score=0;b.streak=0;}
    this.preparedRound='';this.broadcastWorld();this.publishPresence();void this.prepareMap();
  }
  private async begin(){
    if(this.starting)return;this.starting=true;
    const round=this.world.round;this.showMapTransition();
    try{
    await this.g.loadMap(this.world.map);
    if(!this.connected||round!==this.world.round)return;
    this.g.settings.scoreLimit=this.world.limit;
    await this.g.startMatch();this.g.player.regenDelay=Infinity;this.g.countdown=Math.max(0,(this.world.startAt-Date.now())/1000);
    el('lobby').classList.add('hidden');el('map-transition').classList.add('hidden');this.lastHostPacket=Date.now();
    if(!this.isHost&&this.world.entities.length)this.applyWorld(this.world);
    this.render();
    }catch(e){this.mapLoadError(e); }finally{this.starting=false;}
  }
  private showMapTransition(){
    this.g.input.unlock();this.g.input.reset();
    el('class-picker').classList.add('hidden');el('map-retry').classList.add('hidden');
    el('map-transition').classList.remove('hidden');el('map-transition-title').textContent='LOADING '+(this.world.map==='rust'?'RUST':'SABLE REACH');
    el('map-transition-status').textContent='Your lobby and voice chat stay connected. Waiting for every operator to load the map…';
  }
  private mapLoadError(error:unknown){
    console.error('Map loading failed',error);el('map-transition-status').textContent='Could not load the map. Check your connection and retry.';el('map-retry').classList.remove('hidden');
  }
  private async prepareMap(){
    const round=this.world.round;
    if(!this.connected||this.preparingRound===round)return;
    this.preparingRound=round;this.showMapTransition();
    try{
      await this.g.loadMap(this.world.map);
      if(!this.connected||round!==this.world.round)return;
      this.preparedRound=round;const me=this.peers.get(this.id);if(me)me.preparedRound=round;this.publishPresence();
      if(this.world.phase==='playing')void this.begin();
    }catch(e){this.mapLoadError(e);}finally{this.preparingRound='';}
  }
  private async launchRound(){
    if(this.launching)return;this.launching=true;
    try{
      this.world.phase='playing';this.world.startAt=Date.now()+4500;this.world.endsAt=this.world.startAt+600000;
      await this.begin();if(!this.connected||!this.isHost)return;
      for(const id of this.remotes.keys())this.spawnRemote(id);this.broadcastWorld();this.publishPresence();
    }finally{this.launching=false;}
  }
  private spawnRemote(id:string){
    const b=this.remotes.get(id);if(!b)return;
    const s=this.g.bots.pickSpawn(b),index=classIndex(this.peers.get(id)?.loadout??0);
    b.loadoutIdx=index;b.loadout=LOADOUTS[index];b.def=WEAPONS[b.loadout.primary];b.life++;b.reserve=b.def.reserve;
    (b as any).nades=b.loadout.lethal;void b.puppet?.setWeapon(b.def);
    this.poseTargets.delete(id);this.shots.delete(id);b.spawnAt(s.pos,s.yaw+Math.PI);this.deathTimes.delete(id);
    this.send({kind:'spawn',to:id,p:s.pos.toArray(),yaw:s.yaw,life:b.life,loadout:index});
  }
  private applySpawn(p: {life:number;loadout:number;p:number[];yaw:number}) {
    if(!Number.isInteger(p.life)||p.life<=this.g.player.life||!p.p?.every(Number.isFinite))return;
    this.g.respawnPlayer(true,classIndex(p.loadout),p.life,{pos:vec(p.p),yaw:p.yaw});
  }
  private pose(e:any,id:string):Pose{return{id,name:e.name,p:[e.pos.x,e.feetY,e.pos.z].map(roundNumber),yaw:roundNumber(e===this.g.player?e.yaw+Math.PI:e.aimYaw),pitch:roundNumber(e===this.g.player?e.pitch:e.aimPitch),speed:roundNumber(e===this.g.player?e.speed:Math.hypot(e.vel.x,e.vel.z)),crouch:e===this.g.player?e.crouching:e.crouch,weapon:e===this.g.player?this.g.gunplay.def?.id:e.def.id,health:roundNumber(e.health),alive:e.alive,kills:e.kills,deaths:e.deaths,score:e.score,streak:e.streak,deathAt:this.deathTimes.get(id)||0,life:e.life||0,loadout:e.loadoutIdx||0,vehicle:this.g.vehicles.list.find(v=>v.driver===id)?.id};}
  private snapshot(){const count=Math.max(0,Math.min(this.world.bots,8-this.peers.size));return[this.pose(this.g.player,this.id),...[...this.remotes].map(([id,b])=>this.pose(b,id)),...this.g.bots.bots.slice(0,count).map(b=>this.pose(b,'bot-'+b.id))];}
  private broadcastWorld(){if(!this.isHost)return;this.world.seq=(this.world.seq||0)+1;if(this.world.phase==='playing'||this.world.phase==='ended'){this.world.entities=this.snapshot();this.world.vehicles=this.g.vehicles.snapshot();this.world.items=this.g.fieldItems.snapshot();}else{this.world.entities=[];this.world.vehicles=[];this.world.items=[];}this.send({kind:'world',world:this.world,events:this.events.slice(-12)});}
  private receive(from:string,data:any){
    if(data.kind==='voice'||data.kind==='voice-reset'||data.kind==='voice-renegotiate'||data.kind==='voice-audio'){void this.mic?.signal(from,data);return;}
    if(data.kind==='ping'){this.send({kind:'pong',to:from,t:data.t});return;}
    if(data.kind==='pong'&&data.to===this.id){this.ping=Date.now()-data.t;return;}
    if(data.kind==='world'&&from===this.hostId){this.lastHostPacket=Date.now();this.receiveWorld(data.world);for(const event of data.events||[])this.applyEvent(event);return;}
    if(data.kind==='class'){const p=this.peers.get(from);if(p)p.loadout=classIndex(data.loadout);this.render();return;}
    if(data.round!==this.world.round||!this.active||this.starting||this.g.mapChanging)return;
    if(data.kind==='vehicle-action'&&this.isHost&&this.active&&Date.now()>=this.world.startAt){if(data.action==='enter'||data.action==='exit'){this.g.vehicles.authorize(from,data.id,data.action);this.broadcastWorld();}return;}
    if(data.kind==='field-claim'&&this.isHost&&this.active){this.g.fieldItems.claim(from,data.id);this.broadcastWorld();return;}
    if(data.kind==='field-grant'&&from===this.hostId&&data.to===this.id){this.g.fieldItems.grant(data.id,data.health);return;}
    if(data.kind==='pose'&&this.isHost&&data.seq>(this.lastPoseSeq.get(from)||0)){
      this.lastPoseSeq.set(from,data.seq);const p=data.pose as Pose;
      if(!p?.p?.every(Number.isFinite)||p.p.length!==3||Math.abs(p.p[0])>this.g.map.bounds+2||Math.abs(p.p[2])>this.g.map.bounds+2||p.p[1]<-10||p.p[1]>45)return;
      const e=this.entity(from);if(!e||p.life!==e.life||!e.alive||!p.alive)return;
      if(![p.yaw,p.pitch,p.speed].every(Number.isFinite))return;
      p.id=from;this.poseTargets.set(from,p);if(this.isHost&&data.vehicle)this.g.vehicles.receiveFrame(from,data.vehicle);return;
    }
    if(data.kind==='fire'){
      if(this.isHost)this.registerShot(from,data);
      this.remoteFire(from,data.weapon,data.p,data.d);return;
    }
    if(data.kind==='hit'&&this.isHost){this.validateHit(from,data);return;}
    if(data.kind==='grenade'&&this.isHost&&this.active&&this.entity(from)?.alive){const e=this.entity(from);if((e as any).nades>0&&Array.isArray(data.vel)&&data.vel.every(Number.isFinite)){(e as any).nades--;this.g.grenades.throw(e.eyePos.clone(),vec(data.vel).clampLength(0,30),clamp(data.fuse,.1,4),e);}return;}
    if(data.kind==='spawn'&&from===this.hostId&&data.to===this.id){this.applySpawn(data);return;}
    if(data.kind==='bot-fire'&&from===this.hostId){this.remoteFire(data.id,data.weapon,data.p,data.d);return;}
    if(data.kind==='explosion'&&from===this.hostId&&!this.isHost){const p=vec(data.p);this.g.effects.explosion(p);this.g.audio.explosion(p,p.distanceTo(this.g.player.pos));return;}
    if(data.kind==='airstrike'&&this.isHost){const e=this.entity(from);if(e?.alive&&e.streak>=5&&!(e as any).airUsed){(e as any).airUsed=true;this.airstrike(vec(data.p),vec(data.d),e);}return;}
  }
  private receiveWorld(world:World){
    if(this.isHost||!world||!Array.isArray(world.entities))return;
    const fresh=world.round!==this.world.round,previousPhase=this.world.phase;
    // Presence is a recovery snapshot, never allowed to rewind the live topic stream.
    if(fresh&&world.startAt<this.world.startAt)return;
    if(!fresh&&this.worldHost===this.hostId&&(world.seq||0)<=(this.world.seq||0))return;
    if(fresh){this.poseTargets.clear();this.deathTimes.clear();this.lastPoseSeq.clear();this.received.clear();}
    this.worldHost=this.hostId;this.world=world;this.render();
    if(world.phase==='loading'){if(this.preparedRound!==world.round)void this.prepareMap();return;}
    if(world.phase==='playing'&&(fresh||previousPhase!=='playing'||this.g.state==='menu')){void this.begin();return;}
    if(!this.starting&&world.phase!=='lobby')this.applyWorld(world);
    if(world.phase==='ended'&&this.g.state!=='ended'){this.g.match.over=true;this.g.showEndScreen();}
  }
  private applyWorld(world:World){
    if(world.vehicles)this.g.vehicles.apply(world.vehicles);if(world.items)this.g.fieldItems.apply(world.items);
    const activeBots=new Set(world.entities.filter(p=>p.id.startsWith('bot-')).map(p=>p.id));
    for(const b of this.g.bots.bots)if(!activeBots.has('bot-'+b.id)){this.poseTargets.delete('bot-'+b.id);b.alive=false;for(const c of[b.collider,b.hitHead,b.hitBody,b.hitLegs])c.setEnabled(false);b.puppet?.setVisible(false);}
    for(const p of world.entities){
      const e=this.entity(p.id);if(!e)continue;
      if(p.id===this.id){
        if(p.life<e.life)continue;
        if(p.alive)this.applySpawn({...p,yaw:p.yaw-Math.PI});
        if(e.alive&&!p.alive)e.takeDamage(999,null,'body','');
        e.health=p.health;e.alive=p.alive;
      }else{this.poseTargets.set(p.id,p);e.health=p.health;e.alive=p.alive;e.life=p.life;e.loadoutIdx=classIndex(p.loadout);if(p.alive&&e.state==='dead')e.state='patrol';e.puppet?.setVisible(this.active&&(p.alive||!!p.deathAt&&Date.now()-p.deathAt<3500));}
      e.kills=p.kills;e.deaths=p.deaths;e.score=p.score;e.streak=p.streak;
      if(p.deathAt)this.deathTimes.set(p.id,p.deathAt);else this.deathTimes.delete(p.id);
    }
    this.g.match.timeLeft=Math.max(0,(world.endsAt-Date.now())/1000);
  }
  update(dt:number){
    if(!this.connected)return;const now=Date.now();
    if(this.world.phase==='loading'&&this.isHost&&this.preparedRound===this.world.round&&[...this.peers.values()].every(p=>p.preparedRound===this.world.round)&&this.pending.size===0&&!this.launching)void this.launchRound();
    if(this.g.mapChanging||this.starting||this.world.phase==='loading'){if(now-this.lastPresence>1000){this.lastPresence=now;this.publishPresence();this.render();}return;}
    this.g.bots.extraTargets=this.targets;
    if(this.active&&this.isHost){
      const count=Math.max(0,Math.min(this.world.bots,8-this.peers.size));
      this.g.bots.bots.forEach((b,i)=>{if(i>=count){if(b.alive)b.die();b.respawnT=1e9;b.puppet?.setVisible(false);}else if(!b.alive&&b.respawnT>100)b.respawnT=.1;});
      for(const [id,e]of [[this.id,this.g.player],...[...this.remotes]] as [string,any][]){
        if(!e.alive&&(this.deathTimes.get(id)||Infinity)<now-4500){if(id===this.id){this.g.respawnPlayer();this.shots.delete(id);this.deathTimes.delete(id);}else this.spawnRemote(id);(e as any).nades=LOADOUTS[e.loadoutIdx||0].lethal;(e as any).airUsed=false;}
        if(e.alive&&now-(this.hurtTimes.get(id)||0)>4200)e.health=Math.min(100,e.health+dt*38);
      }
      this.g.match.timeLeft=Math.max(0,(this.world.endsAt-now)/1000);
      if(now>=this.world.endsAt)this.finish();
    }
    for(const [id,p]of this.poseTargets){
      if(id===this.id)continue;const e=this.entity(id) as Bot;if(!e)continue;
      const y=p.p[1]+(p.crouch?.56:.9),t=1-Math.exp(-dt*18);const dest=new THREE.Vector3(p.p[0],y,p.p[2]);
      if(e.pos.distanceTo(dest)>6)e.pos.copy(dest);else e.pos.lerp(dest,t);
      const riding=this.g.vehicles.list.some(v=>v.driver===id);
      if(e.crouch!==p.crouch||(e as any).riding!==riding){
        (e as any).riding=riding;e.crouch=p.crouch;e.stance=p.crouch;
        e.collider.setHalfHeight(riding?.16:p.crouch?.2:.54);e.collider.setTranslationWrtParent({x:0,y:riding?-.17:0,z:0});
        e.hitHead.setTranslationWrtParent({x:0,y:riding?.16:p.crouch?.43:.66,z:0});e.hitBody.setTranslationWrtParent({x:0,y:riding?-.22:p.crouch?.08:.2,z:0});
      }
      e.aimYaw=p.yaw;e.aimPitch=p.pitch;e.yaw=p.yaw;e.vel.set(Math.sin(p.yaw)*p.speed,0,Math.cos(p.yaw)*p.speed);
      for(const c of[e.collider,e.hitHead,e.hitBody,e.hitLegs])if(c.isEnabled()!==(e.alive&&this.active))c.setEnabled(e.alive&&this.active);
      e.body.setTranslation(e.pos,true);e.body.setNextKinematicTranslation(e.pos);
      if(WEAPONS[p.weapon]&&e.def.id!==p.weapon){e.def=WEAPONS[p.weapon];void e.puppet?.setWeapon(e.def);}
      e.puppet?.setVisible((this.active||this.world.phase==='ended')&&(e.alive||now-(this.deathTimes.get(id)||0)<3500));
      if(!e.puppet?.model.visible)continue;
      e.puppet?.update(dt,{pos:e.pos,feetY:e.feetY,yaw:p.yaw,aimYaw:p.yaw,aimPitch:p.pitch,speed:p.speed,crouch:p.crouch,riding,alive:e.alive,deathT:(now-(this.deathTimes.get(id)||now))/1000});
    }
    if(this.active&&now-this.lastSend>66){this.lastSend=now;if(this.isHost)this.broadcastWorld();else this.send({kind:'pose',seq:++this.poseSeq,pose:this.pose(this.g.player,this.id),vehicle:this.g.vehicles.snapshot().find(v=>v.driver===this.id)});}
    if(now-this.lastPresence>1500){this.lastPresence=now;this.publishPresence();this.render();}
    if(now-this.lastPing>2500){this.lastPing=now;if(!this.isHost)this.send({kind:'ping',t:now});}
    if(this.active&&!this.isHost&&now-this.lastHostPacket>6000){el('online-status').textContent='HOST CONNECTION INTERRUPTED';this.g.gunplay.blockFire=true;}else if(this.active)this.g.gunplay.blockFire=this.g.airTargeting;
  }
  vehicleAction(id:number,action:'enter'|'exit'){
    if(!this.active||Date.now()<this.world.startAt)return;
    if(this.isHost){this.g.vehicles.authorize(this.id,id,action);this.broadcastWorld();}else this.send({kind:'vehicle-action',id,action});
  }
  vehicleImpact(id:number,target:any,amount:number,from:THREE.Vector3){
    const v=this.g.vehicles.list[id],driver=v&&this.entity(v.driver);
    if(!this.isHost||!this.active||Date.now()<this.world.startAt||!driver?.alive||!target?.alive||driver===target)return false;
    const driverId=v.driver,point=target.pos.toArray(),killed=this.damage(this.entityId(target),driverId,amount,'body',VEHICLE_WEAPON,from);
    this.emit({kind:'vehicle-hit',from:driverId,p:point,killed});return killed;
  }
  fieldClaim(id:number){if(this.isHost){this.g.fieldItems.claim(this.id,id);this.broadcastWorld();}else this.send({kind:'field-claim',id});}
  fieldGrant(to:string,id:number,health:number){this.send({kind:'field-grant',to,id,health});}
  localShot(){
    const d=this.g.gunplay.def,seq=++this.shotSeq;for(const b of this.g.bullets.list)if(b.owner===this.g.player&&b.age===0)(b as any).seq=seq;
    const packet={kind:'fire',weapon:d.id,seq,p:this.g.player.eyePos.toArray(),d:this.g.player.forward.toArray()};if(this.isHost)this.registerShot(this.id,packet);this.send(packet);
  }
  private registerShot(id:string,data:any){const e=this.entity(id),def=WEAPONS[data.weapon];if(!this.active||Date.now()<this.world.startAt||!e?.alive||!def)return;const old=this.shots.get(id),now=Date.now();if(old&&(data.seq<=old.seq||now-old.at<60000/def.rpm*.7))return;const lo=LOADOUTS[classIndex(e.loadoutIdx)];if(![lo.primary,lo.secondary].includes(def.id))return;this.shots.set(id,{seq:data.seq,at:now,weapon:def.id,remaining:def.pellets});}
  hit(h:EntityHit){
    if((h.bullet as any).visualOnly||!this.active)return;
    const from=this.entityId(h.bullet.owner),target=this.entityId(h.owner.entity);
    if(from===this.id){const data={kind:'hit',to:target,part:h.owner.part||'body',seq:(h.bullet as any).seq};if(this.isHost)this.validateHit(from,data);else this.send(data);this.g.hud.hitmarker('hit');this.g.audio.hitmarker(data.part==='head');}
    else if(this.isHost&&from.startsWith('bot-')){const d=h.bullet.def,part=h.owner.part||'body';const damage=d.damage*lerp(1,d.falloffMin,smoothstep(d.falloffStart,d.falloffEnd,h.bullet.traveled))*(part==='head'?d.headMul:part==='legs'?d.legMul:1)*h.bullet.dmgMul;this.damage(target,from,damage,part,d.name);}
  }
  private validateHit(from:string,data:any){
    const shot=this.shots.get(from),target=this.entity(data.to),attacker=this.entity(from);
    if(!shot||shot.seq!==data.seq||shot.remaining<=0||Date.now()-shot.at>2500||!target?.alive||!attacker?.alive||from===data.to)return;
    const def=WEAPONS[shot.weapon],distance=attacker.pos.distanceTo(target.pos);if(distance>def.range+3)return;
    if(!this.g.physics.clearLine(attacker.eyePos,target.eyePos)&&!this.g.physics.clearLine(attacker.eyePos,target.pos))return;
    shot.remaining--;const part=data.part==='head'?'head':data.part==='legs'?'legs':'body';
    this.damage(data.to,from,def.damage*lerp(1,def.falloffMin,smoothstep(def.falloffStart,def.falloffEnd,distance))*(part==='head'?def.headMul:part==='legs'?def.legMul:1),part,def.name);
  }
  private damage(targetId:string,attackerId:string,amount:number,part:string,weapon:string,from?:THREE.Vector3){
    if(!this.isHost||!this.active||Date.now()<this.world.startAt)return false;
    const target=this.entity(targetId),attacker=this.entity(attackerId);if(!target?.alive||!Number.isFinite(amount))return false;
    this.hurtTimes.set(targetId,Date.now());
    const killed=(target.applyDamage||target.takeDamage.bind(target))(clamp(amount,0,250),attacker,part,weapon,from||attacker?.pos);
    this.emit({kind:'hurt',to:targetId,from:attackerId,health:target.health,amount,part});return killed;
  }
  onKill(killer:any,victim:any,weapon:string,headshot:boolean){
    if(!this.isHost||!this.active)return;
    const id=this.entityId(victim);this.deathTimes.set(id,Date.now());
    if(killer&&killer!==victim){killer.kills++;killer.streak++;killer.score+=headshot?150:100;}
    this.emit({kind:'kill',killer:this.entityId(killer),victim:id,killerName:killer?.name||'Modern Singularity 2',victimName:victim.name,weapon,headshot});
    if(killer?.kills>=this.world.limit)this.finish();
  }
  private emit(event:any){const e={...event,eventId:crypto.randomUUID()};this.events.push(e);this.events=this.events.slice(-20);this.applyEvent(e);this.broadcastWorld();}
  private applyEvent(e:any){if(this.received.has(e.eventId))return;this.received.add(e.eventId);if(this.received.size>500)this.received.delete(this.received.values().next().value!);
    if(e.kind==='vehicle-hit')this.g.vehicles.impactFeedback(e.from,vec(e.p),e.killed);
    if(e.kind==='hurt'&&e.to===this.id&&!this.isHost){this.g.onPlayerDamaged(e.amount,this.entity(e.from)?.pos||null);}
    if(e.kind==='kill'){
      this.g.hud.feed(clean(e.killerName),clean(e.victimName),e.weapon,e.headshot,e.killer===this.id?'killer':e.victim===this.id?'victim':null);
      if(e.victim===this.id&&!this.g.player.alive)this.g.hud.showRespawn(clean(e.killerName),e.weapon);
      if(e.killer===this.id){this.g.hud.hitmarker('kill');this.g.audio.killConfirm();this.g.hud.centerMsg(e.weapon===VEHICLE_WEAPON?'ROADKILL':e.headshot?'HEADSHOT':'ELIMINATION',e.headshot?'+150':'+100');this.g.bestStreak=Math.max(this.g.bestStreak,this.g.player.streak);if(this.g.player.streak>=3)this.g.uavReady=true;if(this.g.player.streak>=5)this.g.airReady=true;}
    }
  }
  botShot(b:Bot,pos:THREE.Vector3){if(this.isHost)this.send({kind:'bot-fire',id:'bot-'+b.id,weapon:b.def.id,p:pos.toArray(),d:[Math.sin(b.aimYaw)*Math.cos(b.aimPitch),Math.sin(b.aimPitch),Math.cos(b.aimYaw)*Math.cos(b.aimPitch)]});}
  private remoteFire(id:string,weapon:string,p:number[],d:number[]){const def=WEAPONS[weapon],e=this.entity(id);if(!def||!e||!p?.every(Number.isFinite)||!d?.every(Number.isFinite))return;const pos=vec(p),dir=vec(d);this.g.effects.muzzleFlashWorld(pos,dir,def.flashScale);this.g.audio.play3D(def.sounds.far,pos,{vol:.8,ref:6,rolloff:.9});this.g.bullets.fire(def,pos,dir,e);(this.g.bullets.list.at(-1) as any).visualOnly=true;}
  grenade(pos:THREE.Vector3,velocity:THREE.Vector3,fuse:number){if(this.isHost)this.g.grenades.throw(pos,velocity,fuse,this.g.player);else this.send({kind:'grenade',vel:velocity.toArray(),fuse});}
  explosion(pos:THREE.Vector3){if(this.isHost)this.send({kind:'explosion',p:pos.toArray()});}
  airstrike(pos:THREE.Vector3,dir:THREE.Vector3,owner:any=this.g.player){if(!this.isHost){this.send({kind:'airstrike',p:pos.toArray(),d:dir.toArray()});return;}for(let i=0;i<5;i++)setTimeout(()=>{if(!this.active)return;const p=pos.clone().addScaledVector(dir,(i-1)*7);this.g.grenades.explodeAt(p,owner,this.victims,9.5,200,'AIRSTRIKE');},2300+i*170);}
  finish(){if(!this.isHost||this.world.phase==='ended')return;this.world.phase='ended';this.broadcastWorld();this.publishPresence();this.g.match.over=true;this.g.showEndScreen();this.render();}
  leave(){if(this.g.vehicles.current)this.vehicleAction(this.g.vehicles.current.id,'exit');this.g.vehicles.release(this.id);this.g.vehicles.detach();this.connected=false;this.mic?.destroy();this.unsubs.forEach(fn=>fn());this.unsubs=[];this.room?.leaveRoom();this.db?.shutdown();this.room=undefined;for(const b of this.remotes.values())this.disposeRemote(b);this.remotes.clear();this.peers.clear();this.poseTargets.clear();this.g.bots.extraTargets=[];this.g.player.regenDelay=4.2;this.g.showMenu();this.world.phase='lobby';el('join-fields').classList.remove('hidden');el('lobby-session').classList.add('hidden');el('online-bar').classList.add('hidden');el('lobby').classList.add('hidden');el('map-transition').classList.add('hidden');this.preparedRound='';this.worldHost='';this.hostId='';this.ready=false;this.lastRoster='';this.world={round:'',map:this.g.mapId,phase:'lobby',startAt:0,endsAt:0,limit:20,bots:4,entities:[]};}
}
