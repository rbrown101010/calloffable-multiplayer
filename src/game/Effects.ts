import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics, G, cg } from './Physics';
import { AudioManager } from './Audio';
import { rand, clamp, lerp } from './util';

// ------------------------------------------------------------------ textures
function makeSoftCircle(size = 64, power = 1.6) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
  const img = g.createImageData(size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5; const r = Math.sqrt(dx * dx + dy * dy) * 2; const a = Math.pow(clamp(1 - r, 0, 1), power); const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255); }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeSmoke(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
  const img = g.createImageData(size, size); const d = img.data;
  const rnd = (x: number, y: number) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5; const r = Math.sqrt(dx * dx + dy * dy) * 2;
    let n = 0; for (let o = 1; o <= 3; o++) { const f = o * 4; n += rnd(Math.floor(x / size * f), Math.floor(y / size * f)) / o; }
    const a = clamp(1 - r, 0, 1) * (0.55 + 0.45 * n / 1.8); const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
  g.putImageData(img, 0, 0); return new THREE.CanvasTexture(c);
}
export function makeFlash(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx); grad.addColorStop(0, 'rgba(255,255,240,1)'); grad.addColorStop(0.25, 'rgba(255,220,140,0.95)'); grad.addColorStop(0.6, 'rgba(255,140,40,0.35)'); grad.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { const a = Math.random() * Math.PI * 2; const len = cx * (0.6 + Math.random() * 0.4); g.strokeStyle = 'rgba(255,230,170,0.85)'; g.lineWidth = 2 + Math.random() * 3; g.beginPath(); g.moveTo(cx, cx); g.lineTo(cx + Math.cos(a) * len, cx + Math.sin(a) * len); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeBulletHole(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
  const cx = size / 2; const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, 'rgba(5,5,5,1)'); grad.addColorStop(0.35, 'rgba(15,12,10,0.95)'); grad.addColorStop(0.6, 'rgba(40,35,30,0.5)'); grad.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeScorch(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
  const cx = size / 2; const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, 'rgba(8,6,4,0.95)'); grad.addColorStop(0.4, 'rgba(20,16,12,0.8)'); grad.addColorStop(0.75, 'rgba(40,32,24,0.35)'); grad.addColorStop(1, 'rgba(60,50,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ------------------------------------------------------------------ particles
interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; sizeEnd: number; r: number; g: number; b: number; a: number; grav: number; drag: number; }

class ParticlePool {
  points: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial;
  pos: Float32Array; size: Float32Array; col: Float32Array; alpha: Float32Array;
  parts: P[] = []; free: number[] = []; count: number;
  constructor(scene: THREE.Scene, count: number, tex: THREE.Texture, additive: boolean, sizeScale = 1) {
    this.count = count;
    this.pos = new Float32Array(count * 3); this.size = new Float32Array(count); this.col = new Float32Array(count * 3); this.alpha = new Float32Array(count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 800 * sizeScale } },
      vertexShader: `attribute float aSize; attribute vec3 aColor; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; uniform float scale;
        void main(){ vColor=aColor; vAlpha=aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * scale / max(0.5,-mv.z); gl_PointSize = min(gl_PointSize, 900.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor; varying float vAlpha; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha); if (gl_FragColor.a < 0.004) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 20 : 10;
    scene.add(this.points);
    for (let i = 0; i < count; i++) { this.parts.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 0, size: 0, sizeEnd: 0, r: 1, g: 1, b: 1, a: 0, grav: 0, drag: 0 }); this.free.push(i); this.alpha[i] = 0; this.pos[i * 3 + 1] = -999; }
  }
  emit(p: Partial<P> & { x: number; y: number; z: number }) {
    const i = this.free.pop(); if (i === undefined) return;
    const q = this.parts[i]; Object.assign(q, { vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.2, sizeEnd: 0.2, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0 }, p);
  }
  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i]; if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age >= p.life) { p.age = p.life; this.alpha[i] = 0; this.pos[i * 3 + 1] = -999; this.free.push(i); continue; }
      const t = p.age / p.life;
      p.vy -= p.grav * dt; const dr = 1 - Math.min(0.95, p.drag * dt); p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = lerp(p.size, p.sizeEnd, t);
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85; this.alpha[i] = p.a * clamp(fade, 0, 1);
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true; (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ decals
class DecalPool {
  mesh: THREE.InstancedMesh; i = 0; count: number; dummy = new THREE.Object3D();
  constructor(scene: THREE.Scene, count: number, tex: THREE.Texture, size: number) {
    this.count = count;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 1, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(size, size), mat, count);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.receiveShadow = true;
    for (let k = 0; k < count; k++) { this.dummy.position.set(0, -999, 0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(k, this.dummy.matrix); }
    this.mesh.instanceMatrix.needsUpdate = true; scene.add(this.mesh);
  }
  add(point: THREE.Vector3, normal: THREE.Vector3, scale = 1) {
    const d = this.dummy; d.position.copy(point).addScaledVector(normal, 0.006);
    d.lookAt(point.clone().add(normal)); d.rotateZ(Math.random() * Math.PI * 2); d.scale.setScalar(scale); d.updateMatrix();
    this.mesh.setMatrixAt(this.i, d.matrix); this.mesh.instanceMatrix.needsUpdate = true; this.i = (this.i + 1) % this.count;
  }
}

// ------------------------------------------------------------------ physics debris (shells & chunks)
interface Debris { body: RAPIER.RigidBody; idx: number; t: number; tinked: boolean; alive: boolean; }
class DebrisPool {
  mesh: THREE.InstancedMesh; items: Debris[] = []; dummy = new THREE.Object3D(); free: number[] = [];
  constructor(scene: THREE.Scene, private physics: Physics, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, private half: [number, number, number], private cyl = false) {
    this.mesh = new THREE.InstancedMesh(geo, mat, count); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    for (let i = 0; i < count; i++) { this.dummy.position.set(0, -999, 0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); this.free.push(i); this.items.push(null as any); }
    scene.add(this.mesh);
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, angVel: THREE.Vector3, quat?: THREE.Quaternion) {
    let idx = this.free.pop();
    if (idx === undefined) { // recycle oldest
      let oldest = -1, ot = -1; for (let i = 0; i < this.items.length; i++) { const it = this.items[i]; if (it && it.alive && it.t > ot) { ot = it.t; oldest = i; } }
      if (oldest < 0) return; this.release(oldest); idx = this.free.pop()!;
    }
    const R = this.physics.R;
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: angVel.x, y: angVel.y, z: angVel.z }).setLinearDamping(0.15).setAngularDamping(0.4).setCcdEnabled(true));
    if (quat) body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    const desc = this.cyl ? R.ColliderDesc.cylinder(this.half[1], this.half[0]) : R.ColliderDesc.cuboid(this.half[0], this.half[1], this.half[2]);
    desc.setCollisionGroups(cg(G.DEBRIS, G.WORLD)).setRestitution(0.35).setFriction(0.6).setDensity(2);
    this.physics.world.createCollider(desc, body);
    this.items[idx] = { body, idx, t: 0, tinked: false, alive: true };
  }
  release(i: number) { const it = this.items[i]; if (!it || !it.alive) return; this.physics.world.removeRigidBody(it.body); it.alive = false; this.dummy.position.set(0, -999, 0); this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); this.free.push(i); this.mesh.instanceMatrix.needsUpdate = true; }
  update(dt: number, maxAge: number, onSettle?: (p: THREE.Vector3) => void) {
    let any = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]; if (!it || !it.alive) continue; it.t += dt; any = true;
      if (it.t > maxAge) { this.release(i); continue; }
      const p = it.body.translation(), q = it.body.rotation();
      this.dummy.position.set(p.x, p.y, p.z); this.dummy.quaternion.set(q.x, q.y, q.z, q.w); this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix);
      if (!it.tinked && it.t > 0.25) { const v = it.body.linvel(); if (Math.hypot(v.x, v.y, v.z) < 1.2) { it.tinked = true; onSettle?.(this.dummy.position); } }
      if (p.y < -20) this.release(i);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ Effects facade
export class Effects {
  add: ParticlePool; norm: ParticlePool; holes: DecalPool; scorch: DecalPool; sandHoles: DecalPool;
  shells: DebrisPool; chunks: DebrisPool;
  lights: { l: THREE.PointLight; t: number; life: number; i0: number }[] = [];
  flashes: { s: THREE.Sprite; t: number }[] = [];
  flashTex: THREE.Texture;
  motes: THREE.Points; moteData: Float32Array;
  private _v = new THREE.Vector3(); private _q = new THREE.Quaternion();

  constructor(private scene: THREE.Scene, private physics: Physics, private audio: AudioManager) {
    const soft = makeSoftCircle(64, 1.8), smoke = makeSmoke(128);
    this.add = new ParticlePool(scene, 1500, soft, true);
    this.norm = new ParticlePool(scene, 2200, smoke, false);
    this.holes = new DecalPool(scene, 220, makeBulletHole(), 0.09);
    this.sandHoles = new DecalPool(scene, 120, makeBulletHole(), 0.16);
    this.scorch = new DecalPool(scene, 12, makeScorch(), 3.2);
    this.flashTex = makeFlash();
    const brass = new THREE.MeshStandardMaterial({ color: 0xd9b25c, metalness: 1, roughness: 0.35 });
    this.shells = new DebrisPool(scene, physics, new THREE.CylinderGeometry(0.006, 0.0065, 0.05, 8), brass, 40, [0.0065, 0.025, 0.0065], true);
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });
    this.chunks = new DebrisPool(scene, physics, new THREE.BoxGeometry(0.12, 0.09, 0.1), chunkMat, 30, [0.06, 0.045, 0.05]);
    // dust motes
    const N = 500; this.moteData = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.moteData[i * 3] = rand(-9, 9); this.moteData[i * 3 + 1] = rand(-5, 8); this.moteData[i * 3 + 2] = rand(-9, 9); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(this.moteData, 3).setUsage(THREE.DynamicDrawUsage));
    const mm = new THREE.PointsMaterial({ size: 0.009, map: soft, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffe9c4, sizeAttenuation: true });
    this.motes = new THREE.Points(mg, mm); this.motes.frustumCulled = false; scene.add(this.motes);
  }

  update(dt: number, camPos: THREE.Vector3, time: number) {
    this.add.update(dt); this.norm.update(dt);
    this.shells.update(dt, 9, (p) => { this.audio.grenadeBounce(p, 0.25); });
    this.chunks.update(dt, 12);
    for (let i = this.lights.length - 1; i >= 0; i--) { const L = this.lights[i]; L.t += dt; const k = 1 - L.t / L.life; if (k <= 0) { this.scene.remove(L.l); this.lights.splice(i, 1); } else L.l.intensity = L.i0 * k * k; }
    for (let i = this.flashes.length - 1; i >= 0; i--) { const F = this.flashes[i]; F.t -= dt; if (F.t <= 0) { this.scene.remove(F.s); this.flashes.splice(i, 1); } }
    // motes drift & wrap around camera
    const d = this.moteData; const R = 9;
    for (let i = 0; i < d.length; i += 3) {
      d[i] += Math.sin(time * 0.6 + i) * 0.08 * dt + 0.15 * dt; d[i + 1] += Math.cos(time * 0.4 + i * 0.3) * 0.05 * dt; d[i + 2] += 0.05 * dt;
      if (d[i] - camPos.x > R) d[i] -= 2 * R; else if (d[i] - camPos.x < -R) d[i] += 2 * R;
      if (d[i + 2] - camPos.z > R) d[i + 2] -= 2 * R; else if (d[i + 2] - camPos.z < -R) d[i + 2] += 2 * R;
      if (d[i + 1] - camPos.y > 8) d[i + 1] -= 13; else if (d[i + 1] - camPos.y < -5) d[i + 1] += 13;
    }
    (this.motes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  light(pos: THREE.Vector3, color: number, intensity: number, dist: number, life: number) {
    const l = new THREE.PointLight(color, intensity, dist, 2); l.position.copy(pos); this.scene.add(l); this.lights.push({ l, t: 0, life, i0: intensity });
  }

  /** World-space muzzle flash (bots). */
  muzzleFlashWorld(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1) {
    const m = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd8a0, rotation: Math.random() * 6.28 });
    const s = new THREE.Sprite(m); s.position.copy(pos).addScaledVector(dir, 0.15); s.scale.setScalar(rand(0.45, 0.7) * scale); this.scene.add(s); this.flashes.push({ s, t: 0.045 });
    this.light(pos.clone().addScaledVector(dir, 0.3), 0xffb060, 25 * scale, 7, 0.07);
    for (let i = 0; i < 4; i++) this.norm.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * rand(1, 3) + rand(-0.4, 0.4), vy: rand(0.2, 0.8), vz: dir.z * rand(1, 3) + rand(-0.4, 0.4), life: rand(0.5, 0.9), size: 0.12, sizeEnd: 0.5, r: 0.7, g: 0.68, b: 0.62, a: 0.35, drag: 2 });
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: string, dir: THREE.Vector3) {
    const n = normal; const refl = this._v.copy(dir).reflect(n);
    if (surface === 'metal') {
      for (let i = 0; i < 14; i++) this.add.emit({ x: point.x, y: point.y, z: point.z, vx: refl.x * rand(1, 4) + n.x * rand(0, 3) + rand(-2.5, 2.5), vy: refl.y * rand(1, 4) + n.y * rand(0, 3) + rand(-1, 3), vz: refl.z * rand(1, 4) + n.z * rand(0, 3) + rand(-2.5, 2.5), life: rand(0.25, 0.6), size: rand(0.03, 0.06), sizeEnd: 0.01, r: 1, g: rand(0.6, 0.85), b: 0.3, a: 1, grav: 9.8, drag: 0.5 });
      for (let i = 0; i < 3; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * rand(0.5, 1.5) + rand(-0.3, 0.3), vy: n.y * rand(0.5, 1.5) + rand(0.2, 0.6), vz: n.z * rand(0.5, 1.5) + rand(-0.3, 0.3), life: rand(0.4, 0.8), size: 0.08, sizeEnd: 0.35, r: 0.55, g: 0.55, b: 0.55, a: 0.4, drag: 2 });
      this.light(point.clone().addScaledVector(n, 0.05), 0xffc080, 4, 2, 0.06);
      this.holes.add(point, n, rand(0.7, 1.0));
      this.audio.impact(point, true); if (Math.random() < 0.25) this.audio.ricochet(point);
    } else if (surface === 'sand' || surface === 'rock') {
      const c = surface === 'sand' ? [0.78, 0.68, 0.5] : [0.6, 0.52, 0.42];
      for (let i = 0; i < 10; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * rand(0.6, 2.2) + rand(-0.9, 0.9), vy: n.y * rand(1.2, 3.0) + rand(0, 1), vz: n.z * rand(0.6, 2.2) + rand(-0.9, 0.9), life: rand(0.6, 1.3), size: rand(0.12, 0.25), sizeEnd: rand(0.5, 0.9), r: c[0], g: c[1], b: c[2], a: 0.55, grav: 1.5, drag: 1.6 });
      for (let i = 0; i < 6; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * rand(1, 4) + rand(-2, 2), vy: n.y * rand(2, 5) + rand(0, 2), vz: n.z * rand(1, 4) + rand(-2, 2), life: rand(0.4, 0.9), size: 0.03, sizeEnd: 0.02, r: c[0] * 0.8, g: c[1] * 0.8, b: c[2] * 0.8, a: 0.9, grav: 9.8 });
      if (surface === 'sand') this.sandHoles.add(point, n, rand(0.8, 1.2)); else this.holes.add(point, n, rand(0.8, 1.1));
      this.audio.impact(point, false);
    } else if (surface === 'wood') {
      for (let i = 0; i < 8; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * rand(1, 3) + rand(-1.5, 1.5), vy: n.y * rand(1, 3) + rand(0.5, 2), vz: n.z * rand(1, 3) + rand(-1.5, 1.5), life: rand(0.4, 0.9), size: 0.035, sizeEnd: 0.02, r: 0.55, g: 0.42, b: 0.28, a: 1, grav: 9.8 });
      for (let i = 0; i < 3; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * rand(0.4, 1.2), vy: n.y * rand(0.4, 1.2) + 0.3, vz: n.z * rand(0.4, 1.2), life: 0.6, size: 0.08, sizeEnd: 0.3, r: 0.6, g: 0.5, b: 0.4, a: 0.4, drag: 2 });
      this.holes.add(point, n, rand(0.8, 1.1)); this.audio.impact(point, false);
    } else if (surface === 'none') { return; }
    else { // concrete & default
      for (let i = 0; i < 9; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * rand(1, 3) + rand(-1.5, 1.5), vy: n.y * rand(1, 3) + rand(0.5, 2), vz: n.z * rand(1, 3) + rand(-1.5, 1.5), life: rand(0.4, 0.9), size: 0.03, sizeEnd: 0.02, r: 0.6, g: 0.58, b: 0.55, a: 1, grav: 9.8 });
      for (let i = 0; i < 5; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * rand(0.5, 1.5) + rand(-0.5, 0.5), vy: n.y * rand(0.5, 1.5) + rand(0.3, 0.8), vz: n.z * rand(0.5, 1.5) + rand(-0.5, 0.5), life: rand(0.5, 1.0), size: 0.1, sizeEnd: 0.45, r: 0.62, g: 0.6, b: 0.56, a: 0.45, drag: 2 });
      this.holes.add(point, n, rand(0.8, 1.2)); this.audio.impact(point, false);
    }
  }

  blood(point: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 12; i++) this.norm.emit({ x: point.x, y: point.y, z: point.z, vx: dir.x * rand(0.5, 2.5) + rand(-1.2, 1.2), vy: rand(-0.5, 1.5), vz: dir.z * rand(0.5, 2.5) + rand(-1.2, 1.2), life: rand(0.35, 0.7), size: rand(0.05, 0.12), sizeEnd: rand(0.15, 0.3), r: 0.45, g: 0.03, b: 0.02, a: 0.8, grav: 4, drag: 1.5 });
    this.audio.bodyHit(point);
  }

  shell(pos: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3, type: string) {
    const v = new THREE.Vector3().addScaledVector(right, rand(1.6, 2.6)).addScaledVector(up, rand(1.2, 2.2)).addScaledVector(back, rand(0.2, 0.8));
    const scale = type === 'sniper' ? 1.4 : type === 'shotgun' ? 1.3 : type === 'pistol' ? 0.85 : 1;
    void scale;
    this.shells.spawn(pos, v, new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)), this._q.setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3))));
  }

  explosion(pos: THREE.Vector3, groundNormal?: THREE.Vector3) {
    const p = pos;
    this.light(p.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xffb266, 220, 22, 0.35);
    // core flash
    const m = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffe0b0, rotation: Math.random() * 6.28 });
    const s = new THREE.Sprite(m); s.position.copy(p).add(new THREE.Vector3(0, 0.6, 0)); s.scale.setScalar(5.5); this.scene.add(s); this.flashes.push({ s, t: 0.08 });
    // fireball
    for (let i = 0; i < 46; i++) { const a = rand(0, 6.28), e = rand(0.1, 1.4), sp = rand(2, 9); const vx = Math.cos(a) * Math.cos(e) * sp, vy = Math.sin(e) * sp, vz = Math.sin(a) * Math.cos(e) * sp; this.add.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx, vy, vz, life: rand(0.35, 0.7), size: rand(0.7, 1.6), sizeEnd: rand(1.2, 2.4), r: 1, g: rand(0.45, 0.75), b: 0.15, a: 0.95, drag: 3 }); }
    // sparks
    for (let i = 0; i < 70; i++) { const a = rand(0, 6.28), e = rand(0, 1.5), sp = rand(6, 18); this.add.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, life: rand(0.4, 1.1), size: rand(0.03, 0.07), sizeEnd: 0.01, r: 1, g: 0.75, b: 0.35, a: 1, grav: 9.8, drag: 0.8 }); }
    // smoke
    for (let i = 0; i < 70; i++) { const a = rand(0, 6.28), e = rand(0.2, 1.5), sp = rand(1, 5); const g = rand(0.22, 0.4); this.norm.emit({ x: p.x, y: p.y + 0.5, z: p.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1.2, vz: Math.sin(a) * Math.cos(e) * sp, life: rand(1.8, 3.8), size: rand(0.8, 1.6), sizeEnd: rand(3, 5.5), r: g, g: g * 0.95, b: g * 0.9, a: 0.7, drag: 1.4, grav: -0.35 }); }
    // ground dust ring
    for (let i = 0; i < 46; i++) { const a = rand(0, 6.28), sp = rand(5, 12); this.norm.emit({ x: p.x, y: p.y + 0.15, z: p.z, vx: Math.cos(a) * sp, vy: rand(0.4, 1.6), vz: Math.sin(a) * sp, life: rand(0.9, 1.8), size: rand(0.6, 1.2), sizeEnd: rand(2, 3.5), r: 0.72, g: 0.62, b: 0.46, a: 0.6, drag: 3.2, grav: 0.6 }); }
    // debris chunks
    for (let i = 0; i < 12; i++) { const a = rand(0, 6.28), e = rand(0.5, 1.5), sp = rand(5, 13); this.chunks.spawn(p.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp), new THREE.Vector3(rand(-15, 15), rand(-15, 15), rand(-15, 15))); }
    if (groundNormal) this.scorch.add(p, groundNormal, rand(0.9, 1.2));
  }

  /** Dust kicked up by footsteps / slides. */
  footDust(pos: THREE.Vector3, amount = 1) {
    for (let i = 0; i < 4 * amount; i++) this.norm.emit({ x: pos.x + rand(-0.15, 0.15), y: pos.y + 0.05, z: pos.z + rand(-0.15, 0.15), vx: rand(-0.6, 0.6), vy: rand(0.2, 0.7), vz: rand(-0.6, 0.6), life: rand(0.5, 1.0), size: 0.15, sizeEnd: 0.6, r: 0.76, g: 0.66, b: 0.5, a: 0.3, drag: 2.5 });
  }
}
