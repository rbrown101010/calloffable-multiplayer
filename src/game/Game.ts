import { Killstreaks } from './Killstreaks';
import { DeathReplay } from './DeathReplay';
import { Vehicles, VEHICLE_WEAPON } from './Vehicles';
import { FieldItems } from './FieldItems';
import { SableMap } from './SableMap';
import { Online } from './Online';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Physics, G } from './Physics';
import { Input } from './Input';
import { AudioManager } from './Audio';
import { RustMap } from './Map';
import { Player } from './Player';
import { Effects } from './Effects';
import { ViewModel, Bullets, Gunplay, VIEW_LAYER, loadWeaponModel, GunEvent, EntityHit } from './Weapons';
import { WEAPONS, LOADOUTS, Loadout, WeaponDef } from './WeaponDefs';
import { BotManager, Bot } from './Bots';
import { HUD, ScoreRow } from './HUD';
import { Grenades } from './Grenades';
import { setMaxAnisotropy } from './Materials';
import { setupPost, PostFX } from './Post';
import { SoldierPuppet } from './Puppet';
import { Voice } from './Voice';
import { clamp, el, lerp, smoothstep, DEG, fmtTime, pick } from './util';

const SOUND_NAMES = ['shot_bolt3_near', 'shot_bolt3_far', 'shot_bolt4_near', 'shot_ar_near', 'shot_ar_far', 'shot_ak_near', 'shot_ak_far', 'shot_smg_near', 'shot_smg_far', 'shot_smg2_near', 'shot_bolt_near', 'shot_bolt_far', 'shot_bolt2_near', 'shot_pistol_near', 'shot_pistol_far', 'shot_pistol2_near', 'shot_shotgun_near', 'shot_shotgun_far', 'shot_dmr_near', 'reload_pistol', 'reload_rifle', 'shotgun_pump', 'step_sandl1', 'step_sandl2', 'step_sandl3', 'step_sandr1', 'step_sandr2', 'step_sandr3', 'step_stonel1', 'step_stonel2', 'step_stonel3', 'step_stoner1', 'step_stoner2', 'step_stoner3'];
const SOUNDS: Record<string, string> = Object.fromEntries(SOUND_NAMES.map((n) => [n, `/sounds/${n}.mp3`]));
const BOT_NAMES = ['GHOST', 'ROACH', 'SOAP', 'PRICE', 'MEAT', 'ROYCE', 'OZONE'];
const BOT_SKILL = [0.55, 0.72, 0.88, 0.8, 0.5, 0.66, 0.76];
const MATCH_TIME = 600;
const weaponPreview=(id:string)=>`<img class="weapon-preview" src="/images/weapons/${({scarScout:'scarh',akSupport:'ak47',mp5Recon:'mp5'} as Record<string,string>)[id]||id}.png" alt="${WEAPONS[id].name}" width="640" height="210"/>`;

export type MapId = 'sable' | 'rust';
type Arena = { map:RustMap;vehicles:Vehicles;items:FieldItems;colliders:number[] };
type State = 'loading' | 'menu' | 'playing' | 'paused' | 'ended' | 'killcam';
interface SnapEnt { x: number; y: number; z: number; feetY: number; yaw: number; aimYaw: number; aimPitch: number; alive: boolean; speed: number; }
interface Snap { t: number; p: SnapEnt & { eyeY: number; pitch: number; ads: number }; b: SnapEnt[]; }
interface KillcamState { t0: number; t1: number; t: number; killer: any; victim: any; weapon: string; deathT: Map<any, number>; shotIdx: number; camIsPlayer: boolean; swappedWeapon: boolean; hitDone: boolean; }
interface Stats { name: string; kills: number; deaths: number; score: number; streak: number; }

export class Game {
  renderer!: THREE.WebGLRenderer; scene = new THREE.Scene(); camera!: THREE.PerspectiveCamera; weaponCam!: THREE.PerspectiveCamera;
  physics!: Physics; input!: Input; audio!: AudioManager; map!: RustMap; player!: Player; vm!: ViewModel; gunplay!: Gunplay; bullets!: Bullets; effects!: Effects; bots!: BotManager; hud!: HUD; grenades!: Grenades; post!: PostFX; sun!: THREE.DirectionalLight;
  vehicles!: Vehicles; fieldItems!: FieldItems;
  online!: Online; mapName = 'SABLE REACH';
  deathReplay!:DeathReplay;killstreaks!:Killstreaks;
  state: State = 'loading'; loadoutIdx = 0; time = 0; clock = new THREE.Clock();
  match = { timeLeft: MATCH_TIME, over: false };
  respawnT = 0; playerLastShot = -9; botLastShot = new Map<Bot, number>(); bestStreak = 0; stepSide = 0;
  settings = { sens: 1, adsSens: 1, graphics: 'auto' as 'auto' | 'quality', fov: 90, vol: 0.8, scale: Math.min(devicePixelRatio, 1.5), adsToggle: false, wind: 1, control: 'mouse' as 'mouse' | 'trackpad', difficulty: 'regular' as 'recruit' | 'regular' | 'veteran', scoreLimit: 10 };
  snaps: Snap[] = []; shotLog: { t: number; owner: any }[] = []; lastKill: { t: number; killer: any; victim: any; weapon: string; headshot: boolean } | null = null; kc: KillcamState | null = null;
  voice!: Voice; killTimes: number[] = []; wasLeader = false;
  playerPuppet: SoldierPuppet | null = null; sunDir = new THREE.Vector3(0.5, 0.7, 0.3); snapIdx = 0;
  countdown = 0; countdownShown = 9; uavUntil = -1; airTargeting = false; warn60 = false; warn30 = false; matchPointShown = false;
  params = new URLSearchParams(location.search);
  nolock = this.params.has('nolock'); god = this.params.has('god');
  menuAngle = 1.05;
  mapChanging=false;private arenas=new Map<MapId,Arena>();
  private skies=new Map<MapId,{tex:THREE.DataTexture;env:THREE.Texture;sunDir:THREE.Vector3}>();
  get mapId():MapId { return this.mapName==='RUST'?'rust':'sable'; }
  private classReturnToLobby = false;
  private shadowTimer = 0; private adaptiveTime = 0; private adaptiveFrames = 0; private resolutionCooldown = 0; private snapTimer = 0; private minimapTimer = 0;
  private _v = new THREE.Vector3(); private _v2 = new THREE.Vector3();

  // ------------------------------------------------------------------ boot
  async boot() {
    const setLoad = (p: number, t: string) => { el('ld-fill').style.width = `${Math.round(p * 100)}%`; el('ld-text').textContent = t; };
    setLoad(0.02, 'INITIALIZING RENDERER');
    this.loadSettings();
    this.setupRenderer();
    this.input = new Input(this.renderer.domElement); this.input.forceLocked = this.nolock;
    this.audio = new AudioManager(); this.audio.setVolume(this.settings.vol); this.voice = new Voice(this.audio);
    this.hud = new HUD();
    setLoad(0.06, 'STARTING PHYSICS');
    this.physics = await Physics.create();
    setLoad(0.1, 'LOADING SKY');
    this.mapName = this.params.get('map') === 'rust' ? 'RUST' : 'SABLE REACH';
    await this.setupSky();
    setLoad(0.16, 'LOADING SCANNED SCENERY');
    if(this.mapName!=='RUST')await SableMap.preload();
    setLoad(0.2, 'BUILDING ' + this.mapName);
    this.map = this.mapName === 'RUST' ? new RustMap(this.physics) : new SableMap(this.physics); this.scene.add(this.map.build());
    this.effects = new Effects(this.scene, this.physics, this.audio);
    this.player = new Player(this.physics, this.input, this.camera, this.map.ladders); this.scene.add(this.player.rig);
    this.player.adsSensitivity = this.settings.adsSens; this.player.sens = this.settings.sens; this.player.fovBase = this.settings.fov; this.player.fovCur = this.settings.fov;
    this.vm = new ViewModel(this.camera);
    this.bullets = new Bullets(this.scene, this.physics, this.effects, this.audio); this.bullets.onEntityHit = (h) => this.onEntityHit(h);
    this.gunplay = new Gunplay(this.player, this.input, this.vm, this.bullets, this.effects, this.audio, (e) => this.onGunEvent(e));
    this.grenades = new Grenades(this.scene, this.physics, this.effects, this.audio);
    this.grenades.onExplode = (pos, owner) => { const d = pos.distanceTo(this.player.eyePos); this.audio.explosion(pos, d); this.player.addShake(clamp(1.6 - d / 10, 0, 1.3)); if (d < 12) this.hud.flash(clamp(1 - d / 12, 0, 0.8)); this.bots.alert(pos, 60, owner, this.time); this.online?.explosion(pos); };
    setLoad(0.35, 'LOADING WEAPONS');
    let done = 0; const defs = Object.values(WEAPONS);
    await Promise.all(defs.map((d) => loadWeaponModel(d).then(() => { done++; setLoad(0.35 + 0.2 * done / defs.length, `LOADING WEAPONS ${done}/${defs.length}`); })));
    setLoad(0.55, 'DEPLOYING OPERATORS');
    this.bots = new BotManager(this.physics, this.scene, this.map, this.bullets, this.effects, this.audio, this.player, {
      onKill: (k, v, w, hs) => this.onKill(k, v, w, hs),
      onShot: (b, pos) => { this.deathReplay?.recordShot(b,b.def.id);this.online?.botShot(b,pos); this.botLastShot.set(b, this.time); this.bots.alert(pos, 40, b, this.time); if(!this.online?.connected)this.shotLog.push({ t: this.time, owner: b }); },
      onStep: (b, running) => {
        const hit = this.physics.raycast(new THREE.Vector3(b.pos.x, b.feetY + 0.3, b.pos.z), new THREE.Vector3(0, -1, 0), 1.5, G.WORLD); const surf = hit?.owner?.surface ?? 'sand';
        const stone = surf === 'metal' || surf === 'concrete' || surf === 'wood' || surf === 'rock';
        this.audio.play3D(`step_${stone ? 'stone' : 'sand'}${Math.random() < 0.5 ? 'l' : 'r'}${1 + Math.floor(Math.random() * 3)}`, new THREE.Vector3(b.pos.x, b.feetY, b.pos.z), { vol: running ? 0.9 : 0.55, rateVar: 0.08, ref: 3, rolloff: 1.35, max: 70, reverb: 0.2 });
      },
      onReload: (b) => { this.audio.play3D(b.def.cls === 'pistol' ? 'reload_pistol' : 'reload_rifle', b.eyePos.clone(), { vol: 0.7, ref: 3, rolloff: 1.3, max: 50 }); if (Math.random() < 0.5) this.voice.bot(b, 'reloading', b.eyePos.clone()); },
      onGrenade: (b, pos, vel, fuse) => { this.grenades.throw(pos, vel, fuse, b); this.voice.bot(b, 'frag', b.eyePos.clone(), 2); },
      onSpot: (b) => { if (Math.random() < 0.6) this.voice.bot(b, Math.random() < 0.5 ? 'contact' : 'spotted', b.eyePos.clone(), 7); },
      onHurt: (b) => { if (Math.random() < 0.35) this.voice.bot(b, 'taking_fire', b.eyePos.clone(), 6); },
    });
    await this.bots.create(BOT_NAMES, BOT_SKILL);
    for (const b of this.bots.bots) { b.onDeath = (att, w, hs) => this.onKill(att, b, w, hs); if (b.model) b.model.visible = false; }
    // the player's own body: casts a shadow in play, becomes visible in bot-perspective killcams
    this.playerPuppet = await SoldierPuppet.create(this.scene); await this.playerPuppet.setWeapon(WEAPONS.scarh); this.playerPuppet.equip(0); this.playerPuppet.setShadowOnly(true);
    this.killstreaks=new Killstreaks(this);this.deathReplay=new DeathReplay(this);await this.deathReplay.preload();
    this.grenades.onVictimHit = (victim, killed, owner) => { if (owner === this.player && victim !== this.player) { this.hud.hitmarker(killed ? 'kill' : 'hit'); this.audio.hitmarker(false); } };
    this.player.onStuck = () => {
      const cands = this.map.waypoints.filter((w) => w.links.length > 0).map((w) => ({ w, d: w.pos.distanceTo(this.player.pos) })).sort((a, b) => a.d - b.d);
      const pick = cands.find((c) => c.d > 0.8); if (pick) { this.player.teleport(pick.w.pos.clone()); this.hud.centerMsg('REPOSITIONED'); }
    };
    this.player.onDeath = (att, w, hs) => { this.onKill(att, this.player, w, hs); this.playerDied(att, w); };
    this.player.onDamage = (amount, from) => this.onPlayerDamaged(amount, from);
    this.player.onFootstep = (running) => this.footstep(running);
    this.player.onLand = (impact) => { if (impact > 0.15) { this.footstep(true, impact); this.hud.damage(0, null); } };
    setLoad(0.7, 'LOADING AUDIO');
    let manifest: Record<string, string> = { ...SOUNDS };
    try { const extra: string[] = await (await fetch('/sounds/manifest.json')).json(); for (const n of extra) manifest[n] = `/sounds/${n}.mp3`; } catch {}
    await this.audio.load(manifest, (d, t) => setLoad(0.7 + 0.2 * d / t, `LOADING AUDIO ${d}/${t}`));
    this.vehicles = new Vehicles(this); this.fieldItems = new FieldItems(this);
    const colliders:number[]=[];this.physics.world.forEachCollider(c=>{if((c.collisionGroups()>>>16)&(G.WORLD|G.VEHICLE))colliders.push(c.handle);});
    this.arenas.set(this.mapId,{map:this.map,vehicles:this.vehicles,items:this.fieldItems,colliders});
    setLoad(0.92, 'COMPOSITING');
    this.post = setupPost(this.renderer, this.scene, this.camera, this.weaponCam, { ao: !this.params.has('noao') });
    this.renderMinimapBase();
    this.setupUI();
    this.online = new Online(this);
    document.querySelectorAll('[data-map-name]').forEach(e => e.textContent=this.mapName);
    el<HTMLSelectElement>('map-select').value=this.params.get('map')==='rust'?'rust':'sable';
    el('map-select').addEventListener('change',()=>{const url=new URL(location.href);url.searchParams.set('map',el<HTMLSelectElement>('map-select').value);location.href=url.toString();});
    setLoad(1, 'READY');
    await new Promise((r) => setTimeout(r, 250));
    el('loading').classList.add('hidden');
    this.showMenu();
    window.addEventListener('resize', () => this.onResize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private setupRenderer() {
    const canvas = el<HTMLCanvasElement>('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: this.params.has('shot') });
    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap; this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NoToneMapping; this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    setMaxAnisotropy(Math.min(16, this.renderer.capabilities.getMaxAnisotropy()));
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.06, 900); this.camera.layers.set(0);
    this.weaponCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 30); this.weaponCam.layers.set(VIEW_LAYER);
  }

  private async setupSky(id:MapId=this.mapId) {
    let sky=this.skies.get(id);
    if(!sky){
      const tex=await new RGBELoader().setDataType(THREE.FloatType).loadAsync(id==='rust'?'/hdri/goegap_2k.hdr':'/hdri/rogland_sunset_2k.hdr');
      tex.mapping=THREE.EquirectangularReflectionMapping;
      const pmrem=new THREE.PMREMGenerator(this.renderer);pmrem.compileEquirectangularShader();
      sky={tex,env:pmrem.fromEquirectangular(tex).texture,sunDir:findSunDirection(tex)};pmrem.dispose();this.skies.set(id,sky);
    }
    const {tex,env,sunDir}=sky;
    this.scene.environment=env;this.scene.environmentIntensity=.65;this.scene.background=tex;this.scene.backgroundIntensity=.85;
    this.scene.fog=new THREE.FogExp2(0xcab49b,.003);this.sunDir.copy(sunDir);
    if(this.sun){this.renderer.shadowMap.needsUpdate=true;return;}
    // sun
    this.sun = new THREE.DirectionalLight(0xffe0b4, 2.7);
    this.sun.position.copy(sunDir).multiplyScalar(110); this.sun.target.position.set(0, 0, 0); this.scene.add(this.sun.target);
    this.sun.castShadow = true; const sc = this.sun.shadow; sc.mapSize.set(2048, 2048); sc.camera.near = 20; sc.camera.far = 220; sc.camera.left = -64; sc.camera.right = 64; sc.camera.top = 64; sc.camera.bottom = -64; sc.bias = -0.00035; sc.normalBias = 0.035; sc.radius = 1.6;
    this.sun.layers.enable(VIEW_LAYER); this.scene.add(this.sun);
    const hemi = new THREE.HemisphereLight(0xb1c4d5, 0x80634b, 0.8); hemi.layers.enable(VIEW_LAYER); this.scene.add(hemi);
    // The HDR sun and bloom stay compatible with the half-float post-processing buffer.
    this.sunDir.copy(sunDir);
  }

  /** Swap scenery and collision together without replacing players, the room, or voice connections. */
  async loadMap(id:MapId) {
    if(id===this.mapId)return;
    this.deathReplay?.reset();this.killstreaks?.reset();
    this.mapChanging=true;this.input.reset();this.input.unlock();this.vehicles.reset();
    try {
      if(id==='sable'&&!this.arenas.has(id))await SableMap.preload();
      await this.setupSky(id);
      this.bullets.clear();this.grenades.clear();this.effects.clear();
      this.vm.root.visible=false;this.playerPuppet?.setVisible(false);
      for(const b of [...this.bots.bots,...this.online.remotes.values()])b.puppet?.setVisible(false);
      const old=this.arenas.get(this.mapId)!;this.setArenaActive(old,false);
      this.mapName=id==='rust'?'RUST':'SABLE REACH';
      let arena=this.arenas.get(id);
      if(!arena){
        const before=new Set<number>();this.physics.world.forEachCollider(c=>before.add(c.handle));
        this.map=id==='rust'?new RustMap(this.physics):new SableMap(this.physics);this.scene.add(this.map.build());
        this.vehicles=new Vehicles(this);this.fieldItems=new FieldItems(this);
        const colliders:number[]=[];this.physics.world.forEachCollider(c=>{if(!before.has(c.handle))colliders.push(c.handle);});
        arena={map:this.map,vehicles:this.vehicles,items:this.fieldItems,colliders};this.arenas.set(id,arena);
      }
      this.map=arena.map;this.vehicles=arena.vehicles;this.fieldItems=arena.items;this.setArenaActive(arena,true);
      this.vehicles.reset();this.fieldItems.reset();this.player.setLadders(this.map.ladders);this.bots.setMap(this.map);
      this.player.teleport(this.map.spawns[0].pos);this.renderMinimapBase();this.playerPuppet?.setVisible(true);
      document.querySelectorAll('[data-map-name]').forEach(e=>e.textContent=this.mapName);
      el<HTMLSelectElement>('map-select').value=id;this.params.set('map',id);
      const url=new URL(location.href);url.searchParams.set('map',id);history.replaceState(null,'',url);
      this.physics.step(1/60);this.renderer.shadowMap.needsUpdate=true;
    } finally {this.mapChanging=false;}
  }
  private setArenaActive(arena:Arena,active:boolean) {
    arena.map.group.visible=active;
    for(const handle of arena.colliders)this.physics.world.getCollider(handle)?.setEnabled(active);
    for(const v of arena.vehicles.list)v.model.visible=active;
    for(const i of arena.items.list)i.model.visible=active;
  }

  // ------------------------------------------------------------------ UI
  private setupUI() {
    const list = el('loadouts'); list.innerHTML = '';
    LOADOUTS.forEach((lo, i) => {
      const d = document.createElement('button'); d.type='button'; d.setAttribute('aria-label',lo.name+' loadout'); d.className = 'lo' + (i === this.loadoutIdx ? ' sel' : '');
      d.innerHTML = `<div class="lo-num">${String(i+1).padStart(2,'0')}</div><div><div class="lo-name">${lo.name}</div><div class="lo-desc">${lo.desc}</div></div><div class="lo-tag">${lo.tag}</div><div class="loadout-guns">${weaponPreview(lo.primary)}${weaponPreview(lo.secondary)}</div>`;
      d.addEventListener('click', () => { this.selectLoadout(i); this.audio.uiClick(); });
      d.addEventListener('mouseenter', () => this.audio.uiHover());
      list.appendChild(d);
    });
    for (const [i, lo] of LOADOUTS.entries()) {
      const button = document.createElement('button'); button.className = 'lo'; button.dataset.classIndex = String(i);
      button.innerHTML = `<div class="lo-num">${String(i+1).padStart(2,'0')}</div><div><div class="lo-name">${lo.name}</div><div class="lo-desc">${WEAPONS[lo.primary].name} + ${WEAPONS[lo.secondary].name}</div></div><div class="lo-tag">${lo.tag}</div><div class="loadout-guns">${weaponPreview(lo.primary)}${weaponPreview(lo.secondary)}</div>`;
      button.onclick = () => { this.selectLoadout(i); this.audio.uiClick(); }; el('class-options').append(button);
    }
    el('class-done').onclick = () => this.closeClassPicker();
    el('class-close').onclick = () => this.closeClassPicker();
    el('lobby-class').onclick = () => this.openClassPicker();
    el('online-class').onclick = () => this.openClassPicker();
    this.renderLoadoutDetail(); this.updateClassUI();
    el('btn-deploy').addEventListener('click', () => {if(this.online?.connected)this.online.leave();void this.startMatch();});
    el('btn-resume').addEventListener('click', () => this.resume());
    el('btn-loadout').addEventListener('click', () => this.openClassPicker());
    el('btn-quit').addEventListener('click', () => { if(this.online?.connected)this.online.leave(); else this.endMatch(false, true); });
    el('btn-again').addEventListener('click', () => {if(this.online?.connected){el('lobby').classList.remove('hidden');}else this.showMenu();});
    const bind = (id: string, key: 'sens' | 'adsSens' | 'fov' | 'vol' | 'scale' | 'wind', fmt: (v: number) => string, apply: (v: number) => void) => {
      const inp = el<HTMLInputElement>(id), out = el(id + '-v'); inp.value = String(this.settings[key]); out.textContent = fmt(this.settings[key]);
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); (this.settings as any)[key] = v; out.textContent = fmt(v); apply(v); this.saveSettings(); });
    };
    bind('opt-sens', 'sens', (v) => v.toFixed(2), (v) => { this.player.sens = v; });
    bind('opt-ads-sens', 'adsSens', v=>v.toFixed(2), v=>{this.player.adsSensitivity=v;});
    bind('opt-fov', 'fov', (v) => v.toFixed(0), (v) => { this.player.fovBase = v; });
    bind('opt-vol', 'vol', (v) => v.toFixed(2), (v) => this.audio.setVolume(v));
    bind('opt-scale', 'scale', (v) => v.toFixed(2), (v) => { this.renderer.setPixelRatio(this.targetPixelRatio()); this.onResize(); });
    bind('opt-wind', 'wind', (v) => v.toFixed(2), (v) => this.audio.setWind(v));
    const graphics=el<HTMLSelectElement>('opt-graphics');graphics.value=this.settings.graphics;graphics.onchange=()=>{this.settings.graphics=graphics.value as 'auto'|'quality';this.renderer.setPixelRatio(this.targetPixelRatio());this.onResize();this.saveSettings();};
    const adsSel = el<HTMLSelectElement>('opt-ads'); adsSel.value = this.settings.adsToggle ? 'toggle' : 'hold';
    adsSel.addEventListener('change', () => { this.settings.adsToggle = adsSel.value === 'toggle'; this.gunplay.adsToggle = this.settings.adsToggle; this.saveSettings(); });
    this.gunplay.adsToggle = this.settings.adsToggle;
    // control scheme (mouse vs. trackpad) – buttons on the main menu and in the pause menu
    const applyControl = () => {
      const tp = this.settings.control === 'trackpad';
      document.querySelectorAll<HTMLElement>('[data-control]').forEach((b) => b.classList.toggle('sel', b.dataset.control === this.settings.control));
      document.querySelectorAll<HTMLElement>('.ctl-mouse').forEach((e) => e.classList.toggle('hidden', tp));
      document.querySelectorAll<HTMLElement>('.ctl-trackpad').forEach((e) => e.classList.toggle('hidden', !tp));
      this.gunplay.trackpad = tp; this.input.trackpad = tp;
      if (tp && !this.settings.adsToggle) { this.settings.adsToggle = true; this.gunplay.adsToggle = true; adsSel.value = 'toggle'; }
    };
    document.querySelectorAll<HTMLElement>('[data-control]').forEach((b) => b.addEventListener('click', () => { this.settings.control = b.dataset.control as 'mouse' | 'trackpad'; applyControl(); this.saveSettings(); this.audio.uiClick(); }));
    applyControl();
    const scoreInp = el<HTMLInputElement>('opt-score');
    const applyScore = () => { const n = this.settings.scoreLimit; el('opt-score-v').textContent = String(n); el('menu-sub').textContent = `7 ENEMIES · FIRST TO ${n} KILL${n > 1 ? 'S' : ''} · 10:00`; scoreInp.value = String(n); };
    scoreInp.addEventListener('input', () => { this.settings.scoreLimit = Math.max(1, Math.min(30, parseInt(scoreInp.value) || 10)); applyScore(); this.saveSettings(); });
    applyScore();
    const applyDiff = () => { document.querySelectorAll<HTMLElement>('[data-diff]').forEach((b) => b.classList.toggle('sel', b.dataset.diff === this.settings.difficulty)); this.bots.setDifficulty(this.settings.difficulty); };
    document.querySelectorAll<HTMLElement>('[data-diff]').forEach((b) => b.addEventListener('click', () => { this.settings.difficulty = b.dataset.diff as any; applyDiff(); this.saveSettings(); this.audio.uiClick(); }));
    applyDiff();
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.matches('input,textarea,select'))return;
      if (!el('class-picker').classList.contains('hidden')) { if(e.code==='Escape'||e.code==='Enter')this.closeClassPicker(); else if(/^Digit[0-9]$/.test(e.code))this.selectLoadout((parseInt(e.code[5])+9)%10); return; }
      if (!el('lobby').classList.contains('hidden'))return;
      if(e.code==='KeyL'&&(this.state==='playing'||this.state==='paused')){this.openClassPicker();return;}
      if (this.state === 'menu') { if (e.code === 'Enter') this.startMatch(); if (/^Digit[0-9]$/.test(e.code)) this.selectLoadout((parseInt(e.code[5]) + 9) % 10); }
      else if (this.state === 'paused' && e.code === 'Enter') this.resume();
      else if (this.state === 'ended' && e.code === 'Enter'&&!this.deathReplay?.active) { if(this.online?.connected)el('lobby').classList.remove('hidden');else this.showMenu(); }
    });
    el('capture-pointer').onclick=()=>this.input.lock();
    this.renderer.domElement.addEventListener('mousedown',()=>{if(this.state==='playing'&&!this.nolock&&!this.input.locked)this.input.lock();});
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'playing' && !this.nolock) this.pause(); };
    window.addEventListener('mousedown', () => { this.audio.unlock(); });
  }
  private selectLoadout(i: number) { if(!Number.isInteger(i)||!LOADOUTS[i])return; this.loadoutIdx = i; document.querySelectorAll('#loadouts .lo').forEach((e, k) => e.classList.toggle('sel', k === i)); this.renderLoadoutDetail(); this.updateClassUI(); this.online?.selectClass(i); }
  openClassPicker() {
    this.deathReplay?.stop();
    this.classReturnToLobby = !el('lobby').classList.contains('hidden');
    if(this.state==='playing')this.pause();
    this.input.unlock();this.input.reset();
    el('pause').classList.add('hidden');el('class-picker').classList.remove('hidden');this.updateClassUI();
  }
  closeClassPicker() {
    el('class-picker').classList.add('hidden');this.input.reset();
    if(!this.classReturnToLobby)this.resume();
  }
  updateClassUI() {
    const active=this.state==='playing'||this.state==='paused';
    const current=LOADOUTS[this.player?.loadoutIdx||0], next=LOADOUTS[this.loadoutIdx];
    el('class-status').textContent=active ? `CURRENT: ${current.name} · NEXT SPAWN: ${next.name}` : `SELECTED: ${next.name}`;
    el('class-note').textContent=active ? 'Your new class equips automatically on your next respawn. You stay in this match and keep your score. The match continues while this menu is open.' : 'Choose a class, return to the lobby, then ready up. Both weapons and grenades are included.';
    el('class-done').textContent=this.classReturnToLobby?'BACK TO LOBBY':active?'RETURN TO MATCH':'DONE';
    document.querySelectorAll<HTMLElement>('[data-class-index]').forEach(b=>{const selected=Number(b.dataset.classIndex)===this.loadoutIdx;b.classList.toggle('sel',selected);b.setAttribute('aria-pressed',String(selected));});
    el('lobby-class').textContent='CLASS · '+next.name+' · CHANGE';
  }
  private renderLoadoutDetail() {
    const lo = LOADOUTS[this.loadoutIdx]; const p = WEAPONS[lo.primary], s = WEAPONS[lo.secondary];
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></b></i><span>${Math.round(clamp(v, 0, 1) * 100)}</span></div>`;
    const dmg = clamp(p.damage * p.pellets / 130, 0, 1), rof = clamp(p.rpm / 900, 0, 1), rng = clamp(p.falloffEnd / 90, 0, 1), mob = clamp((p.speedMul - 0.8) / 0.25, 0, 1), acc = clamp(1 - (p.adsSpread + p.hipSpread * 0.08), 0, 1);
    el('loadout-detail').innerHTML = `<div class="eyebrow">${lo.tag}</div><h3>${lo.name}</h3>
      ${weaponPreview(lo.primary)}<div class="ld-row"><span>PRIMARY</span><span>${p.name}</span></div>${weaponPreview(lo.secondary)}<div class="ld-row"><span>SECONDARY</span><span>${s.name}</span></div><div class="ld-row"><span>LETHAL</span><span>FRAG GRENADE ×${lo.lethal}</span></div>
      <div style="margin-top:14px">${bar('DAMAGE', dmg)}${bar('FIRE RATE', rof)}${bar('RANGE', rng)}${bar('MOBILITY', mob)}${bar('ACCURACY', acc)}</div>
      <div class="ld-row" style="margin-top:14px;border:0"><span>MAG</span><span>${p.mag} / ${p.reserve}</span></div>`;
  }
  private loadSettings() { try { const s = JSON.parse(localStorage.getItem('rust_settings') || '{}'); Object.assign(this.settings, s); } catch {} }
  private saveSettings() { try { localStorage.setItem('rust_settings', JSON.stringify(this.settings)); } catch {} }

  showMenu() {
    this.deathReplay?.reset();this.killstreaks?.reset();
    this.vehicles?.release(this.vehicles.self);this.vehicles?.detach();
    el('class-picker').classList.add('hidden');this.input.reset();this.audio.setWind(0);this.bullets.clear();this.grenades.clear();
    this.state = 'menu'; el('menu').classList.remove('hidden'); el('pause').classList.add('hidden'); el('end').classList.add('hidden'); this.hud.hide();
    this.vm.root.visible = false; this.input.unlock(); this.kc = null; this.hud.hideKillcam(); this.playerPuppet?.setShadowOnly(true);
    for (const b of this.bots.bots) { if (b.alive) b.die(); b.puppet?.setVisible(false); b.respawnT = 1e9; }
  }

  // ------------------------------------------------------------------ match flow
  async startMatch() {
    if (this.state === 'playing') return;
    this.deathReplay?.reset();this.killstreaks?.reset();
    if(!this.nolock)this.input.lock();
    this.audio.unlock(); this.audio.startWind(); this.audio.setWind(this.settings.wind);
    el('menu').classList.add('hidden'); el('end').classList.add('hidden'); el('pause').classList.add('hidden');
    this.bullets.clear();this.grenades.clear();this.vehicles.reset();this.fieldItems.reset();
    this.match.timeLeft = MATCH_TIME; this.match.over = false; this.bestStreak = 0;
    const P = this.player; P.kills = 0; P.deaths = 0; P.score = 0; P.streak = 0;
    for (const b of this.bots.bots) { b.kills = 0; b.deaths = 0; b.score = 0; b.streak = 0; b.respawnT = 0; }
    this.player.life = 0;
    if(!this.online?.connected || this.online.isHost)this.bots.spawnAll();
    else for(const b of this.bots.bots){b.alive=false;for(const c of [b.collider,b.hitHead,b.hitBody,b.hitLegs])c.setEnabled(false);b.puppet?.setVisible(false);}
    (this.player as any).nades=LOADOUTS[this.loadoutIdx].lethal;
    this.respawnPlayer(true, this.loadoutIdx, this.online?.connected&&!this.online.isHost?0:1);
    this.hud.show(); this.hud.setLethal(this.gunplay.lethals); this.hud.setTimer(this.match.timeLeft); this.hud.setScores(0, 0);
    this.uavUntil = -1; this.airTargeting = false; this.gunplay.blockFire = false; this.warn60 = this.warn30 = this.matchPointShown = false;
    this.countdown = 3.999; this.countdownShown = 9; this.bots.frozen = true;
    this.snaps = []; this.shotLog = []; this.lastKill = null; this.kc = null; this.snapIdx = 0; this.playerPuppet?.setShadowOnly(true); this.killTimes = []; this.wasLeader = false;
    this.hud.centerMsg(`FIRST TO ${this.settings.scoreLimit} KILL${this.settings.scoreLimit > 1 ? 'S' : ''} WINS`);
    el('hp-name').textContent=this.player.name;
    this.state = 'playing'; if (!this.nolock) this.input.lock();
    this.hud.centerMsg('FREE-FOR-ALL', undefined, '');
  }
  private pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.input.reset(); el('pause-note').textContent=this.online?.connected?'MATCH MENU · Multiplayer continues':'PAUSED'; el('btn-quit').textContent=this.online?.connected?'LEAVE LOBBY':'END MATCH'; this.vehicles.silence(); el('pause').classList.remove('hidden'); this.hud.showScoreboard(false); }
  resume() { if (this.state !== 'paused') return; el('pause').classList.add('hidden');el('class-picker').classList.add('hidden');this.input.reset(); this.state = 'playing'; if (!this.nolock) this.input.lock(); }
  private endMatch(toMenu = false, skipKillcam = false) {
    if (toMenu) { this.showMenu(); return; }
    if (this.state === 'killcam' || this.state === 'ended') return;
    this.match.over = true; this.bots.frozen = true;
    if (!skipKillcam && this.lastKill && this.time - this.lastKill.t < 120 && this.snaps.length > 20 && !this.params.has('nokillcam')) { this.startKillcam(); return; }
    this.showEndScreen();
  }
  showEndScreen() {
    this.killstreaks?.exit();document.body.classList.remove('gunning');el('chopper-view').classList.add('hidden');
    this.vehicles?.release(this.vehicles.self);this.vehicles?.detach();
    el('class-picker').classList.add('hidden');
    this.state = 'ended'; this.input.unlock(); el('pause').classList.add('hidden'); this.hud.showScoreboard(false); this.hud.hideKillcam(); this.vm.root.visible = false;
    const rows = this.scoreRows(); const place = rows.findIndex((r) => r.me) + 1;
    el('end-eyebrow').textContent = 'MATCH OVER · FREE-FOR-ALL · '+this.mapName;
    el('btn-again').textContent=this.online?.connected?'RETURN TO LOBBY':'PLAY AGAIN';
    el('end-title').textContent = place === 1 ? 'VICTORY' : 'DEFEAT'; el('end-title').style.color = place === 1 ? '' : '#e63b2e';
    this.voice.announce(place === 1 ? 'victory' : 'defeat', 4, 0);
    const P = this.player; el('end-stats').innerHTML = `<div><b>${place}${['ST', 'ND', 'RD', 'TH'][Math.min(place - 1, 3)]}</b><span>PLACE</span></div><div><b>${P.kills}</b><span>KILLS</span></div><div><b>${P.deaths}</b><span>DEATHS</span></div><div><b>${(P.kills / Math.max(1, P.deaths)).toFixed(2)}</b><span>K/D</span></div><div><b>${this.bestStreak}</b><span>BEST STREAK</span></div>`;
    el('end-table').querySelector('tbody')!.innerHTML = rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="rank">${i + 1}</td><td class="l">${r.name}</td><td>${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${(r.kills / Math.max(1, r.deaths)).toFixed(2)}</td></tr>`).join('');
    el('end').classList.remove('hidden');
  }
  private scoreRows(): ScoreRow[] {
    const rows: ScoreRow[] = [{ name: this.player.name, score: this.player.score, kills: this.player.kills, deaths: this.player.deaths, streak: this.player.streak, me: true }];
    for(const b of this.online?.connected?[...this.bots.bots.slice(0,Math.max(0,Math.min(this.online.world.bots,this.online.world.maxPlayers-this.online.peers.size))),...this.online.remotes.values()]:this.bots.bots) rows.push({ name: b.name, score: b.score, kills: b.kills, deaths: b.deaths, streak: b.streak, me: false });
    return rows.sort((a, b) => b.score - a.score || a.deaths - b.deaths);
  }
  respawnPlayer(_first = false, loadout = this.loadoutIdx, life = this.player.life + 1, spawn?: {pos:THREE.Vector3;yaw:number}) {
    this.deathReplay?.stop();
    this.vehicles?.release(this.vehicles.self);this.vehicles?.detach();
    const index=LOADOUTS[loadout]?loadout:0;
    const s = spawn || this.bots.pickSpawn(this.player);
    this.input.reset();this.player.spawn(s.pos, s.yaw);this.player.loadoutIdx=index;this.player.life=life;
    this.gunplay.setLoadout(LOADOUTS[index]);(this.player as any).nades=LOADOUTS[index].lethal;
    this.hud.setLethal(this.gunplay.lethals);this.vm.root.visible=true;this.hud.hideRespawn();this.hud.setHealth(100,100);this.updateClassUI();
  }
  private playerDied(attacker: any, weapon: string) {
    this.vehicles?.release(this.vehicles.self);this.vehicles?.detach();
    this.hud.showRespawn(attacker && attacker !== this.player ? attacker.name : 'YOURSELF', weapon || ''); this.respawnT = 5; this.hud.setRespawnCount(5);
    this.vm.root.visible = false; this.audio.setLowHealth(0); this.gunplay.reloading = false; this.gunplay.cooking = false; this.gunplay.throwing = false; this.gunplay.bolting = false;
  }

  // ------------------------------------------------------------------ events
  private onGunEvent(e: GunEvent) {
    if (e.type === 'shot') { this.deathReplay?.recordShot(this.player,e.def.id);this.online?.connected && this.online.localShot(); this.playerLastShot = this.time; this.bots.alert(e.pos, 48, this.player, this.time); if(!this.online?.connected)this.shotLog.push({ t: this.time, owner: this.player }); }
    else if (e.type === 'ammo') { const s = this.gunplay.slot; if (s) this.hud.setAmmo(s.mag, s.reserve, s.def.mag, this.gunplay.reloading); }
    else if (e.type === 'switch') { const other = this.gunplay.slots[1 - this.gunplay.cur]; this.hud.setWeapon(e.def.name, modeLabel(e.def), other ? other.def.name : ''); this.playerPuppet?.setWeapon(e.def); }
    else if (e.type === 'grenade') { if(this.online?.connected)this.online.grenade(e.pos,e.vel,e.fuse);else this.grenades.throw(e.pos, e.vel, e.fuse, this.player); this.hud.setLethal(this.gunplay.lethals); this.audio.weaponSwitch(); this.voice.operator('frag', 2); }
    else if (e.type === 'reload') { if (this.player.alive) this.voice.operator('reload', 6); }
  }

  private onEntityHit(h: EntityHit) {
    if((h.bullet as any).visualOnly)return;
    if(this.online?.connected){this.online.hit(h);return;}
    const { bullet, point, normal, owner } = h; const def = bullet.def; const ent = owner.entity; if (!ent || !ent.alive) return;
    let part: string = owner.part ?? 'body';
    if (ent === this.player) part = point.y > this.player.eyePos.y - 0.2 ? 'head' : point.y < this.player.feetY + 0.8 ? 'legs' : 'body';
    const fall = smoothstep(def.falloffStart, def.falloffEnd, bullet.traveled);
    const dmg = def.damage * lerp(1, def.falloffMin, fall) * (part === 'head' ? def.headMul : part === 'legs' ? def.legMul : 1) * bullet.dmgMul;
    this.effects.blood(point, bullet.dir);
    const killed: boolean = (ent === this.player && this.god) ? false : ent.takeDamage(dmg, bullet.owner, part, def.name, bullet.owner?.pos ?? null);
    if (bullet.owner === this.player) { this.hud.hitmarker(killed ? 'kill' : part === 'head' ? 'head' : 'hit'); this.audio.hitmarker(part === 'head'); }
    void normal;
  }

  onPlayerDamaged(amount: number, from: THREE.Vector3 | null) {
    let angle: number | null = null;
    if (from) { const d = this._v.subVectors(from, this.player.pos); const f = this.player.flatForward, r = this.player.flatRight; angle = Math.atan2(d.dot(r), d.dot(f)); }
    this.hud.damage(clamp(amount / 60, 0.25, 1), angle); this.player.addShake(clamp(amount / 100, 0.1, 0.5));
    if (amount >= 25 && this.player.alive && this.player.health > 0) this.voice.operator('hit', 9);
  }

  private onKill(killer: any, victim: any, weapon: string, headshot: boolean) {
    if(this.online?.connected){this.online.onKill(killer,victim,weapon,headshot);return;}
    if(victim===this.player&&killer&&killer!==victim)this.deathReplay?.killedBy(this.deathReplay.id(killer),killer.name,weapon,headshot);
    const me = this.player;
    if (this.state === 'playing') this.lastKill = { t: this.time, killer, victim, weapon, headshot };
    if (killer && killer !== victim) {
      killer.kills++; killer.streak++; killer.score += 100 + (headshot ? 50 : 0);
      if (killer === me) {
        this.hud.centerMsg((weapon===VEHICLE_WEAPON||weapon==='RAVEN MOTORCYCLE')?'ROADKILL':`KILLED ${victim.name}`, '+100'); if (headshot) { this.hud.centerMsg('HEADSHOT', '+50', 'hs'); this.audio.headshotDing(); }
        this.audio.killConfirm(); this.bestStreak = Math.max(this.bestStreak, me.streak);
        const s = me.streak; let msg = s === 7 ? 'UNSTOPPABLE ×7' : s === 10 ? 'GODLIKE ×10' : s === 15 ? 'NUCLEAR ×15' : s === 25 ? 'TACTICAL NUKE' : '';
        const reward=this.killstreaks.award('self',s);if(reward)this.killstreaks.announce(reward);
        // multi-kill callouts
        this.killTimes.push(this.time); this.killTimes = this.killTimes.filter((t) => this.time - t < 4);
        if (this.killTimes.length === 2) this.voice.announce('double_kill', 2, 0); else if (this.killTimes.length === 3) this.voice.announce('triple_kill', 2, 0); else if (this.killTimes.length >= 4) this.voice.announce('multi_kill', 2, 0);
        this.voice.operator(Math.random() < 0.5 ? 'enemy_down' : 'tango_down', 5);
        if (msg) setTimeout(() => this.hud.streak(msg), 500);
        if (victim.streak >= 5) this.hud.centerMsg('BUZZ KILL', '+50');
      }
    }
    if (victim && victim.streak !== undefined) victim.streak = 0;
    this.hud.feed(killer && killer !== victim ? killer.name : 'RUST', victim.name, weapon || 'FRAG', headshot, killer === me && victim !== me ? 'killer' : victim === me ? 'victim' : null);
    // win check / match point
    const rows = this.scoreRows(); const top = rows[0];
    const limit = this.settings.scoreLimit;
    if (!this.match.over && limit >= 3 && top.kills === limit - 1 && !this.matchPointShown) { this.matchPointShown = true; setTimeout(() => { this.hud.streak(top.me ? 'MATCH POINT' : `${top.name} · MATCH POINT`); this.voice.announce('match_point', 2, 0); }, 900); }
    const leader = rows[0].me && rows.length > 1 && rows[0].score > rows[1].score;
    if (!this.match.over) { if (leader && !this.wasLeader) this.voice.announce('taking_lead', 1, 10); else if (!leader && this.wasLeader && killer !== me) this.voice.announce('lost_lead', 1, 10); }
    this.wasLeader = leader;
    if (!this.match.over && top.kills >= limit) { this.match.over = true; setTimeout(() => { this.match.over = false; this.endMatch(false); }, 1300); }
  }

  // ------------------------------------------------------------------ final killcam
  private startKillcam() {
    this.deathReplay?.stop();
    const k = this.lastKill!; const first = this.snaps[0]?.t ?? k.t;
    const t0 = Math.max(first, k.t - 4.6), t1 = k.t + 1.4;
    const camIsPlayer = k.killer === this.player || !k.killer?.puppet;
    this.kc = { t0, t1, t: t0, killer: k.killer, victim: k.victim, weapon: k.weapon, deathT: new Map(), shotIdx: 0, camIsPlayer, swappedWeapon: false, hitDone: false };
    this.state = 'killcam'; this.snapIdx = 0; this.hud.hide(); this.hud.setScope(false, null); this.hud.showKillcam(k.killer && k.killer !== k.victim ? k.killer.name : 'RUST', k.weapon, k.victim?.name ?? '');
    this.gunplay.blockFire = true; el('pause').classList.add('hidden');
    let si = this.shotLog.findIndex((sh) => sh.t >= t0); if (si < 0) si = this.shotLog.length; this.kc.shotIdx = si;
    if (!camIsPlayer && k.killer?.def) { this.kc.swappedWeapon = true; loadWeaponModel(k.killer.def).then((m) => { if (this.kc && this.kc.swappedWeapon) this.vm.setWeapon(k.killer.def, m); }); this.playerPuppet?.setShadowOnly(false); }
    this.vm.root.visible = true;
    for (const b of this.bots.bots) if (b.model) b.model.visible = true;
  }
  private sampleSnap(t: number): Snap | null {
    const S = this.snaps; if (!S.length) return null;
    if (t <= S[0].t) return S[0]; if (t >= S[S.length - 1].t) return S[S.length - 1];
    let i = Math.min(this.snapIdx, S.length - 2); while (i > 0 && S[i].t > t) i--; while (i < S.length - 2 && S[i + 1].t <= t) i++; this.snapIdx = i;
    const a = S[i], b = S[i + 1]; const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    const le = (x: SnapEnt, y: SnapEnt): SnapEnt => ({ x: lerp(x.x, y.x, k), y: lerp(x.y, y.y, k), z: lerp(x.z, y.z, k), feetY: lerp(x.feetY, y.feetY, k), yaw: x.yaw + wrapA(y.yaw - x.yaw) * k, aimYaw: x.aimYaw + wrapA(y.aimYaw - x.aimYaw) * k, aimPitch: lerp(x.aimPitch, y.aimPitch, k), alive: x.alive, speed: lerp(x.speed, y.speed, k) });
    return { t, p: { ...le(a.p, b.p), eyeY: lerp(a.p.eyeY, b.p.eyeY, k), pitch: lerp(a.p.pitch, b.p.pitch, k), ads: lerp(a.p.ads, b.p.ads, k) }, b: a.b.map((e, j) => le(e, b.b[j] ?? e)) };
  }
  private updateKillcam(dt: number) {
    const kc = this.kc; if (!kc) { this.showEndScreen(); return; }
    kc.t += dt;
    if (this.input.hit('Enter') || this.input.hit('Space') || this.input.btnHit(0) || kc.t > kc.t1 + 0.5) { this.finishKillcam(); return; }
    this.hud.setKillcamProgress((kc.t - kc.t0) / (kc.t1 - kc.t0));
    const s = this.sampleSnap(kc.t); if (!s) { this.finishKillcam(); return; }
    const pose = (ent: any, e: SnapEnt) => { let deathT = 0; if (!e.alive) { if (!kc.deathT.has(ent)) kc.deathT.set(ent, kc.t); deathT = kc.t - kc.deathT.get(ent)!; } else kc.deathT.delete(ent); return deathT; };
    this.bots.bots.forEach((b, i) => {
      const e = s.b[i]; if (!e || !b.puppet) return; const deathT = pose(b, e);
      b.puppet.setVisible((e.alive || deathT < 3.5) && !(b === kc.killer && !kc.camIsPlayer));
      b.puppet.update(dt, { pos: this._v.set(e.x, e.y, e.z), feetY: e.feetY, yaw: e.yaw, aimYaw: e.aimYaw, aimPitch: e.aimPitch, speed: e.speed, alive: e.alive, deathT });
    });
    const pe = s.p;
    if (this.playerPuppet) { const deathT = pose(this.player, pe); this.playerPuppet.setVisible(!kc.camIsPlayer && (pe.alive || deathT < 3.5)); this.playerPuppet.update(dt, { pos: this._v2.set(pe.x, pe.y, pe.z), feetY: pe.feetY, yaw: pe.yaw, aimYaw: pe.aimYaw, aimPitch: pe.aimPitch, speed: pe.speed, alive: pe.alive, deathT }); }
    // camera
    const rig = this.player.rig; rig.rotation.set(0, 0, 0, 'YXZ');
    if (kc.camIsPlayer) { rig.position.set(pe.x, pe.eyeY, pe.z); rig.rotation.y = pe.yaw - Math.PI; rig.rotation.x = pe.pitch; }
    else { const e = s.b[this.bots.bots.indexOf(kc.killer)]; if (e) { rig.position.set(e.x, e.y + 0.66, e.z); rig.rotation.y = e.aimYaw + Math.PI; rig.rotation.x = e.aimPitch; } }
    const fovT = kc.camIsPlayer ? lerp(this.player.fovBase, this.gunplay.def?.adsFov ?? 60, pe.ads) : 74;
    if (Math.abs(this.camera.fov - fovT) > 0.3) { this.camera.fov = fovT; this.camera.updateProjectionMatrix(); }
    // replay shots
    while (kc.shotIdx < this.shotLog.length && this.shotLog[kc.shotIdx].t <= kc.t) {
      const sh = this.shotLog[kc.shotIdx++]; const def: WeaponDef | undefined = sh.owner === this.player ? this.gunplay.def : sh.owner?.def; if (!def) continue;
      if (sh.owner === kc.killer && (kc.camIsPlayer ? sh.owner === this.player : true)) { this.vm.fire(def.viewKick); if (def.cls === 'sniper') this.audio.sniperShot(def.sounds.shot, 'shot_bolt3_near', 'shot_bolt3_far'); else this.audio.play(def.sounds.shot, { vol: def.sounds.shotVol ?? 0.9, rateVar: 0.03, reverb: 0.3 }); }
      else if (sh.owner?.puppet && sh.owner.puppet.model.visible) { const m = new THREE.Vector3(); sh.owner.puppet.muzzle.getWorldPosition(m); const q = sh.owner.puppet.gunHolder.getWorldQuaternion(new THREE.Quaternion()); this.effects.muzzleFlashWorld(m, new THREE.Vector3(0, 0, -1).applyQuaternion(q), def.flashScale); this.audio.play3D(def.sounds.far, m, { vol: 0.7, ref: 6 }); }
    }
    if (!kc.hitDone && this.lastKill && kc.t >= this.lastKill.t) {
      kc.hitDone = true; const v = kc.victim; let vp: THREE.Vector3 | null = null;
      if (v === this.player) vp = new THREE.Vector3(pe.x, pe.y + 0.2, pe.z); else { const e = s.b[this.bots.bots.indexOf(v)]; if (e) vp = new THREE.Vector3(e.x, e.y + 0.25, e.z); }
      if (vp) { this.effects.blood(vp, new THREE.Vector3(0, 0, 1)); this.audio.hitmarker(this.lastKill.headshot); this.audio.killConfirm(); }
    }
    this.vm.update(dt, { ads: kc.camIsPlayer ? pe.ads : 0.75, sprinting: false, speed: 0, grounded: true, crouching: false, sliding: false, mouseDX: 0, mouseDY: 0, bobPhase: 0, time: performance.now() / 1000, climbing: false, lowered: 0 });
    this.effects.update(dt, rig.position, this.time); this.audio.updateListener(this.camera);
  }
  private finishKillcam() {
    const kc = this.kc; this.kc = null; this.hud.hideKillcam(); this.gunplay.blockFire = false;
    this.playerPuppet?.setShadowOnly(true); this.playerPuppet?.setVisible(true);
    for (const b of this.bots.bots) if (b.puppet) b.puppet.setVisible(b.alive);
    if (kc?.swappedWeapon) { const sl = this.gunplay.slot; if (sl?.model) this.vm.setWeapon(sl.def, sl.model); }
    this.camera.fov = this.player.fovBase; this.camera.updateProjectionMatrix();
    this.showEndScreen();
  }

  private footstep(running: boolean, impact = 0) {
    const p = this.player; const feet = new THREE.Vector3(p.pos.x, p.feetY + 0.2, p.pos.z);
    const hit = this.physics.raycast(feet, new THREE.Vector3(0, -1, 0), 1.2, G.WORLD); const surf = hit?.owner?.surface ?? 'sand';
    const stone = surf === 'metal' || surf === 'concrete' || surf === 'wood' || surf === 'rock';
    this.stepSide = 1 - this.stepSide; const name = `step_${stone ? 'stone' : 'sand'}${this.stepSide ? 'l' : 'r'}${1 + Math.floor(Math.random() * 3)}`;
    const vol = impact > 0 ? clamp(0.35 + impact * 0.6, 0.3, 1) : running ? 0.42 : p.crouching ? 0.14 : 0.28;
    this.audio.play(name, { vol, rateVar: 0.08, rate: surf === 'metal' ? 1.1 : 1 });
    if (surf === 'metal') this.audio.footstep(vol * 0.3, running);
    if (!stone) this.effects.footDust(new THREE.Vector3(p.pos.x, p.feetY, p.pos.z), running ? 1 : 0.5);
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta()); this.time += dt;
    if(this.map instanceof SableMap)this.map.update(dt);
    this.online?.update(dt);
    if(this.mapChanging||this.online?.world.phase==='loading'){this.render(dt);this.input.endFrame();return;}
    if (this.state === 'playing' || (this.state==='paused'&&this.online?.active)) this.updatePlaying(dt);
    else if (this.state === 'killcam') this.updateKillcam(dt);
    else if (this.state === 'menu' || this.state === 'ended') this.updateMenuCam(dt);
    this.deathReplay?.capture();this.deathReplay?.update(dt);
    el('capture-pointer').classList.toggle('hidden',this.nolock||this.input.locked||this.state!=='playing'||!el('lobby').classList.contains('hidden'));
    this.render(dt);
    this.input.endFrame();
  }

  private updateMenuCam(dt: number) {
    this.menuAngle += dt * 0.022;
    const r = this.mapName==='RUST'?26:65, cx = 0, cz = -2; const rig = this.player.rig;
    rig.position.set(cx + Math.cos(this.menuAngle) * r, (this.mapName==='RUST'?9:22) + Math.sin(this.menuAngle * 0.7) * 2, cz + Math.sin(this.menuAngle) * r);
    rig.lookAt(cx, 7, cz);rig.rotateY(Math.PI);
    if (this.camera.fov !== 62) { this.camera.fov = 62; this.camera.updateProjectionMatrix(); }
    this.effects.update(dt, rig.position, this.time); this.audio.updateListener(this.camera);
  }

  private updatePlaying(dt: number) {
    const P = this.player, gp = this.gunplay; const def = gp.def;
    if (!P.alive) { this.respawnT -= dt; this.hud.setRespawnCount(Math.max(0, this.respawnT)); if (this.respawnT <= 0 && !this.match.over && !this.online?.connected) this.respawnPlayer(); }
    // match-start countdown
    if (this.countdown > 0) {
      this.countdown = this.online?.connected ? Math.max(0,(this.online.world.startAt-Date.now())/1000) : this.countdown-dt; const n = Math.ceil(this.countdown);
      if (n < this.countdownShown) { this.countdownShown = n; if (n >= 1) { this.hud.streak(String(n)); this.audio.countdownBeep(false); } }
      if (this.countdown <= 0) { this.hud.streak('GO'); this.audio.countdownBeep(true); this.bots.frozen = false; this.voice.announce('ffa', 3, 0); }
    }
    const canControl = P.alive && !this.match.over && this.countdown <= 0 && this.state==='playing' && el('lobby').classList.contains('hidden');
    this.vehicles.update(dt,canControl&&!this.killstreaks.controlling);
    this.killstreaks.update(dt,canControl&&!P.mounted);
    const onFoot=canControl&&!P.mounted&&!this.killstreaks.controlling;
    gp.updateAim(onFoot);
    if(!P.mounted)P.update(dt, { canControl:onFoot, canLook: !this.killstreaks.controlling && P.alive && !this.match.over && this.state==='playing' && el('lobby').classList.contains('hidden') && (this.input.locked||this.input.forceLocked), speedMul: def?.speedMul ?? 1, adsHeld: gp.adsHeld, adsFov: def?.adsFov ?? 60, adsTime: def?.adsTime ?? 0.25, firing: gp.firing });
    gp.update(dt, onFoot);
    this.fieldItems.update(dt,onFoot);
    this.bullets.listener.copy(P.eyePos); this.bullets.listenerOwner = P; this.bullets.update(dt);
    if(!this.online?.connected||this.online.isHost)this.bots.update(dt, this.time);
    if(!this.online?.connected||this.online.isHost)this.grenades.update(dt, () => this.online?.connected?this.online.victims:this.bots.victims);
    this.physics.step(dt);
    this.effects.update(dt, P.eyePos, this.time);
    this.audio.updateListener(this.camera); this.audio.update(dt);
    // player body (shadow) + killcam recorder
    if (this.playerPuppet) this.playerPuppet.update(dt, { pos: P.pos, feetY: P.feetY, yaw: P.yaw + Math.PI, aimYaw: P.yaw + Math.PI, aimPitch: P.pitch, speed: P.speed, alive: P.alive, deathT: P.deathT, crouch: P.crouching, riding:P.mounted,motorcycle:this.vehicles.current?.kind==='motorcycle' });
    this.snapTimer+=dt;
    if (!this.online?.connected && this.countdown <= 0 && this.snapTimer>=.05) {
      this.snapTimer=0;
      this.snaps.push({ t: this.time, p: { x: P.pos.x, y: P.pos.y, z: P.pos.z, feetY: P.feetY, yaw: P.yaw + Math.PI, aimYaw: P.yaw + Math.PI, aimPitch: P.pitch, alive: P.alive, speed: P.speed, eyeY: P.rig.position.y, pitch: P.pitch, ads: P.ads }, b: this.bots.bots.map((b) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, feetY: b.feetY, yaw: b.yaw, aimYaw: b.aimYaw, aimPitch: b.aimPitch, alive: b.alive, speed: Math.hypot(b.vel.x, b.vel.z) })) });
      while (this.snaps.length && this.snaps[0].t < this.time - 9) this.snaps.shift();
      while (this.shotLog.length && this.shotLog[0].t < this.time - 9) this.shotLog.shift();
    }
    // grenade danger indicator
    let nade: THREE.Vector3 | null = null; let nd = 9;
    for (const g of this.grenades.list) { const d = g.mesh.position.distanceTo(P.pos); if (d < nd) { nd = d; nade = g.mesh.position; } }
    if (nade && P.alive) { const d = this._v.subVectors(nade, P.pos); this.hud.setGrenadeWarning(Math.atan2(d.dot(P.flatRight), d.dot(P.flatForward)), clamp(1 - nd / 9, 0, 1)); if (nd < 6) this.voice.operator('grenade', 7); } else this.hud.setGrenadeWarning(null);
    this.bots.dangerZones = this.grenades.list.map((g) => g.mesh.position);
    // enemy nameplate under the crosshair
    const look = P.alive ? this.physics.raycast(P.eyePos, P.forward, 70, G.WORLD | G.HITBOX) : null;
    this.hud.setTargetName(look && look.owner?.entity && look.owner.entity !== P && look.owner.entity.alive ? look.owner.entity.name : null);
    // match clock + warnings
    if (!this.match.over && this.countdown <= 0 && !this.online?.connected) {
      this.match.timeLeft -= dt;
      if (!this.warn60 && this.match.timeLeft <= 60) { this.warn60 = true; this.hud.centerMsg('1 MINUTE REMAINING'); this.voice.announce('one_minute', 2, 0); }
      if (!this.warn30 && this.match.timeLeft <= 30) { this.warn30 = true; this.hud.centerMsg('30 SECONDS'); this.voice.announce('thirty', 2, 0); }
      if (this.match.timeLeft <= 0) { this.match.timeLeft = 0; this.endMatch(false); }
    }
    // ---- HUD
    const scoped = !!def?.scope; const sp = gp.spread();
    this.hud.setCrosshair(sp, this.camera.fov, P.ads, !P.alive || P.mounted || P.sprinting || gp.reloading || gp.holstering || gp.drawing || gp.cooking, scoped);
    const scopeOn = scoped && P.ads > 0.82 && P.alive && !P.mounted;
    if (scopeOn) { const hit = this.physics.raycast(P.eyePos, P.forward, 400, G.WORLD | G.HITBOX); this.hud.setScope(true, hit ? hit.distance : null); } else this.hud.setScope(false, null);
    this.hud.setHealth(P.health, P.maxHealth); this.hud.setTimer(this.match.timeLeft);
    const rows = this.scoreRows(); this.hud.setScores(P.kills, rows.find((r) => !r.me)?.kills ?? 0);
    this.hud.showScoreboard(this.input.down('Tab') && P.alive, rows);
    const s = gp.slot; if (s) { this.hud.setAmmo(s.mag, s.reserve, s.def.mag, gp.reloading); this.hud.setAmmoWarn(gp.reloading ? null : s.mag === 0 && s.reserve === 0 ? 'NO AMMO' : s.mag === 0 ? 'RELOAD' : s.mag <= Math.max(1, Math.floor(s.def.mag * 0.25)) ? 'LOW AMMO' : null); }
    this.minimapTimer+=dt;
    if(this.minimapTimer>.1){this.minimapTimer=0;this.hud.drawMinimap(P.pos, P.yaw, (this.online?.connected?[...this.bots.bots,...this.online.remotes.values()]:this.bots.bots).map((b) => ({ pos: b.pos, alive: b.alive, visible: this.time - (this.botLastShot.get(b) ?? -9) < 2.2 || b.pos.distanceTo(P.pos) < 5 })), this.time, this.time < this.uavUntil);}
    el('sector-label').textContent=this.map instanceof SableMap?this.map.sector(P.pos.x,P.pos.z):'RUST';
    el('stance-label').textContent=P.mounted?'DRIVING':P.sliding?'SLIDING':P.crouching?'CROUCHED':P.sprinting?'SPRINTING':'STANDING';
    el('stamina-fill').style.width=Math.round(P.stamina*100)+'%';
    this.audio.setLowHealth(P.alive && P.health < 38 ? 1 - P.health / 38 : 0);
    this.hud.update(dt, P.alive ? P.health : 100);
    // ladder hint
    const nearLadder = this.map.ladders.some((l) => Math.hypot(P.pos.x - l.center.x, P.pos.z - l.center.z) < 1.4 && P.feetY < l.top && P.feetY > l.bottom - 1.2);
    this.hud.hint(P.climbing ? 'SPACE — LET GO' : nearLadder ? 'WALK INTO LADDER TO CLIMB' : null);
    if (this.input.hit('Escape') && this.nolock) this.pause();
  }

  private render(dt: number) {
    const restore=this.deathReplay?.beforeRender()||this.killstreaks?.beforeRender();
    try {
    const cam = this.camera; cam.updateMatrixWorld(true);
    this.weaponCam.position.setFromMatrixPosition(cam.matrixWorld); this.weaponCam.quaternion.setFromRotationMatrix(cam.matrixWorld);
    if (this.weaponCam.aspect !== cam.aspect) { this.weaponCam.aspect = cam.aspect; this.weaponCam.updateProjectionMatrix(); }
    // shadow follows the player
    const sp = this.deathReplay?.active ? this.deathReplay.eye : this.killstreaks?.controlling ? this.killstreaks.eye : this.state === 'playing' ? this.player.pos : this.player.rig.position;
    this.shadowTimer+=dt;
    if(this.shadowTimer>=1/30){this.sun.target.position.set(Math.round(sp.x*8)/8,0,Math.round(sp.z*8)/8);this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir,110);this.sun.target.updateMatrixWorld();this.renderer.shadowMap.needsUpdate=true;this.shadowTimer=0;}
    this.post.composer.render(dt);
    this.adaptResolution(dt);
    }finally{restore?.();}
  }

  private targetPixelRatio(){
    const cap=this.settings.graphics==='quality'?Infinity:Math.sqrt(2300000/(innerWidth*innerHeight));
    return Math.min(devicePixelRatio,this.settings.scale,cap);
  }
  private adaptResolution(dt:number){
    if(this.settings.graphics!=='auto'||document.hidden||this.state!=='playing')return;
    this.adaptiveTime+=dt;this.adaptiveFrames++;this.resolutionCooldown-=dt;
    if(this.adaptiveTime<2)return;
    const frame=this.adaptiveTime/this.adaptiveFrames,ratio=this.renderer.getPixelRatio(),max=this.targetPixelRatio();
    if(this.resolutionCooldown<=0){
      const next=frame>.022?Math.max(.55,ratio-.1):frame<.0175?Math.min(max,ratio+.05):ratio;
      if(Math.abs(next-ratio)>.025){this.renderer.setPixelRatio(next);this.onResize();this.resolutionCooldown=5;}
    }
    this.adaptiveTime=0;this.adaptiveFrames=0;
  }

  private onResize() {
    const w = innerWidth, h = innerHeight; if(this.settings.graphics==='auto')this.renderer.setPixelRatio(Math.min(this.renderer.getPixelRatio(),this.targetPixelRatio())); this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.weaponCam.aspect = w / h; this.weaponCam.updateProjectionMatrix(); this.post.setSize(w, h);
  }

  private renderMinimapBase() {
    const size = this.map.bounds*2+4, res = 1024;
    const rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace });
    const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, 300); cam.position.set(0, 120, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true); cam.layers.set(0);
    const bg = this.scene.background, fog = this.scene.fog; this.scene.background = new THREE.Color(0x0e0c0a); this.scene.fog = null;
    this.renderer.shadowMap.needsUpdate = true; this.renderer.setRenderTarget(rt); this.renderer.render(this.scene, cam); this.renderer.setRenderTarget(null);
    const buf = new Uint8Array(res * res * 4); this.renderer.readRenderTargetPixels(rt, 0, 0, res, res, buf);
    const c = document.createElement('canvas'); c.width = c.height = res; const ctx = c.getContext('2d')!; const img = ctx.createImageData(res, res);
    for (let y = 0; y < res; y++) { const src = (res - 1 - y) * res * 4, dst = y * res * 4; img.data.set(buf.subarray(src, src + res * 4), dst); }
    ctx.putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = out.height = res; const octx = out.getContext('2d')!; octx.filter = 'saturate(0.5) brightness(0.85) contrast(1.25)'; octx.drawImage(c, 0, 0);
    el<HTMLImageElement>('map-preview').src=out.toDataURL('image/jpeg',.8); this.hud.setMinimapBase(out, size); this.scene.background = bg; this.scene.fog = fog; rt.dispose();
  }
}

const wrapA = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
function modeLabel(d: WeaponDef) { return d.mode === 'auto' ? 'AUTO' : d.mode === 'semi' ? 'SEMI' : d.mode === 'bolt' ? 'BOLT' : 'PUMP'; }

/** Find the brightest direction in an equirectangular HDR (the sun). */
function findSunDirection(tex: THREE.DataTexture): THREE.Vector3 {
  const { data, width, height } = tex.image as { data: Float32Array; width: number; height: number };
  let best = -1, bx = 0, by = 0; const stride = 2;
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) { const i = (y * width + x) * 4; const l = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; if (l > best) { best = l; bx = x; by = y; } }
  const u = (bx + 0.5) / width, v = (by + 0.5) / height; // flipY: row 0 = bottom
  const theta = (u - 0.5) * Math.PI * 2, phi = (v - 0.5) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta));
  if (dir.y < 0.15) return new THREE.Vector3(0.55, 0.62, 0.35).normalize();
  return dir;
}
