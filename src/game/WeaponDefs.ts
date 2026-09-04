export type WeaponClass = 'ar' | 'smg' | 'sniper' | 'shotgun' | 'pistol';
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
    damage: 100, headMul: 1.5, legMul: 0.7, falloffStart: 200, falloffEnd: 400, falloffMin: 1.0,
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
    model: { url: '/models/weapons/ak47.glb', scale: 0.95, rot: [0, Math.PI, 0], hip: [0.2, -0.2, -0.5], ads: [0, -0.1, -0.4], sprint: [0.16, -0.26, -0.45], sprintRot: [0.35, -0.5, 0.1], muzzle: [0, 0.03, 0], eject: [0.04, 0.03, 0.05], worldScale: 1 },
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
// Weapon variants retain the original detailed models, with distinct ballistics and handling.
WEAPONS.scarScout = { ...WEAPONS.scarh, id: 'scarScout', name: 'SCAR-H DMR', mode: 'semi', damage: 62, rpm: 280, mag: 12, reserve: 72, adsSpread: 0.035, falloffStart: 65, falloffEnd: 145, recoilPitch: 1.5 * D, adsFov: 42 };
WEAPONS.akSupport = { ...WEAPONS.ak47, id: 'akSupport', name: 'AK-47 SUPPORT', mag: 60, reserve: 180, speedMul: 0.86, adsTime: 0.34, reloadTime: 3.4, reloadEmptyTime: 4.1, recoilPitch: 0.95 * D };
WEAPONS.mp5Recon = { ...WEAPONS.mp5, id: 'mp5Recon', name: 'MP5 RECON', rpm: 720, damage: 28, hipSpread: 2.0, recoilPitch: 0.44 * D, speedMul: 1.08, adsTime: 0.13, flashScale: 0.35 };
export const LOADOUTS: Loadout[] = [
  { id: 'assault', name: 'ASSAULT', tag: 'ALL-ROUNDER', desc: 'SCAR-H · DESERT EAGLE · FRAG', primary: 'scarh', secondary: 'deagle', lethal: 1 },
  { id: 'sniper', name: 'SNIPER', tag: 'ONE SHOT', desc: 'INTERVENTION · M1911 · FRAG', primary: 'intervention', secondary: 'm1911', lethal: 1 },
  { id: 'rusher', name: 'RUSHER', tag: 'CLOSE QUARTERS', desc: 'MP5 · DESERT EAGLE · FRAG ×2', primary: 'mp5', secondary: 'deagle', lethal: 2 },
  { id: 'overkill', name: 'OVERKILL', tag: 'TWO PRIMARIES', desc: 'AK-47 · SPAS-12 · FRAG', primary: 'ak47', secondary: 'spas12', lethal: 1 },
  { id: 'marksman', name: 'MARKSMAN', tag: 'PRECISION', desc: 'SCAR-H DMR · M1911 · FRAG', primary: 'scarScout', secondary: 'm1911', lethal: 1 },
  { id: 'breacher', name: 'BREACHER', tag: 'ROOM CLEARING', desc: 'SPAS-12 · MP5 · FRAG ×2', primary: 'spas12', secondary: 'mp5', lethal: 2 },
  { id: 'support', name: 'SUPPORT', tag: '60 ROUND MAG', desc: 'AK-47 SUPPORT · M1911 · FRAG', primary: 'akSupport', secondary: 'm1911', lethal: 1 },
  { id: 'recon', name: 'RECON', tag: 'HIGH MOBILITY', desc: 'MP5 RECON · M1911 · FRAG', primary: 'mp5Recon', secondary: 'm1911', lethal: 1 },
  { id: 'hunter', name: 'HUNTER', tag: 'RANGE + POWER', desc: 'INTERVENTION · SPAS-12 · FRAG', primary: 'intervention', secondary: 'spas12', lethal: 1 },
  { id: 'vanguard', name: 'VANGUARD', tag: 'FLEXIBLE', desc: 'SCAR-H · MP5 RECON · FRAG ×2', primary: 'scarh', secondary: 'mp5Recon', lethal: 2 },
];
