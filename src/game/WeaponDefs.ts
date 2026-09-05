export type WeaponClass = 'ar' | 'smg' | 'sniper' | 'shotgun' | 'pistol' | 'marksman' | 'lmg' | 'launcher';
export type FireMode = 'auto' | 'semi' | 'bolt' | 'pump';

export interface ModelDef {
  url: string;                 // gltf/glb path or 'proc:intervention'
  scale: number;
  rot: [number, number, number];      // base orientation fix (radians)
  offset?: [number, number, number];  // model pivot correction (weapon local, after rot/scale)
  hip: [number, number, number];      // camera-space position (x right, y up, z back)
  ads: [number, number, number];
  sprint: [number, number, number];
  sprintRot: [number, number, number];
  muzzle: [number, number, number];   // camera-space, relative to hip pose (weapon holder space)
  eject: [number, number, number];
  worldScale?: number;                // scale when held by bots (world model)
  worldOffset?: [number, number, number];
  worldRot?: [number, number, number];
}

export interface GunAudio {
  shot: string[]; far: string[]; reload: string[]; reloadEmpty?: string[]; cycle?: string[];
  vol?: number; rate?: number; rateVar?: number; layer?: string[]; layerVol?: number; layerRate?: number;
  mech?: string[]; mechVol?: number; sub?: number; subFreq?: number; subDecay?: number; crack?: number;
  echo?: string[]; echoVol?: number; echoDelay?: number; echo2?: boolean; reverb?: number;
}
export interface WeaponDef {
  id: string; name: string; cls: WeaponClass; mode: FireMode;
  audio?: GunAudio;
  damage: number; headMul: number; legMul: number; falloffStart: number; falloffEnd: number; falloffMin: number;
  rpm: number; pellets: number; pelletSpread: number;
  mag: number; reserve: number; reloadTime: number; reloadEmptyTime: number; magOutT: number;
  adsTime: number; adsFov: number; scope: boolean;
  hipSpread: number; adsSpread: number; moveSpread: number; jumpSpread: number; crouchMul: number;
  bloom: number; bloomMax: number; bloomDecay: number;
  recoilPitch: number; recoilYaw: number; recoilRand: number; viewKick: number;
  speedMul: number; bulletSpeed: number; range: number; boltTime: number; drawTime: number;
  sounds: { shot: string; far: string; reload: string; extra?: string; shotVol?: number };
  model: ModelDef;
  tracer: boolean; flashScale: number; shell: 'rifle' | 'pistol' | 'shotgun' | 'sniper';
  optic?: 'red-dot' | 'holographic';
  projectile?: {kind:'rocket'|'grenade';speed:number;gravity:number;radius:number;damage:number;fuse:number;armingDistance?:number;impactDamage?:number};
  killIcon?: string;
}

const D = Math.PI / 180;

export const WEAPONS: Record<string, WeaponDef> = {
  scarh: {
    id: 'scarh', name: 'SCAR-H', cls: 'ar', mode: 'auto',
    damage: 40, headMul: 1.4, legMul: 0.85, falloffStart: 28, falloffEnd: 60, falloffMin: 0.7,
    rpm: 625, pellets: 1, pelletSpread: 0,
    mag: 20, reserve: 100, reloadTime: 2.1, reloadEmptyTime: 2.7, magOutT: 0.45,
    adsTime: 0.24, adsFov: 58, scope: false,
    hipSpread: 3.2, adsSpread: 0.12, moveSpread: 1.6, jumpSpread: 4, crouchMul: 0.8,
    bloom: 0.28, bloomMax: 2.2, bloomDecay: 6,
    recoilPitch: 0.95 * D, recoilYaw: 0.28 * D, recoilRand: 0.5, viewKick: 1.0,
    speedMul: 0.95, bulletSpeed: 720, range: 300, boltTime: 0, drawTime: 0.45,
    sounds: { shot: 'shot_ar_near', far: 'shot_ar_far', reload: 'reload_rifle', shotVol: 0.9 },
    audio: { shot: ['ar_1', 'ar_2', 'ar_3'], far: ['shot_ar_far'], reload: ['reload_ar_1', 'reload_ar_2'], vol: 0.95, rateVar: 0.035, sub: 0.35, subFreq: 62, subDecay: 0.14, crack: 0.25, echo: ['shot_ar_far'], echoVol: 0.22, echoDelay: 0.22, reverb: 0.3 },
    model: { url: '/models/weapons/scarh.glb', scale: 0.079, rot: [0, Math.PI, 0], hip: [0.2, -0.2, -0.5], ads: [0, -0.148, -0.42], sprint: [0.16, -0.26, -0.45], sprintRot: [0.35, -0.5, 0.1], muzzle: [0, 0.02, 0], eject: [0.04, 0.02, 0.05], worldScale: 1 },
    tracer: true, flashScale: 1.0, shell: 'rifle',
  },
  intervention: {
    id: 'intervention', name: 'INTERVENTION', cls: 'sniper', mode: 'bolt',
    damage: 82, headMul: 1.5, legMul: 0.7, falloffStart: 200, falloffEnd: 400, falloffMin: 1.0,
    rpm: 45, pellets: 1, pelletSpread: 0,
    mag: 5, reserve: 25, reloadTime: 3.4, reloadEmptyTime: 3.9, magOutT: 0.4,
    adsTime: 0.42, adsFov: 14, scope: true,
    hipSpread: 9, adsSpread: 0.02, moveSpread: 3, jumpSpread: 12, crouchMul: 0.85,
    bloom: 0.5, bloomMax: 2, bloomDecay: 3,
    recoilPitch: 3.6 * D, recoilYaw: 0.9 * D, recoilRand: 0.5, viewKick: 2.4,
    speedMul: 0.86, bulletSpeed: 950, range: 500, boltTime: 1.05, drawTime: 0.75,
    sounds: { shot: 'shot_bolt_near', far: 'shot_bolt_far', reload: 'reload_rifle', extra: 'shot_bolt2_near', shotVol: 1.0 },
    audio: { shot: ['sniper_1', 'sniper_2', 'sniper_3'], far: ['shot_bolt3_far', 'shot_bolt_far'], reload: ['reload_sniper_1', 'reload_ar_2'], cycle: ['mech_bolt'], vol: 1.0, rate: 0.96, rateVar: 0.02, layer: ['sniper_field'], layerVol: 0.7, layerRate: 1.0, sub: 0.9, subFreq: 50, subDecay: 0.32, crack: 0.9, echo: ['shot_bolt3_far', 'shot_bolt_far'], echoVol: 0.45, echoDelay: 0.3, echo2: true, reverb: 0.5 },
    model: { url: 'proc:intervention', scale: 1, rot: [0, 0, 0], hip: [0.24, -0.27, -0.72], ads: [0, -0.105, -0.36], sprint: [0.2, -0.32, -0.6], sprintRot: [0.4, -0.55, 0.1], muzzle: [0, 0.008, 0], eject: [0.04, 0.02, 0.1], worldScale: 1 },
    tracer: true, flashScale: 1.6, shell: 'sniper',
  },
  mp5: {
    id: 'mp5', name: 'MP5', cls: 'smg', mode: 'auto',
    damage: 30, headMul: 1.4, legMul: 0.9, falloffStart: 14, falloffEnd: 32, falloffMin: 0.65,
    rpm: 800, pellets: 1, pelletSpread: 0,
    mag: 30, reserve: 150, reloadTime: 1.8, reloadEmptyTime: 2.3, magOutT: 0.4,
    adsTime: 0.17, adsFov: 64, scope: false,
    hipSpread: 2.6, adsSpread: 0.18, moveSpread: 1.0, jumpSpread: 3.2, crouchMul: 0.85,
    bloom: 0.22, bloomMax: 1.8, bloomDecay: 7,
    recoilPitch: 0.62 * D, recoilYaw: 0.32 * D, recoilRand: 0.6, viewKick: 0.7,
    speedMul: 1.03, bulletSpeed: 480, range: 220, boltTime: 0, drawTime: 0.35,
    sounds: { shot: 'shot_smg_near', far: 'shot_smg_far', reload: 'reload_rifle', shotVol: 0.75 },
    audio: { shot: ['smg_1', 'smg_2', 'smg_3'], far: ['shot_smg_far'], reload: ['reload_smg_1', 'reload_pistol_1'], vol: 0.85, rateVar: 0.04, sub: 0.22, subFreq: 70, subDecay: 0.1, crack: 0.18, echo: ['shot_smg_far'], echoVol: 0.16, echoDelay: 0.2, reverb: 0.25 },
    model: { url: '/models/weapons/mp5.glb', scale: 85, rot: [0, Math.PI, 0], hip: [0.2, -0.19, -0.42], ads: [-0.02, -0.125, -0.45], sprint: [0.16, -0.24, -0.38], sprintRot: [0.3, -0.5, 0.1], muzzle: [0, 0.02, 0], eject: [0.035, 0.02, 0.02], worldScale: 1 },
    tracer: true, flashScale: 0.75, shell: 'pistol',
  },
  ak47: {
    id: 'ak47', name: 'AK-47', cls: 'ar', mode: 'auto',
    damage: 42, headMul: 1.4, legMul: 0.85, falloffStart: 26, falloffEnd: 60, falloffMin: 0.7,
    rpm: 600, pellets: 1, pelletSpread: 0,
    mag: 30, reserve: 120, reloadTime: 2.3, reloadEmptyTime: 2.9, magOutT: 0.45,
    adsTime: 0.26, adsFov: 58, scope: false,
    hipSpread: 3.6, adsSpread: 0.14, moveSpread: 1.7, jumpSpread: 4.5, crouchMul: 0.8,
    bloom: 0.34, bloomMax: 2.6, bloomDecay: 5.5,
    recoilPitch: 1.25 * D, recoilYaw: 0.45 * D, recoilRand: 0.55, viewKick: 1.2,
    speedMul: 0.94, bulletSpeed: 715, range: 300, boltTime: 0, drawTime: 0.5,
    sounds: { shot: 'shot_ak_near', far: 'shot_ak_far', reload: 'reload_rifle', shotVol: 0.95 },
    audio: { shot: ['ak_1', 'ak_2', 'ak_3'], far: ['shot_ak_far'], reload: ['reload_ar_2', 'reload_ar_1'], vol: 0.95, rateVar: 0.035, sub: 0.45, subFreq: 58, subDecay: 0.16, crack: 0.3, echo: ['shot_ak_far'], echoVol: 0.25, echoDelay: 0.22, reverb: 0.32 },
    model: { url: 'proc:ak47', scale: 1, rot: [0, 0, 0], hip: [0.2, -0.2, -0.5], ads: [0, -0.1, -0.4], sprint: [0.16, -0.26, -0.45], sprintRot: [0.35, -0.5, 0.1], muzzle: [0, 0.03, 0], eject: [0.04, 0.03, 0.05], worldScale: 1 },
    tracer: true, flashScale: 1.0, shell: 'rifle',
  },
  spas12: {
    id: 'spas12', name: 'SPAS-12', cls: 'shotgun', mode: 'pump',
    damage: 22, headMul: 1.2, legMul: 0.9, falloffStart: 6, falloffEnd: 16, falloffMin: 0.25,
    rpm: 80, pellets: 8, pelletSpread: 3.4,
    mag: 8, reserve: 32, reloadTime: 0.62, reloadEmptyTime: 0.62, magOutT: 0.5,
    adsTime: 0.28, adsFov: 62, scope: false,
    hipSpread: 2.2, adsSpread: 1.2, moveSpread: 0.6, jumpSpread: 2, crouchMul: 0.9,
    bloom: 0.6, bloomMax: 1.5, bloomDecay: 4,
    recoilPitch: 2.6 * D, recoilYaw: 0.6 * D, recoilRand: 0.6, viewKick: 2.2,
    speedMul: 0.93, bulletSpeed: 400, range: 60, boltTime: 0.7, drawTime: 0.5,
    sounds: { shot: 'shot_shotgun_near', far: 'shot_shotgun_far', reload: 'shotgun_pump', extra: 'shotgun_pump', shotVol: 1.0 },
    audio: { shot: ['shotgun_1', 'shotgun_2', 'shotgun_3'], far: ['shot_shotgun_far'], reload: ['reload_shotgun_1', 'shotgun_pump'], cycle: ['mech_pump_1', 'mech_pump_2'], vol: 1.0, rateVar: 0.03, sub: 0.8, subFreq: 52, subDecay: 0.26, crack: 0.5, echo: ['shot_shotgun_far'], echoVol: 0.35, echoDelay: 0.24, echo2: true, reverb: 0.4 },
    model: { url: '/models/weapons/spas12.glb', scale: 1.0, rot: [0, Math.PI / 2, 0], hip: [0.2, -0.2, -0.5], ads: [0, -0.095, -0.4], sprint: [0.16, -0.26, -0.45], sprintRot: [0.35, -0.5, 0.1], muzzle: [0, 0.02, 0], eject: [0.04, 0.02, 0.0], worldScale: 1 },
    tracer: false, flashScale: 1.3, shell: 'shotgun',
  },
  deagle: {
    id: 'deagle', name: 'DESERT EAGLE', cls: 'pistol', mode: 'semi',
    damage: 55, headMul: 1.5, legMul: 0.85, falloffStart: 12, falloffEnd: 30, falloffMin: 0.6,
    rpm: 260, pellets: 1, pelletSpread: 0,
    mag: 7, reserve: 35, reloadTime: 1.9, reloadEmptyTime: 2.3, magOutT: 0.4,
    adsTime: 0.16, adsFov: 66, scope: false,
    hipSpread: 3.0, adsSpread: 0.3, moveSpread: 1.2, jumpSpread: 3, crouchMul: 0.85,
    bloom: 0.9, bloomMax: 3, bloomDecay: 5,
    recoilPitch: 2.4 * D, recoilYaw: 0.7 * D, recoilRand: 0.5, viewKick: 2.0,
    speedMul: 1.0, bulletSpeed: 470, range: 120, boltTime: 0, drawTime: 0.3,
    sounds: { shot: 'shot_pistol_near', far: 'shot_pistol_far', reload: 'reload_pistol', shotVol: 0.9 },
    audio: { shot: ['deagle_1', 'deagle_2', 'deagle_3'], far: ['shot_pistol_far'], reload: ['reload_pistol_1', 'reload_pistol_2'], vol: 1.0, rateVar: 0.03, sub: 0.7, subFreq: 56, subDecay: 0.22, crack: 0.45, echo: ['shot_pistol_far'], echoVol: 0.3, echoDelay: 0.24, echo2: true, reverb: 0.35 },
    model: { url: '/models/weapons/deagle.glb', scale: 0.0098, rot: [0, Math.PI, 0], hip: [0.17, -0.17, -0.36], ads: [0, -0.078, -0.3], sprint: [0.16, -0.24, -0.34], sprintRot: [0.3, -0.45, 0.1], muzzle: [0, 0.03, 0], eject: [0.03, 0.03, 0.0], worldScale: 1 },
    tracer: true, flashScale: 0.9, shell: 'pistol',
  },
  m1911: {
    id: 'm1911', name: 'M1911 .45', cls: 'pistol', mode: 'semi',
    damage: 38, headMul: 1.5, legMul: 0.85, falloffStart: 10, falloffEnd: 26, falloffMin: 0.6,
    rpm: 420, pellets: 1, pelletSpread: 0,
    mag: 8, reserve: 48, reloadTime: 1.6, reloadEmptyTime: 2.0, magOutT: 0.4,
    adsTime: 0.14, adsFov: 68, scope: false,
    hipSpread: 2.4, adsSpread: 0.25, moveSpread: 1.0, jumpSpread: 2.5, crouchMul: 0.85,
    bloom: 0.55, bloomMax: 2.2, bloomDecay: 6,
    recoilPitch: 1.3 * D, recoilYaw: 0.4 * D, recoilRand: 0.5, viewKick: 1.2,
    speedMul: 1.0, bulletSpeed: 420, range: 100, boltTime: 0, drawTime: 0.28,
    sounds: { shot: 'shot_pistol2_near', far: 'shot_pistol_far', reload: 'reload_pistol', shotVol: 0.8 },
    audio: { shot: ['pistol_1', 'pistol_2', 'pistol_3'], far: ['shot_pistol_far'], reload: ['reload_pistol_2', 'reload_pistol_1'], vol: 0.9, rateVar: 0.04, sub: 0.35, subFreq: 66, subDecay: 0.13, crack: 0.3, echo: ['shot_pistol_far'], echoVol: 0.2, echoDelay: 0.22, reverb: 0.3 },
    model: { url: '/models/weapons/m1911.glb', scale: 1.1, rot: [0, 0, 0], hip: [0.17, -0.17, -0.36], ads: [0, -0.085, -0.3], sprint: [0.16, -0.24, -0.34], sprintRot: [0.3, -0.45, 0.1], muzzle: [0, 0.03, 0], eject: [0.03, 0.03, 0.0], worldScale: 1 },
    tracer: true, flashScale: 0.7, shell: 'pistol',
  },
};

export interface Loadout { id: string; name: string; tag: string; desc: string; primary: string; secondary: string; lethal: number; }
// Distinct weapons, each with its own geometry and handling.
const model=(id:string):ModelDef=>({...WEAPONS.ak47.model,url:'proc:'+id,scale:1,hip:[.22,-.22,-.48],ads:[0,-.13,-.42]});
WEAPONS.m14={...WEAPONS.scarh,id:'m14',name:'M14 EBR',cls:'marksman',mode:'semi',damage:56,rpm:280,mag:15,reserve:75,adsSpread:.045,falloffStart:65,falloffEnd:150,recoilPitch:1.45*D,adsFov:48,optic:'holographic',speedMul:.88,model:model('m14')};
WEAPONS.m249={...WEAPONS.ak47,id:'m249',name:'M249 SAW',cls:'lmg',damage:34,rpm:760,mag:80,reserve:160,speedMul:.8,adsTime:.36,reloadTime:4.5,reloadEmptyTime:5,recoilPitch:.95*D,model:model('m249')};
WEAPONS.p90={...WEAPONS.mp5,id:'p90',name:'P90',rpm:900,damage:25,mag:50,reserve:150,hipSpread:2.1,recoilPitch:.47*D,speedMul:1.19,model:model('p90')};
WEAPONS.g36={...WEAPONS.scarh,id:'g36',name:'G36C',damage:32,rpm:750,mag:30,reserve:120,recoilPitch:.7*D,speedMul:1.02,adsTime:.2,model:model('g36')};
WEAPONS.vector={...WEAPONS.mp5,id:'vector',name:'VECTOR .45',damage:23,rpm:1100,mag:25,reserve:150,falloffStart:12,falloffEnd:30,recoilPitch:.4*D,speedMul:1.19,model:model('vector')};
WEAPONS.rpg7={...WEAPONS.scarh,id:'rpg7',name:'RPG-7',cls:'launcher',mode:'semi',damage:180,headMul:1,mag:1,reserve:4,rpm:30,reloadTime:3.1,reloadEmptyTime:3.1,adsTime:.35,adsFov:62,hipSpread:.8,adsSpread:.15,bloom:0,bloomMax:0,speedMul:.76,bulletSpeed:64,model:model('rpg7'),projectile:{kind:'rocket',speed:64,gravity:1.2,radius:8,damage:180,fuse:5}};
WEAPONS.m32={...WEAPONS.spas12,id:'m32',name:'M32 GL',cls:'launcher',mode:'semi',damage:180,headMul:1,pellets:1,pelletSpread:0,mag:6,reserve:12,rpm:42,reloadTime:5,reloadEmptyTime:5,boltTime:0,hipSpread:1.5,adsSpread:.5,speedMul:.84,bulletSpeed:38,model:model('m32'),projectile:{kind:'grenade',speed:38,gravity:15,radius:7.2,damage:180,fuse:5,armingDistance:6,impactDamage:140}};
WEAPONS.mp7={...WEAPONS.mp5,id:'mp7',name:'MP7',damage:22,rpm:950,mag:20,reserve:80,falloffStart:9,falloffEnd:24,speedMul:1.19,model:model('mp7')};
WEAPONS.intervention.speedMul=.68;
WEAPONS.mp5.speedMul=1.19;
for(const d of Object.values(WEAPONS))if(['ar','smg','lmg'].includes(d.cls))d.optic='red-dot';

// Source models are normalized to meters and face down the weapon's -Z axis.
for(const id of ['ak47','spas12','m14','m249','p90','g36','vector','rpg7','m32','mp7']){
 const d=WEAPONS[id];d.model={...d.model,url:'/models/weapons/'+id+'.glb',scale:1,rot:[0,0,0],hip:[.22,-.2,id==='rpg7'?-.6:-.46],ads:[0,-.09,-.4]};
}
WEAPONS.m32.optic='red-dot';WEAPONS.m32.flashScale=.7;WEAPONS.m32.audio={...WEAPONS.spas12.audio!,rate:.68,sub:.9,crack:.2,vol:.85};

export type Equipment={primary:string;secondary:string};
export const PRIMARY_WEAPONS=['scarh','ak47','g36','mp5','p90','vector','m14','intervention','spas12','m249','rpg7'];
export const SECONDARY_WEAPONS=['m1911','deagle','mp7','m32'];
export const DEFAULT_EQUIPMENT:Equipment={primary:'scarh',secondary:'m1911'};
export function validateEquipment(value:any):Equipment{return{primary:PRIMARY_WEAPONS.includes(value?.primary)?value.primary:DEFAULT_EQUIPMENT.primary,secondary:SECONDARY_WEAPONS.includes(value?.secondary)?value.secondary:DEFAULT_EQUIPMENT.secondary};}
export function equipmentLoadout(value:Equipment):Loadout{const e=validateEquipment(value);return{id:'custom',name:WEAPONS[e.primary].name+' + '+WEAPONS[e.secondary].name,tag:'CUSTOM LOADOUT',desc:'Your weapons. Your approach.',...e,lethal:2};}
export const equipmentLabel=(value:Equipment)=>{const e=validateEquipment(value);return WEAPONS[e.primary].name+' / '+WEAPONS[e.secondary].name;};
// Automatic weapons recover predictably; damage and fire rates remain class-specific.
for(const d of Object.values(WEAPONS))if(d.mode==='auto'){d.recoilPitch*=.85;d.recoilYaw*=.72;d.bloom*=.78;d.bloomMax*=.8;d.bloomDecay*=1.15;d.adsTime*=.9;d.viewKick*=.82;}
export const LOADOUTS: Loadout[] = [
  { id: 'assault', name: 'ASSAULT', tag: 'ALL-ROUNDER', desc: 'SCAR-H · DESERT EAGLE · FRAG', primary: 'scarh', secondary: 'deagle', lethal: 1 },
  { id: 'sniper', name: 'SNIPER', tag: 'HEADSHOT SPECIALIST', desc: 'INTERVENTION · M1911 · FRAG', primary: 'intervention', secondary: 'm1911', lethal: 1 },
  { id: 'rusher', name: 'RUSHER', tag: 'CLOSE QUARTERS', desc: 'MP5 · DESERT EAGLE · FRAG ×2', primary: 'mp5', secondary: 'deagle', lethal: 2 },
  { id: 'overkill', name: 'OVERKILL', tag: 'TWO PRIMARIES', desc: 'AK-47 · SPAS-12 · FRAG', primary: 'ak47', secondary: 'spas12', lethal: 1 },
  { id: 'marksman', name: 'MARKSMAN', tag: 'PRECISION', desc: 'M14 EBR · M1911 · FRAG', primary: 'm14', secondary: 'm1911', lethal: 1 },
  { id: 'breacher', name: 'BREACHER', tag: 'ROOM CLEARING', desc: 'SPAS-12 · MP5 · FRAG ×2', primary: 'spas12', secondary: 'mp5', lethal: 2 },
  { id: 'support', name: 'SUPPORT', tag: '60 ROUND MAG', desc: 'M249 SAW · M1911 · FRAG', primary: 'm249', secondary: 'm1911', lethal: 1 },
  { id: 'recon', name: 'RECON', tag: 'HIGH MOBILITY', desc: 'P90 · M1911 · FRAG', primary: 'p90', secondary: 'm1911', lethal: 1 },
  { id: 'hunter', name: 'HUNTER', tag: 'RANGE + POWER', desc: 'INTERVENTION · SPAS-12 · FRAG', primary: 'intervention', secondary: 'spas12', lethal: 1 },
  { id: 'vanguard', name: 'VANGUARD', tag: 'FLEXIBLE', desc: 'SCAR-H · P90 · FRAG ×2', primary: 'scarh', secondary: 'p90', lethal: 2 },
];
