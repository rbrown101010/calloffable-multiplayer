import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential damping. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const dampV3 = (cur: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number) => { const t = 1 - Math.exp(-lambda * dt); cur.x += (target.x - cur.x) * t; cur.y += (target.y - cur.y) * t; cur.z += (target.z - cur.z) * t; return cur; };
export const wrapAngle = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const fmtTime = (s: number) => { s = Math.max(0, Math.ceil(s)); const m = Math.floor(s / 60); const r = s % 60; return `${m}:${r.toString().padStart(2, '0')}`; };
export function gaussian() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v); }
export function el<T extends HTMLElement = HTMLElement>(id: string): T { const e = document.getElementById(id); if (!e) throw new Error('missing #' + id); return e as T; }
