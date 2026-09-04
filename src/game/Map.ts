import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Physics, G } from './Physics';
import { pbr, flat } from './Materials';
import { fbm } from './Noise';
import { DEG, rand, smoothstep, clamp } from './util';

export interface Ladder { id: number; center: THREE.Vector3; halfW: number; bottom: number; top: number; /** direction from climber into the ladder wall */ facing: THREE.Vector3; }
export interface Waypoint { id: number; pos: THREE.Vector3; links: number[]; ladder?: number; }
export interface SpawnPoint { pos: THREE.Vector3; yaw: number; }

type BoxOpts = { rot?: [number, number, number]; tile?: number; collide?: boolean; shadow?: boolean; receive?: boolean; surface?: string };

/** Accumulates geometry per material, merges into few meshes, and registers static colliders. */
export class Builder {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private noShadow = new Set<THREE.Material>();
  constructor(private physics: Physics, private group: THREE.Group) {}

  private push(mat: THREE.Material, geo: THREE.BufferGeometry, m: THREE.Matrix4) {
    geo.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(geo);
  }

  static tileBox(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile: number) {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z ; 4 verts each in order
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) { const [du, dv] = dims[f]; for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * du / tile, uv.getY(k) * dv / tile); } }
    uv.needsUpdate = true;
  }

  box(mat: THREE.Material, size: [number, number, number], pos: [number, number, number], o: BoxOpts = {}) {
    const [w, h, d] = size; const geo = new THREE.BoxGeometry(w, h, d);
    Builder.tileBox(geo, w, h, d, o.tile ?? 2);
    const q = new THREE.Quaternion(); if (o.rot) q.setFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2]));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), q, new THREE.Vector3(1, 1, 1));
    this.push(mat, geo, m);
    if (o.collide !== false) this.physics.addStaticBox(new THREE.Vector3(...pos), new THREE.Vector3(w, h, d), o.rot ? q : undefined, G.WORLD, { surface: o.surface ?? this.surfaceOf(mat) });
    if (o.shadow === false) this.noShadow.add(mat);
  }

  cyl(mat: THREE.Material, r: number, h: number, pos: [number, number, number], o: BoxOpts & { seg?: number; rTop?: number; open?: boolean } = {}) {
    const seg = o.seg ?? 24; const geo = new THREE.CylinderGeometry(o.rTop ?? r, r, h, seg, 1, !!o.open);
    const tile = o.tile ?? 2; const uv = geo.attributes.uv as THREE.BufferAttribute; const circ = 2 * Math.PI * r;
    for (let i = 0; i < uv.count; i++) { uv.setXY(i, uv.getX(i) * circ / tile, uv.getY(i) * h / tile); }
    uv.needsUpdate = true;
    const q = new THREE.Quaternion(); if (o.rot) q.setFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2]));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), q, new THREE.Vector3(1, 1, 1));
    this.push(mat, geo, m);
    if (o.collide !== false) this.physics.addStaticCylinder(new THREE.Vector3(...pos), r, h, o.rot ? q : undefined, G.WORLD, { surface: o.surface ?? this.surfaceOf(mat) });
  }

  custom(mat: THREE.Material, geo: THREE.BufferGeometry, m: THREE.Matrix4, collide: 'trimesh' | 'hull' | false = false, surface?: string) {
    const g = geo.clone(); this.push(mat, g, m);
    if (collide) {
      const mesh = new THREE.Mesh(g); mesh.updateMatrixWorld();
      if (collide === 'trimesh') this.physics.addStaticTrimesh(mesh, G.WORLD, { surface: surface ?? this.surfaceOf(mat) });
      else { const pts = (g.attributes.position as THREE.BufferAttribute).array as Float32Array; const c = this.physics.world.createCollider(this.physics.R.ColliderDesc.convexHull(pts)!.setCollisionGroups((G.WORLD << 16) | G.ALL)); this.physics.setOwner(c, { surface: surface ?? this.surfaceOf(mat) }); }
    }
  }

  private surfaceOf(mat: THREE.Material) { return (mat.userData?.surface as string) ?? 'concrete'; }

  finish(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [mat, geos] of this.parts) {
      const clean = geos.map((g) => { const c = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k); return c; });
      const merged = mergeGeometries(clean, false); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = !this.noShadow.has(mat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      this.group.add(mesh); meshes.push(mesh);
    }
    return meshes;
  }
}

let trackTex: THREE.Texture | null = null;
function trackAlpha() {
  if (!trackTex) {
    const size = 128; const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
    const img = g.createImageData(size, size); const d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const u = x / (size - 1), v = y / (size - 1); const ex = Math.min(u, 1 - u) / 0.5, ey = Math.min(v, 1 - v) / 0.5; const a = Math.pow(Math.min(1, ex * 1.6), 1.4) * Math.pow(Math.min(1, ey * 6), 1.0); const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = Math.round(255 * a); d[i + 3] = 255; }
    g.putImageData(img, 0, 0); trackTex = new THREE.CanvasTexture(c); trackTex.wrapS = trackTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return trackTex;
}
let chainTex: THREE.Texture | null = null;
/** Procedural chain-link fence material (alpha-tested diamond mesh). */
function chainLinkMaterial() {
  if (!chainTex) {
    const size = 128; const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!;
    g.clearRect(0, 0, size, size); g.strokeStyle = '#9a9a96'; g.lineWidth = 5; g.lineCap = 'round';
    const cell = size / 2;
    for (let i = -2; i <= 4; i++) { g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell + size, size); g.stroke(); g.beginPath(); g.moveTo(i * cell, size); g.lineTo(i * cell + size, 0); g.stroke(); }
    chainTex = new THREE.CanvasTexture(c); chainTex.wrapS = chainTex.wrapT = THREE.RepeatWrapping; chainTex.colorSpace = THREE.SRGBColorSpace; chainTex.anisotropy = 8;
  }
  return new THREE.MeshStandardMaterial({ map: chainTex, alphaMap: chainTex, transparent: false, alphaTest: 0.5, roughness: 0.5, metalness: 0.9, side: THREE.DoubleSide, color: 0xffffff });
}

export class RustMap {
  group = new THREE.Group();
  spawns: SpawnPoint[] = [];
  waypoints: Waypoint[] = [];
  ladders: Ladder[] = [];
  /** half-size of the playable square (fence at PLAY-0.6, hard boundary at PLAY) */
  static PLAY = 48;
  bounds = 48;
  protected heights!: Float32Array; protected hSeg = 180; protected hSize = 240;
  groundMesh!: THREE.Mesh;
  mats!: Record<string, THREE.Material>;

  constructor(protected physics: Physics) {}

  groundHeight(x: number, z: number) {
    const r = Math.hypot(x, z) * 0.55 + Math.max(Math.abs(x), Math.abs(z)) * 0.45;
    let h = smoothstep(50, 72, r) * 7 + smoothstep(68, 100, r) * 14;
    h += fbm(x * 0.06, z * 0.06, 3) * 0.6 * smoothstep(46, 56, r);
    h += fbm(x * 0.9 + 3, z * 0.9 + 7, 2) * 0.025;
    h += fbm(x * 0.25, z * 0.25, 2) * 0.05;
    return h;
  }

  protected makeMaterials() {
    const M: Record<string, THREE.Material> = {
      sand: pbr('gravelly_sand', { tile: 5, normalScale: 0.9 }),
      sandFar: pbr('aerial_sand', { tile: 14, normalScale: 0.5 }),
      dirt: pbr('dirt_aerial_02', { tile: 6 }),
      steel: pbr('rusty_metal_02', { tile: 1.5, normalScale: 0.8 }),
      steelDark: pbr('metal_plate', { tile: 1.2, color: 0x8a8a88 }),
      rustCoarse: pbr('rust_coarse_01', { tile: 1.2 }),
      grate: pbr('metal_grate_rusty', { tile: 0.8, side: THREE.DoubleSide }),
      corrRust: pbr('rusty_corrugated_iron', { tile: 1.6, side: THREE.DoubleSide }),
      corr: pbr('corrugated_iron_02', { tile: 1.6, side: THREE.DoubleSide, color: 0xb9b6ad }),
      contBlue: pbr('corrugated_iron_02', { tile: 1.5, color: 0x4a74b8, roughness: 0.75 }),
      contRed: pbr('corrugated_iron_02', { tile: 1.5, color: 0xb8433a, roughness: 0.75 }),
      contGreen: pbr('corrugated_iron_02', { tile: 1.5, color: 0x6a8a62, roughness: 0.75 }),
      contYellow: pbr('corrugated_iron_02', { tile: 1.5, color: 0xd6a63e, roughness: 0.75 }),
      contRust: pbr('rusty_corrugated_iron', { tile: 1.5 }),
      paintedMetal: pbr('acg_PaintedMetal009', { tile: 1.5 }),
      concrete: pbr('concrete_wall_006', { tile: 2.2 }),
      concreteFloor: pbr('concrete_floor_worn_001', { tile: 2.5 }),
      concreteBlock: pbr('concrete_block_wall_02', { tile: 2 }),
      cracked: pbr('cracked_concrete', { tile: 2.5 }),
      planks: pbr('old_planks_02', { tile: 1.4 }),
      plywood: pbr('plywood', { tile: 1.1 }),
      roughWood: pbr('rough_wood', { tile: 1.0 }),
      darkPlanks: pbr('dark_planks', { tile: 1.2 }),
      greenMetal: pbr('green_metal_rust', { tile: 1.6 }),
      rustyShutter: pbr('rusted_shutter', { tile: 2 }),
      pipe: pbr('rusty_metal', { tile: 1.4 }),
      pipe2: pbr('rusty_metal_04', { tile: 1.2 }),
      barrelBlue: pbr('blue_metal_plate', { tile: 0.9 }),
      barrelRust: pbr('rusty_metal_04', { tile: 0.9 }),
      sandstone: pbr('rock_boulder_dry', { tile: 3.0, color: 0xcdbfa8 }),
      laterite: pbr('cliff_side', { tile: 3.0, color: 0xd6c3a6 }),
      rock3: pbr('rock_05', { tile: 2.5 }),
      scrub: flat(0x4f5a3a, 0.95, 0),
      sandbag: pbr('aerial_sand', { tile: 0.6, color: 0xc9b27e }),
      rubber: flat(0x161616, 0.85, 0),
      steelPainted: pbr('painted_metal_shutter', { tile: 1.5 }),
      cable: flat(0x1a1a1a, 0.7),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x8fb0c0, roughness: 0.15, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.6, thickness: 0.05 }),
      tarp: flat(0x5a6b4a, 0.9, 0, { side: THREE.DoubleSide }),
    };
    const surf: Record<string, string> = { rock3: 'rock', scrub: 'cloth', sand: 'sand', sandFar: 'sand', dirt: 'sand', steel: 'metal', steelDark: 'metal', rustCoarse: 'metal', grate: 'metal', corrRust: 'metal', corr: 'metal', contBlue: 'metal', contRed: 'metal', contGreen: 'metal', contYellow: 'metal', contRust: 'metal', paintedMetal: 'metal', concrete: 'concrete', concreteFloor: 'concrete', concreteBlock: 'concrete', cracked: 'concrete', planks: 'wood', plywood: 'wood', roughWood: 'wood', darkPlanks: 'wood', greenMetal: 'metal', rustyShutter: 'metal', pipe: 'metal', pipe2: 'metal', barrelBlue: 'metal', barrelRust: 'metal', sandstone: 'rock', laterite: 'rock', sandbag: 'sand', rubber: 'rubber', steelPainted: 'metal', cable: 'metal', glass: 'glass', tarp: 'cloth' };
    for (const k of Object.keys(M)) M[k].userData.surface = surf[k] ?? 'concrete';
    this.mats = M;
    return M;
  }

  build() {
    const M = this.makeMaterials();
    const B = new Builder(this.physics, this.group);
    this.buildGround(M);
    this.buildTower(B, M);
    this.buildStructures(B, M);
    this.buildProps(B, M);
    this.buildOuterRing(B, M);
    this.buildPerimeter(B, M);
    B.finish();
    // make the freshly created colliders visible to scene queries before we probe the map for waypoints
    const w: any = this.physics.world; if (typeof w.updateSceneQueries === 'function') w.updateSceneQueries(); else { const ts = w.timestep; w.timestep = 1e-6; w.step(); w.timestep = ts; }
    this.defineSpawns();
    this.defineWaypoints();
    return this.group;
  }

  // ---------------------------------------------------------------- GROUND
  protected buildGround(M: Record<string, THREE.Material>) {
    const size = this.hSize, seg = this.hSeg;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, this.groundHeight(x, z)); }
    geo.computeVertexNormals();
    // UVs in world meters for consistent tiling (material tile handles repeat)
    const uv = geo.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    // vertex color: blend factor for dirt tracks/patches via a second attribute
    const mesh = new THREE.Mesh(geo, M.sand); mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false;
    this.group.add(mesh); this.groundMesh = mesh;
    this.physics.addStaticTrimesh(mesh, G.WORLD, { surface: 'sand' });
    // far ground
    const far = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1).rotateX(-Math.PI / 2), M.sandFar);
    far.position.y = 21.5; far.receiveShadow = false; far.matrixAutoUpdate = false; far.updateMatrix(); this.group.add(far);
    // dirt patches / tire tracks as decal-like planes slightly above ground
    const track = (x: number, z: number, len: number, yaw: number, w = 0.9) => {
      const g = new THREE.PlaneGeometry(w, len, 1, 8).rotateX(-Math.PI / 2);
      const p = g.attributes.position as THREE.BufferAttribute; const u = g.attributes.uv as THREE.BufferAttribute;
      const mat = (M.dirt as THREE.MeshStandardMaterial).clone(); mat.transparent = true; mat.opacity = 0.7; mat.alphaMap = trackAlpha(); mat.depthWrite = false; mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.color.set(0xc9b79a);
      const m = new THREE.Mesh(g, mat); m.rotation.y = yaw; m.position.set(x, 0, z); m.updateMatrix();
      // second UV set for the alpha fade (0..1 across the strip), first set tiles the dirt
      const uv2 = new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2);
      for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3(p.getX(i), 0, p.getZ(i)).applyMatrix4(m.matrix); p.setY(i, this.groundHeight(v.x, v.z) - m.position.y + 0.02); uv2.setXY(i, u.getX(i), u.getY(i)); u.setXY(i, u.getX(i) * w / 3, u.getY(i) * len / 3); }
      g.setAttribute('uv1', uv2); mat.alphaMap!.channel = 1;
      m.receiveShadow = true; m.matrixAutoUpdate = false; this.group.add(m);
    };
    track(-12, 4, 40, 0.15 * DEG * 10); track(-10.5, 4, 40, 0.15 * DEG * 10, 0.8);
    track(10, -12, 30, 80 * DEG); track(10, -10.6, 30, 80 * DEG, 0.8);
    track(6, 16, 26, -20 * DEG); track(7.4, 16, 26, -20 * DEG, 0.8);
    track(-30, -20, 60, 8 * DEG); track(-28.6, -20, 60, 8 * DEG, 0.8);
    track(30, 18, 50, 95 * DEG); track(30, 19.4, 50, 95 * DEG, 0.8);
    track(0, 36, 70, 88 * DEG); track(0, 37.4, 70, 88 * DEG, 0.8);
  }

  // ---------------------------------------------------------------- TOWER
  protected buildTower(B: Builder, M: Record<string, THREE.Material>) {
    const cx = 0, cz = -2; // tower center
    const half = 3.0; const L1 = 3.4, L2 = 6.8, TOP = 10.2;
    const col = 0.32;
    // concrete footing
    B.box(M.cracked, [8.5, 0.3, 8.5], [cx, 0.15, cz], { tile: 3 });
    // columns (slightly tapered look via two segments)
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      B.box(M.steel, [col, TOP + 0.6, col], [cx + sx * half, (TOP + 0.6) / 2 + 0.3, cz + sz * half], { tile: 1.2 });
    }
    // horizontal beams each level + cross braces on each face
    const beam = (y: number) => {
      B.box(M.steel, [half * 2 + col, 0.22, 0.22], [cx, y, cz - half], { tile: 1.2 });
      B.box(M.steel, [half * 2 + col, 0.22, 0.22], [cx, y, cz + half], { tile: 1.2 });
      B.box(M.steel, [0.22, 0.22, half * 2 + col], [cx - half, y, cz], { tile: 1.2 });
      B.box(M.steel, [0.22, 0.22, half * 2 + col], [cx + half, y, cz], { tile: 1.2 });
    };
    beam(L1); beam(L2); beam(TOP); beam(1.6);
    const braceLen = Math.hypot(half * 2, L1 - 1.6) ;
    const brace = (y0: number, y1: number) => {
      const len = Math.hypot(half * 2, y1 - y0); const ang = Math.atan2(y1 - y0, half * 2); const ym = (y0 + y1) / 2;
      B.box(M.steelDark, [len, 0.12, 0.12], [cx, ym, cz - half], { rot: [0, 0, ang], tile: 1, collide: false });
      B.box(M.steelDark, [len, 0.12, 0.12], [cx, ym, cz - half], { rot: [0, 0, -ang], tile: 1, collide: false });
      B.box(M.steelDark, [len, 0.12, 0.12], [cx, ym, cz + half], { rot: [0, 0, ang], tile: 1, collide: false });
      B.box(M.steelDark, [len, 0.12, 0.12], [cx, ym, cz + half], { rot: [0, 0, -ang], tile: 1, collide: false });
      B.box(M.steelDark, [0.12, 0.12, len], [cx - half, ym, cz], { rot: [ang, 0, 0], tile: 1, collide: false });
      B.box(M.steelDark, [0.12, 0.12, len], [cx - half, ym, cz], { rot: [-ang, 0, 0], tile: 1, collide: false });
      B.box(M.steelDark, [0.12, 0.12, len], [cx + half, ym, cz], { rot: [ang, 0, 0], tile: 1, collide: false });
      B.box(M.steelDark, [0.12, 0.12, len], [cx + half, ym, cz], { rot: [-ang, 0, 0], tile: 1, collide: false });
    };
    void braceLen; brace(1.6, L1); brace(L1, L2); brace(L2, TOP);
    // LEVEL 1 platform: full grate (the stair to L2 sits on top of it)
    B.box(M.grate, [half * 2, 0.08, half * 2], [cx, L1 + 0.15, cz], { tile: 0.8, surface: 'metal' });
    // LEVEL 2 platform: U shaped leaving the stair gap on the west side north part
    B.box(M.grate, [half * 2 - 1.3, 0.08, half * 2], [cx + 0.65, L2 + 0.15, cz], { tile: 0.8 });
    B.box(M.grate, [1.3, 0.08, 2.0], [cx - half + 0.65, L2 + 0.15, cz - half + 1.0], { tile: 0.8 });
    // TOP platform: planks with a ladder hole (east side)
    B.box(M.planks, [half * 2 + 0.6, 0.12, half * 2 - 1.2], [cx, TOP + 0.16, cz - 0.6], { tile: 1.4, surface: 'wood' });
    B.box(M.planks, [half * 2 + 0.6 - 1.2, 0.12, 1.2], [cx - 0.6, TOP + 0.16, cz + half - 0.6], { tile: 1.4 });
    // railings on top
    const railY = TOP + 0.22 + 0.55;
    const rail = (len: number, pos: [number, number, number], alongX: boolean) => {
      B.box(M.steelDark, alongX ? [len, 0.05, 0.05] : [0.05, 0.05, len], pos, { tile: 1, collide: false });
      B.box(M.steelDark, alongX ? [len, 0.05, 0.05] : [0.05, 0.05, len], [pos[0], pos[1] - 0.45, pos[2]], { tile: 1, collide: false });
      // invisible-ish collider as a thin wall so players don't walk off accidentally (low)
      B.box(M.steelDark, alongX ? [len, 0.02, 0.02] : [0.02, 0.02, len], [pos[0], pos[1] - 0.2, pos[2]], { tile: 1, collide: true, shadow: false });
    };
    rail(half * 2 + 0.6, [cx, railY, cz - half - 0.3], true); rail(half * 2 + 0.6, [cx, railY, cz + half + 0.3], true);
    rail(half * 2 + 0.6, [cx - half - 0.3, railY, cz], false); rail(half * 2 + 0.6, [cx + half + 0.3, railY, cz], false);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) B.box(M.steelDark, [0.06, 1.05, 0.06], [cx + sx * (half + 0.3), TOP + 0.22 + 0.52, cz + sz * (half + 0.3)], { collide: false });
    // railings on the open platforms (gap on L1's east edge where the stair arrives; L2 also fences the stair hole)
    const railing = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      const dx = x1 - x0, dz = z1 - z0; const len = Math.hypot(dx, dz); const yaw = Math.atan2(dx, dz); const n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i <= n; i++) { const t = i / n; B.box(M.steelDark, [0.05, 1.0, 0.05], [x0 + dx * t, y + 0.5, z0 + dz * t], { collide: false }); }
      B.box(M.steelDark, [0.05, 0.05, len], [x0 + dx / 2, y + 1.0, z0 + dz / 2], { rot: [0, yaw, 0], collide: false });
      B.box(M.steelDark, [0.05, 0.05, len], [x0 + dx / 2, y + 0.55, z0 + dz / 2], { rot: [0, yaw, 0], collide: false });
      this.physics.addStaticBox(new THREE.Vector3(x0 + dx / 2, y + 0.55, z0 + dz / 2), new THREE.Vector3(0.04, 0.6, len), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), G.WORLD, { surface: 'metal' });
    };
    const rl1 = L1 + 0.19, rl2 = L2 + 0.19; const e = half + 0.1;
    railing(cx - e, cz - e, cx + e, cz - e, rl1); railing(cx - e, cz + e, cx + e, cz + e, rl1); railing(cx - e, cz - e, cx - e, cz + e, rl1);
    railing(cx + e, cz - e, cx + e, cz - 1.2 - 0.85, rl1); railing(cx + e, cz - 1.2 + 0.85, cx + e, cz + e, rl1);
    railing(cx - e, cz - e, cx + e, cz - e, rl2); railing(cx - e, cz + e, cx + e, cz + e, rl2); railing(cx - e, cz - e, cx - e, cz + e, rl2); railing(cx + e, cz - e, cx + e, cz + e, rl2);
    railing(cx - half + 1.3, cz - 1.0, cx - half + 1.3, cz + half, rl2); // fence the stair hole on L2
    // external stair ground -> L1 on the east face (clear of the raised pipe): starts 5m east and climbs west onto the platform
    this.stair(B, M, cx + half + 0.35 + 4.6, cz - 1.2, 0, 270, L1 + 0.19, 4.6, 1.3, 'east');
    // internal stair L1 -> L2 (west side, climbing north)
    this.stair(B, M, cx - half + 0.65, cz + half - 0.2, L1 + 0.19, 180, L2 + 0.19, 4.4, 1.2, 'north');
    // ladder L2 -> TOP on the east column inner face
    const lx = cx + half - 0.45, lz = cz + half - 0.6;
    this.ladder(B, M, lx, lz, L2 + 0.2, TOP + 0.22, new THREE.Vector3(1, 0, 0));
    // rusty sign / tank on top: small water tank
    B.cyl(M.greenMetal, 0.9, 1.4, [cx - 1.6, TOP + 0.22 + 0.7, cz - 1.6], { tile: 1.5 });
    // spotlight rig
    B.box(M.steelDark, [0.1, 2.2, 0.1], [cx + half + 0.3, TOP + 1.3, cz - half - 0.3], { collide: false });
    B.box(M.steelDark, [0.5, 0.35, 0.35], [cx + half + 0.3, TOP + 2.4, cz - half - 0.3], { collide: false });
    // hanging cables from tower
    B.box(M.cable, [0.03, 0.03, 9], [cx + 1, 8.5, cz - half - 4.5], { rot: [-0.32, 0, 0], collide: false, shadow: false });
  }

  /** Straight stair: from (x, z) at y0 rising to y1 over `run` meters in direction (0=+z south, 180=-z north, 90=+x, 270=-x). */
  protected stair(B: Builder, M: Record<string, THREE.Material>, x: number, z: number, y0: number, dirDeg: number, y1: number, run: number, width: number, _label: string) {
    const rise = y1 - y0; const steps = Math.max(4, Math.round(rise / 0.22)); const stepRun = run / steps; const stepRise = rise / steps;
    const dir = new THREE.Vector3(Math.sin(dirDeg * DEG), 0, Math.cos(dirDeg * DEG));
    // visible treads
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * stepRun; const y = y0 + (i + 1) * stepRise;
      const px = x + dir.x * t, pz = z + dir.z * t;
      const isX = Math.abs(dir.x) > 0.5;
      B.box(M.grate, isX ? [stepRun + 0.02, 0.06, width] : [width, 0.06, stepRun + 0.02], [px, y - 0.03, pz], { tile: 0.8, collide: false, surface: 'metal' });
      B.box(M.steelDark, isX ? [0.04, stepRise, width] : [width, stepRise, 0.04], [px - dir.x * stepRun * 0.5, y - stepRise / 2, pz - dir.z * stepRun * 0.5], { tile: 1, collide: false });
    }
    // ramp collider (smooth) — a rotated box
    const len = Math.hypot(run, rise); const ang = Math.atan2(rise, run);
    const mx = x + dir.x * run / 2, mz = z + dir.z * run / 2, my = y0 + rise / 2 - 0.1;
    const yaw = Math.atan2(dir.x, dir.z);
    // box along local +z; rotate: pitch so that it rises along direction
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-ang, 0, 0)));
    this.physics.addStaticBox(new THREE.Vector3(mx, my, mz), new THREE.Vector3(width, 0.2, len), q, G.WORLD, { surface: 'metal' });
    // side stringers
    const isX = Math.abs(dir.x) > 0.5;
    const off = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2 + 0.03);
    for (const s of [-1, 1]) {
      const e = new THREE.Euler(isX ? 0 : -ang * Math.sign(dir.z), isX ? 0 : 0, isX ? ang * Math.sign(dir.x) : 0);
      B.box(M.steelDark, isX ? [len, 0.28, 0.06] : [0.06, 0.28, len], [mx + off.x * s, my + 0.02, mz + off.z * s], { rot: [e.x, e.y, e.z], tile: 1, collide: false });
      // handrail
      B.box(M.steelDark, isX ? [len, 0.05, 0.05] : [0.05, 0.05, len], [mx + off.x * s, my + 1.0, mz + off.z * s], { rot: [e.x, e.y, e.z], tile: 1, collide: false });
    }
  }

  protected ladder(B: Builder, M: Record<string, THREE.Material>, x: number, z: number, bottom: number, top: number, facing: THREE.Vector3) {
    const h = top - bottom + 0.6; const cy = bottom + h / 2 - 0.3;
    const side = new THREE.Vector3(-facing.z, 0, facing.x);
    for (const s of [-1, 1]) B.box(M.steelPainted, [0.06, h, 0.06], [x + side.x * 0.28 * s, cy, z + side.z * 0.28 * s], { collide: false, tile: 1 });
    const rungs = Math.floor(h / 0.3);
    for (let i = 0; i < rungs; i++) B.box(M.steelPainted, [Math.abs(side.x) > 0.5 ? 0.62 : 0.05, 0.035, Math.abs(side.z) > 0.5 ? 0.62 : 0.05], [x, bottom + 0.15 + i * 0.3, z], { collide: false, tile: 1 });
    this.ladders.push({ id: this.ladders.length, center: new THREE.Vector3(x - facing.x * 0.35, cy, z - facing.z * 0.35), halfW: 0.6, bottom, top, facing: facing.clone() });
  }

  // ---------------------------------------------------------------- STRUCTURES
  protected container(B: Builder, M: Record<string, THREE.Material>, mat: THREE.Material, x: number, y: number, z: number, yawDeg: number, len: number, opts: { openA?: boolean; openB?: boolean } = {}) {
    const w = 2.44, h = 2.6, t = 0.06; const yaw = yawDeg * DEG;
    const rot: [number, number, number] = [0, yaw, 0];
    const local = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y + ly, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    // floor & roof
    B.box(M.darkPlanks, [len, 0.1, w], local(0, 0.05, 0), { rot, tile: 1.2 });
    B.box(mat, [len, t, w], local(0, h - t / 2, 0), { rot, tile: 1.5 });
    // long walls
    B.box(mat, [len, h, t], local(0, h / 2, w / 2 - t / 2), { rot, tile: 1.5 });
    B.box(mat, [len, h, t], local(0, h / 2, -w / 2 + t / 2), { rot, tile: 1.5 });
    // ends (doors) — open ends get two swung-open doors
    const leaf = w / 2 - 0.06;
    if (!opts.openA) B.box(M.paintedMetal, [t, h, w], local(len / 2 - t / 2, h / 2, 0), { rot, tile: 1.5 });
    else for (const sz of [-1, 1]) B.box(M.paintedMetal, [leaf, h, 0.05], local(len / 2 - leaf / 2, h / 2, sz * (w / 2 + 0.05)), { rot, tile: 1.5, collide: false });
    if (!opts.openB) B.box(M.paintedMetal, [t, h, w], local(-len / 2 + t / 2, h / 2, 0), { rot, tile: 1.5 });
    else for (const sz of [-1, 1]) B.box(M.paintedMetal, [leaf, h, 0.05], local(-len / 2 + leaf / 2, h / 2, sz * (w / 2 + 0.05)), { rot, tile: 1.5, collide: false });
    // corner posts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(M.steelDark, [0.16, h + 0.06, 0.16], local(sx * (len / 2 - 0.08), (h + 0.06) / 2, sz * (w / 2 - 0.08)), { rot, tile: 1, collide: false });
    // roof rim rails
    B.box(M.steelDark, [len, 0.12, 0.12], local(0, h + 0.02, w / 2 - 0.06), { rot, tile: 1, collide: false });
    B.box(M.steelDark, [len, 0.12, 0.12], local(0, h + 0.02, -w / 2 + 0.06), { rot, tile: 1, collide: false });
  }

  protected buildStructures(B: Builder, M: Record<string, THREE.Material>) {
    // --- Shipping containers
    this.container(B, M, M.contBlue, 19, 0, -19, 0, 12.2, { openA: true });          // NE long, open east end
    this.container(B, M, M.contRed, 17.5, 2.6, -21.8, 8, 12.2);                        // stacked on top, offset back
    this.container(B, M, M.contRust, -4, 0, 19, 90, 6.1, { openB: true });            // south, short, open
    this.container(B, M, M.contGreen, 15, 0, 13, 90, 12.2, { openA: true });          // SE long
    this.container(B, M, M.contYellow, -21, 0, -17, 0, 6.1, { openA: true, openB: true }); // NW pair forming corridor
    this.container(B, M, M.contRust, -21, 0, -13.3, 0, 6.1);
    this.container(B, M, M.contRed, -7.2, 0, -1, 0, 6.1, { openA: true });           // west of tower: step up
    // plank from red container roof to tower L1 platform? (tower L1 at 3.55, container roof 2.6) – put a crate on the roof
    B.box(M.plywood, [1.2, 0.9, 1.2], [-5.2, 2.6 + 0.45, -1], { tile: 1.1 });
    // --- Ramps onto containers
    this.ramp(B, M, 12.6, -19, 0, 2.6, 4.2, 1.6, 90, M.planks);   // up to blue container (west end)
    this.ramp(B, M, 15, 6.4, 0, 2.6, 4.0, 1.6, 0, M.planks);      // up to green container (north end)
    // --- Shed (west)
    {
      const sx = -15, sz = -6; const w = 6, d = 5, h = 3.2;
      B.box(M.concreteFloor, [w + 0.6, 0.2, d + 0.6], [sx, 0.1, sz], { tile: 2.5 });
      B.box(M.corrRust, [w, h, 0.08], [sx, h / 2 + 0.2, sz - d / 2], { tile: 1.6 });           // back wall (north)
      B.box(M.corrRust, [0.08, h, d], [sx - w / 2, h / 2 + 0.2, sz], { tile: 1.6 });           // west wall
      B.box(M.corrRust, [0.08, h * 0.28, d], [sx + w / 2, h * 0.28 / 2 + 0.2 + h * 0.72, sz], { tile: 1.6 }); // east upper strip (2.3 m clearance below)
      B.box(M.corrRust, [w * 0.35, h, 0.08], [sx - w / 2 + w * 0.175, h / 2 + 0.2, sz + d / 2], { tile: 1.6 }); // front partial
      // roof, sloped
      B.box(M.corr, [w + 0.8, 0.06, d + 0.9], [sx, h + 0.35, sz], { rot: [0.12, 0, 0], tile: 1.6 });
      for (const [px, pz] of [[sx + w / 2, sz + d / 2], [sx + w / 2, sz - d / 2], [sx - w / 2, sz + d / 2]]) B.box(M.roughWood, [0.16, h + 0.2, 0.16], [px, (h + 0.2) / 2 + 0.2, pz], { tile: 1 });
      // interior workbench & crate
      B.box(M.roughWood, [2.2, 0.9, 0.8], [sx - 1.5, 0.65, sz - 1.8], { tile: 1 });
      B.box(M.plywood, [1.0, 1.0, 1.0], [sx + 1.6, 0.7, sz - 1.6], { tile: 1.1 });
      // adjacent low wall to climb onto the roof: stacked crates
      B.box(M.plywood, [1.3, 1.3, 1.3], [sx - w / 2 - 1.2, 0.85, sz + 1.0], { tile: 1.1 });
      B.box(M.plywood, [1.1, 1.1, 1.1], [sx - w / 2 - 1.2, 0.2 + 1.3 + 0.55, sz + 1.0], { tile: 1.1 });
    }
    // --- Bunker / pump house (east)
    {
      const bx = 17, bz = -3; const w = 8, d = 6, h = 3.4, t = 0.35;
      B.box(M.concreteFloor, [w + 1, 0.25, d + 1], [bx, 0.125, bz], { tile: 2.5 });
      // north wall with window slot
      B.box(M.concrete, [w, h * 0.45, t], [bx, 0.25 + h * 0.225, bz - d / 2], { tile: 2.2 });
      B.box(M.concrete, [w, h * 0.3, t], [bx, 0.25 + h - h * 0.15, bz - d / 2], { tile: 2.2 });
      B.box(M.concrete, [1.2, h * 0.25, t], [bx - w / 2 + 0.6, 0.25 + h * 0.575, bz - d / 2], { tile: 2.2 });
      B.box(M.concrete, [1.2, h * 0.25, t], [bx + w / 2 - 0.6, 0.25 + h * 0.575, bz - d / 2], { tile: 2.2 });
      B.box(M.concrete, [2.4, h * 0.25, t], [bx, 0.25 + h * 0.575, bz - d / 2], { tile: 2.2 });
      // south wall with door opening
      B.box(M.concrete, [w / 2 - 0.9, h, t], [bx - w / 4 - 0.45, 0.25 + h / 2, bz + d / 2], { tile: 2.2 });
      B.box(M.concrete, [w / 2 - 0.9, h, t], [bx + w / 4 + 0.45, 0.25 + h / 2, bz + d / 2], { tile: 2.2 });
      B.box(M.concrete, [1.8, h - 2.3, t], [bx, 0.25 + 2.3 + (h - 2.3) / 2, bz + d / 2], { tile: 2.2 });
      // east wall solid, west wall with door
      B.box(M.concreteBlock, [t, h, d], [bx + w / 2, 0.25 + h / 2, bz], { tile: 2 });
      B.box(M.concreteBlock, [t, h, d / 2 - 0.8], [bx - w / 2, 0.25 + h / 2, bz - d / 4 - 0.4], { tile: 2 });
      B.box(M.concreteBlock, [t, h, d / 2 - 0.8], [bx - w / 2, 0.25 + h / 2, bz + d / 4 + 0.4], { tile: 2 });
      B.box(M.concreteBlock, [t, h - 2.3, 1.6], [bx - w / 2, 0.25 + 2.3 + (h - 2.3) / 2, bz], { tile: 2 });
      // roof slab + parapet
      B.box(M.cracked, [w + 0.7, 0.25, d + 0.7], [bx, 0.25 + h + 0.125, bz], { tile: 2.5 });
      // parapet (east side leaves the north part open where the roof stair arrives)
      for (const [px, pz, sw, sd] of [[bx, bz - d / 2 - 0.25, w + 0.7, 0.2], [bx, bz + d / 2 + 0.25, w + 0.7, 0.2], [bx - w / 2 - 0.25, bz, 0.2, d + 0.7], [bx + w / 2 + 0.25, bz + 1.35, 0.2, 4.0]]) B.box(M.concrete, [sw, 0.5, sd], [px, 0.25 + h + 0.25 + 0.25, pz], { tile: 2.2 });
      // interior pump machinery
      B.cyl(M.greenMetal, 0.7, 1.6, [bx + 1.8, 0.25 + 0.8, bz - 1.2], { tile: 1.5 });
      B.box(M.steelDark, [1.6, 0.8, 1.0], [bx - 1.5, 0.25 + 0.4, bz - 1.4], { tile: 1 });
      B.cyl(M.pipe, 0.18, 6, [bx, 0.25 + 2.6, bz], { rot: [0, 0, Math.PI / 2], tile: 1.2, collide: false });
      // stair up to roof at the back (east side going north)
      this.stair(B, M, bx + w / 2 + 1.2, bz + d / 2 + 0.3, 0.25, 180, 0.25 + h + 0.25, 5.2, 1.2, 'bunker');
      // sandbags at the door
      this.sandbags(B, M, bx - 2.5, bz + d / 2 + 1.4, 0);
      this.sandbags(B, M, bx + 2.5, bz + d / 2 + 1.4, 0);
    }
    // --- Oil tank (SW) with external ladder & walkway
    {
      const tx = -19, tz = 13; const r = 4.2, h = 5.4;
      B.cyl(M.cracked, r + 0.6, 0.3, [tx, 0.15, tz], { seg: 40, tile: 3 });
      B.cyl(M.greenMetal, r, h, [tx, 0.3 + h / 2, tz], { seg: 48, tile: 2 });
      B.cyl(M.rustyShutter, r + 0.05, 0.25, [tx, 0.3 + h + 0.125, tz], { seg: 48, tile: 2 });
      B.cyl(M.steelDark, r - 0.6, 0.35, [tx, 0.3 + h + 0.25 + 0.17, tz], { seg: 40, tile: 2 });
      // rings
      for (const yy of [1.8, 3.6]) B.cyl(M.steelDark, r + 0.06, 0.12, [tx, 0.3 + yy, tz], { seg: 48, tile: 1, collide: false });
      // railing on top
      const rr = r - 0.1; const posts = 16;
      for (let i = 0; i < posts; i++) { const a = (i / posts) * Math.PI * 2; B.box(M.steelDark, [0.05, 1.0, 0.05], [tx + Math.cos(a) * rr, 0.3 + h + 0.25 + 0.5, tz + Math.sin(a) * rr], { collide: false }); }
      B.cyl(M.steelDark, rr, 0.05, [tx, 0.3 + h + 0.25 + 1.0, tz], { seg: 48, open: true, tile: 1, collide: false });
      // ladder on the north side
      this.ladder(B, M, tx, tz - r - 0.1, 0.3, 0.3 + h + 0.25, new THREE.Vector3(0, 0, 1));
      // pipes out of the tank
      B.cyl(M.pipe, 0.35, 9, [tx + r + 4.5, 0.9, tz + 1.5], { rot: [0, 0, Math.PI / 2], tile: 1.4 });
      B.cyl(M.pipe, 0.35, 2.4, [tx + r + 0.2, 0.9, tz + 1.5], { rot: [0, 0, Math.PI / 2], tile: 1.4 });
    }
    // --- The big pipe (west→center) with raised section near the tower
    {
      const r = 0.7; const y = r;
      B.cyl(M.pipe2, r, 22, [-19, y, 6.5], { rot: [0, 0, Math.PI / 2], tile: 1.6, seg: 28 });
      // rise 45°
      B.cyl(M.pipe2, r, 3.4, [-7.0, y + 1.2, 6.5], { rot: [0, 0, Math.PI / 2 - 0.62], tile: 1.6, seg: 28 });
      // raised section past the tower (walkable bridge)
      B.cyl(M.pipe2, r, 12, [0.4, 2.6, 6.5], { rot: [0, 0, Math.PI / 2], tile: 1.6, seg: 28 });
      // down again
      B.cyl(M.pipe2, r, 3.4, [7.8, y + 1.2, 6.5], { rot: [0, 0, Math.PI / 2 + 0.62], tile: 1.6, seg: 28 });
      B.cyl(M.pipe2, r, 10, [13.5, y, 6.5], { rot: [0, 0, Math.PI / 2], tile: 1.6, seg: 28 });
      // supports for raised section
      for (const px of [-3.5, 0.5, 4.5]) { B.box(M.steelDark, [0.2, 2.0, 0.2], [px, 1.0, 6.5 - 0.6], { tile: 1 }); B.box(M.steelDark, [0.2, 2.0, 0.2], [px, 1.0, 6.5 + 0.6], { tile: 1 }); }
      // pipe rack (north east) - stacked pipes
      for (let i = 0; i < 4; i++) B.cyl(M.pipe, 0.32, 8, [8 + (i % 2) * 0.7, 0.32 + Math.floor(i / 2) * 0.6, -16 + (i % 2) * 0.2], { rot: [0, 0, Math.PI / 2], tile: 1.2, seg: 18 });
      B.box(M.roughWood, [0.3, 0.3, 1.8], [4.8, 0.15, -16], { tile: 1 }); B.box(M.roughWood, [0.3, 0.3, 1.8], [11.2, 0.15, -16], { tile: 1 });
    }
    // --- Perimeter fence segments (chain link approximated with posts + thin dark panel)
    const fence = (x0: number, z0: number, x1: number, z1: number) => {
      const dx = x1 - x0, dz = z1 - z0; const len = Math.hypot(dx, dz); const yaw = Math.atan2(dx, dz); const n = Math.max(1, Math.round(len / 3));
      for (let i = 0; i <= n; i++) { const t = i / n; B.box(M.steelDark, [0.08, 2.4, 0.08], [x0 + dx * t, 1.2, z0 + dz * t], { tile: 1 }); }
      B.box(M.steelDark, [0.06, 0.06, len], [x0 + dx / 2, 2.35, z0 + dz / 2], { rot: [0, yaw, 0], tile: 1, collide: false });
      const panel = chainLinkMaterial(); panel.userData.surface = 'metal';
      B.box(panel, [0.02, 2.2, len], [x0 + dx / 2, 1.2, z0 + dz / 2], { rot: [0, yaw, 0], tile: 0.5, collide: true, shadow: false });
    };
    const F = RustMap.PLAY - 0.6; fence(-F, -F, F, -F); fence(F, -F, F, F); fence(F, F, -F, F); fence(-F, F, -F, -F);
    // --- concrete barriers (jersey) for cover
    const jersey = (x: number, z: number, yaw: number) => B.box(M.concreteBlock, [2.0, 0.9, 0.5], [x, 0.45, z], { rot: [0, yaw * DEG, 0], tile: 2 });
    jersey(6, 20, 20); jersey(8.2, 19.6, 20); jersey(-14, -22, 80); jersey(-14.4, -19.8, 80); jersey(24, 4, 0); jersey(26, 4, 0); jersey(2, -22, -10);
    // --- wooden walkway / platform between tower and pipe
    B.box(M.planks, [4.0, 0.12, 2.0], [-4.5, 2.66, 4.4], { tile: 1.4 });
    B.box(M.roughWood, [0.16, 2.6, 0.16], [-6.2, 1.3, 3.6], { tile: 1 }); B.box(M.roughWood, [0.16, 2.6, 0.16], [-2.8, 1.3, 3.6], { tile: 1 });
  }

  protected ramp(B: Builder, M: Record<string, THREE.Material>, x: number, z: number, y0: number, y1: number, run: number, width: number, dirDeg: number, mat: THREE.Material) {
    const rise = y1 - y0; const len = Math.hypot(run, rise); const ang = Math.atan2(rise, run); const yaw = dirDeg * DEG;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const mx = x + dir.x * run / 2, mz = z + dir.z * run / 2, my = y0 + rise / 2;
    B.box(mat, [width, 0.14, len], [mx, my, mz], { rot: [0, 0, 0], tile: 1.4, collide: false });
    // rotate visual properly using a matrix: yaw then pitch
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-ang, 0, 0)));
    const e = new THREE.Euler().setFromQuaternion(q);
    B.box(mat, [width, 0.14, len], [mx, my, mz], { rot: [e.x, e.y, e.z], tile: 1.4, collide: true, surface: 'wood' });
    for (const s of [-1, 1]) { const off = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2 - 0.1); B.box(M.roughWood, [0.12, 0.12, len], [mx + off.x * s, my + 0.1, mz + off.z * s], { rot: [e.x, e.y, e.z], tile: 1, collide: false }); }
  }

  protected sandbags(B: Builder, M: Record<string, THREE.Material>, x: number, z: number, yawDeg: number) {
    const yaw = yawDeg * DEG;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 0.62 + (row % 2) * 0.31; const y = 0.14 + row * 0.26;
      B.box(M.sandbag, [0.6, 0.27, 0.36], [x + Math.cos(yaw) * off, y, z - Math.sin(yaw) * off], { rot: [0, yaw + rand(-0.06, 0.06), 0], tile: 0.6, collide: false });
    }
    this.physics.addStaticBox(new THREE.Vector3(x, 0.41, z), new THREE.Vector3(2.7, 0.82, 0.42), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), G.WORLD, { surface: 'sand' });
  }

  // ---------------------------------------------------------------- PROPS
  protected buildProps(B: Builder, M: Record<string, THREE.Material>) {
    const barrel = (x: number, z: number, mat: THREE.Material, tipped = false, y = 0) => {
      if (tipped) B.cyl(mat, 0.3, 0.88, [x, y + 0.3, z], { rot: [Math.PI / 2, rand(0, 6.28), 0], seg: 18, tile: 0.9 });
      else B.cyl(mat, 0.3, 0.88, [x, y + 0.44, z], { rot: [0, rand(0, 6.28), 0], seg: 18, tile: 0.9 });
    };
    const crate = (x: number, z: number, s: number, mat: THREE.Material, y = 0, yaw = rand(0, 6.28)) => B.box(mat, [s, s * 0.85, s], [x, y + s * 0.425, z], { rot: [0, yaw, 0], tile: 1.1 });
    const tireStack = (x: number, z: number, n: number) => { for (let i = 0; i < n; i++) { const g = new THREE.TorusGeometry(0.36, 0.13, 10, 24); const m = new THREE.Matrix4().compose(new THREE.Vector3(x + rand(-0.04, 0.04), 0.13 + i * 0.26, z + rand(-0.04, 0.04)), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, rand(0, 6))), new THREE.Vector3(1, 1, 1)); B.custom(M.rubber, g, m, false, 'rubber'); } this.physics.addStaticCylinder(new THREE.Vector3(x, n * 0.13, z), 0.49, n * 0.26, undefined, G.WORLD, { surface: 'rubber' }); };
    const pallet = (x: number, z: number, yaw = 0, y = 0) => { B.box(M.roughWood, [1.2, 0.05, 1.0], [x, y + 0.12, z], { rot: [0, yaw, 0], tile: 1, collide: false }); B.box(M.roughWood, [1.2, 0.14, 1.0], [x, y + 0.07, z], { rot: [0, yaw, 0], tile: 1 }); };
    // barrel clusters
    for (const [x, z] of [[-10, -12], [-9.3, -12.6], [-9.6, -11.4]]) barrel(x, z, M.barrelRust);
    barrel(-8.5, -12.2, M.barrelBlue, true);
    for (const [x, z] of [[22, 8], [22.7, 8.5], [22.2, 9.2]]) barrel(x, z, M.barrelBlue);
    barrel(23.5, 9, M.barrelRust, true);
    for (const [x, z] of [[-24, 0], [-23.4, 0.7]]) barrel(x, z, M.barrelRust);
    for (const [x, z] of [[4.5, 12.5], [5.2, 13.1]]) barrel(x, z, M.barrelBlue);
    barrel(2, -9, M.barrelRust); barrel(2.7, -9.3, M.barrelRust); barrel(-2.5, 15, M.barrelBlue, true);
    // crates
    crate(-2, 10.5, 1.3, M.plywood); crate(-3.2, 10.9, 1.0, M.plywood); crate(-2.4, 10.5, 1.0, M.plywood, 1.3 * 0.85);
    crate(9, -6.5, 1.4, M.plywood); crate(10.3, -6.2, 1.1, M.roughWood); crate(9.2, -6.6, 1.1, M.plywood, 1.4 * 0.85);
    crate(-24, -22, 1.2, M.plywood); crate(23, -12, 1.3, M.roughWood); crate(23.8, -10.8, 0.9, M.plywood);
    crate(-13, 20, 1.2, M.roughWood); crate(-11.8, 20.4, 1.2, M.roughWood); crate(-12.4, 20.2, 1.1, M.plywood, 1.2 * 0.85);
    crate(6, 1.5, 1.1, M.plywood); crate(20, -8, 1.0, M.plywood);
    // tires
    tireStack(-16, 2, 4); tireStack(-15.2, 2.6, 2); tireStack(12, 20, 3); tireStack(12.9, 20.5, 5); tireStack(-4, -20, 3); tireStack(20, 17, 2);
    // pallets
    pallet(11.5, -19, 0.2); pallet(11.5, -19, 0.2, 0.19); pallet(-8, 14, 1.2); pallet(3, 22, 0.4);
    // spool of cable
    B.cyl(M.roughWood, 0.9, 0.12, [-24, 0.06, 7.5], { seg: 20, tile: 1 }); B.cyl(M.cable, 0.5, 0.9, [-24, 0.57, 7.5], { seg: 20, tile: 1 }); B.cyl(M.roughWood, 0.9, 0.12, [-24, 1.08, 7.5], { seg: 20, tile: 1 });
    // generator
    B.box(M.greenMetal, [1.8, 1.1, 0.9], [-12, 0.55, 12], { tile: 1.5 }); B.cyl(M.steelDark, 0.06, 0.5, [-12.6, 1.35, 12.2], { collide: false });
    // rusted truck (cab + bed) near NE
    {
      const tx = 6, tz = -23, yaw = 12 * DEG; const rot: [number, number, number] = [0, yaw, 0];
      const L = (lx: number, ly: number, lz: number): [number, number, number] => [tx + lx * Math.cos(yaw) + lz * Math.sin(yaw), ly, tz - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
      B.box(M.rustCoarse, [5.6, 0.5, 2.2], L(0, 0.75, 0), { rot, tile: 1.2 });
      B.box(M.rustCoarse, [2.0, 1.5, 2.2], L(1.8, 1.75, 0), { rot, tile: 1.2 });
      B.box(M.glass, [0.05, 0.7, 1.9], L(0.82, 1.95, 0), { rot, tile: 1, collide: false, shadow: false });
      B.box(M.rustCoarse, [3.4, 0.6, 2.2], L(-1.1, 1.3, 0), { rot, tile: 1.2 });
      B.box(M.rustCoarse, [3.4, 0.5, 0.08], L(-1.1, 1.85, 1.06), { rot, tile: 1.2 }); B.box(M.rustCoarse, [3.4, 0.5, 0.08], L(-1.1, 1.85, -1.06), { rot, tile: 1.2 });
      for (const [lx, lz] of [[1.9, 1.05], [1.9, -1.05], [-1.9, 1.05], [-1.9, -1.05]]) B.cyl(M.rubber, 0.48, 0.32, L(lx, 0.48, lz), { rot: [Math.PI / 2, 0, yaw], seg: 18, tile: 1 });
    }
    // scrap metal sheets leaning
    B.box(M.corrRust, [2.4, 1.8, 0.05], [-26, 0.9, -3], { rot: [0.25, 0.3, 0], tile: 1.6, collide: false });
    B.box(M.corrRust, [2.0, 1.6, 0.05], [25.5, 0.8, 14], { rot: [-0.3, -0.5, 0], tile: 1.6, collide: false });
    // tarp over the pipe rack
    B.box(M.tarp, [4.5, 0.03, 2.4], [8.4, 1.55, -16], { rot: [0, 0, 0.05], tile: 1, collide: false });
    // oil drums stack near green container
    barrel(20.5, 4, M.barrelRust); barrel(21.2, 4.4, M.barrelRust); barrel(20.85, 4.2, M.barrelRust, false, 0.88);
  }

  // ---------------------------------------------------------------- OUTER RING (8-player expansion)
  protected truck(B: Builder, M: Record<string, THREE.Material>, tx: number, tz: number, yawDeg: number) {
    const yaw = yawDeg * DEG; const rot: [number, number, number] = [0, yaw, 0];
    const L = (lx: number, ly: number, lz: number): [number, number, number] => [tx + lx * Math.cos(yaw) + lz * Math.sin(yaw), ly, tz - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    B.box(M.rustCoarse, [5.6, 0.5, 2.2], L(0, 0.75, 0), { rot, tile: 1.2 });
    B.box(M.rustCoarse, [2.0, 1.5, 2.2], L(1.8, 1.75, 0), { rot, tile: 1.2 });
    B.box(M.glass, [0.05, 0.7, 1.9], L(0.82, 1.95, 0), { rot, tile: 1, collide: false, shadow: false });
    B.box(M.rustCoarse, [3.4, 0.6, 2.2], L(-1.1, 1.3, 0), { rot, tile: 1.2 });
    B.box(M.rustCoarse, [3.4, 0.5, 0.08], L(-1.1, 1.85, 1.06), { rot, tile: 1.2 }); B.box(M.rustCoarse, [3.4, 0.5, 0.08], L(-1.1, 1.85, -1.06), { rot, tile: 1.2 });
    for (const [lx, lz] of [[1.9, 1.05], [1.9, -1.05], [-1.9, 1.05], [-1.9, -1.05]]) B.cyl(M.rubber, 0.48, 0.32, L(lx, 0.48, lz), { rot: [Math.PI / 2, 0, yaw], seg: 18, tile: 1 });
  }

  protected watchtower(B: Builder, M: Record<string, THREE.Material>, x: number, z: number, h: number) {
    const half = 1.6;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(M.roughWood, [0.22, h + 0.3, 0.22], [x + sx * half, (h + 0.3) / 2, z + sz * half], { tile: 1 });
    B.box(M.planks, [half * 2 + 0.6, 0.12, half * 2 + 0.6], [x, h + 0.06, z], { tile: 1.4, surface: 'wood' });
    for (const yy of [1.5, h * 0.55]) { B.box(M.roughWood, [half * 2, 0.12, 0.12], [x, yy, z - half], { tile: 1 }); B.box(M.roughWood, [half * 2, 0.12, 0.12], [x, yy, z + half], { tile: 1 }); B.box(M.roughWood, [0.12, 0.12, half * 2], [x - half, yy, z], { tile: 1 }); B.box(M.roughWood, [0.12, 0.12, half * 2], [x + half, yy, z], { tile: 1 }); }
    // roof
    B.box(M.corrRust, [half * 2 + 1.2, 0.06, half * 2 + 1.2], [x, h + 2.4, z], { rot: [0.1, 0, 0], tile: 1.6 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(M.roughWood, [0.1, 2.3, 0.1], [x + sx * (half + 0.3), h + 1.25, z + sz * (half + 0.3)], { collide: false });
    // railings with the south side open for the stair
    const e = half + 0.3, ry = h + 0.12;
    const rail = (x0: number, z0: number, x1: number, z1: number) => { const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz); B.box(M.roughWood, [0.06, 0.06, len], [x0 + dx / 2, ry + 1.0, z0 + dz / 2], { rot: [0, yaw, 0], collide: false }); B.box(M.roughWood, [0.06, 0.06, len], [x0 + dx / 2, ry + 0.55, z0 + dz / 2], { rot: [0, yaw, 0], collide: false }); this.physics.addStaticBox(new THREE.Vector3(x0 + dx / 2, ry + 0.55, z0 + dz / 2), new THREE.Vector3(0.04, 0.6, len), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), G.WORLD, { surface: 'wood' }); };
    rail(x - e, z - e, x + e, z - e); rail(x - e, z - e, x - e, z + e); rail(x + e, z - e, x + e, z + e); rail(x - e, z + e, x - 0.7, z + e); rail(x + 0.7, z + e, x + e, z + e);
    this.stair(B, M, x, z + half + 0.35 + h * 1.35, 0, 180, h + 0.12, h * 1.35, 1.3, 'watch');
  }

  protected pumpjack(B: Builder, M: Record<string, THREE.Material>, x: number, z: number, yawDeg: number) {
    const yaw = yawDeg * DEG; const rot: [number, number, number] = [0, yaw, 0];
    const L = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), ly, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    B.box(M.cracked, [7, 0.3, 3.2], L(0, 0.15, 0), { rot, tile: 3 });
    // samson post (A-frame)
    B.box(M.steelPainted, [0.3, 4.6, 0.3], L(0.4, 2.6, -1.0), { rot: [0.32, yaw, 0], tile: 1 });
    B.box(M.steelPainted, [0.3, 4.6, 0.3], L(0.4, 2.6, 1.0), { rot: [-0.32, yaw, 0], tile: 1 });
    B.box(M.steelPainted, [0.3, 4.6, 0.3], L(-0.3, 2.6, 0), { rot: [0, yaw, 0.15], tile: 1 });
    // walking beam + horsehead + counterweight
    B.box(M.steelPainted, [6.4, 0.5, 0.5], L(0.2, 4.7, 0), { rot: [0, yaw, 0.08], tile: 1.5 });
    B.box(M.steelPainted, [0.8, 1.6, 0.9], L(3.4, 4.6, 0), { rot, tile: 1.5 });
    B.box(M.rustCoarse, [1.2, 1.4, 1.2], L(-2.8, 5.0, 0), { rot, tile: 1.2 });
    B.box(M.steelDark, [0.16, 3.6, 0.16], L(3.5, 2.0, 0), { rot, tile: 1, collide: false });
    // crank / motor housing
    B.box(M.greenMetal, [2.0, 1.4, 1.6], L(-2.6, 0.95, 0), { rot, tile: 1.5 });
    B.cyl(M.steelDark, 0.9, 0.3, L(-2.0, 1.9, 1.0), { rot: [Math.PI / 2, 0, yaw], seg: 24, tile: 1 });
    B.cyl(M.pipe, 0.25, 4, L(4.4, 0.6, 0), { rot: [Math.PI / 2, 0, yaw], tile: 1.2, collide: true });
  }

  protected garage(B: Builder, M: Record<string, THREE.Material>, gx: number, gz: number) {
    const w = 10, d = 8, h = 4.0, t = 0.25;
    B.box(M.concreteFloor, [w + 0.8, 0.2, d + 0.8], [gx, 0.1, gz], { tile: 2.5 });
    B.box(M.corr, [w, h, 0.1], [gx, h / 2 + 0.2, gz + d / 2], { tile: 1.6 });                // back (south)
    B.box(M.corr, [0.1, h, d], [gx - w / 2, h / 2 + 0.2, gz], { tile: 1.6 });                // west
    B.box(M.corr, [0.1, h, d / 2 - 1.2], [gx + w / 2, h / 2 + 0.2, gz + d / 4 + 0.6], { tile: 1.6 }); // east with a side door
    B.box(M.corr, [0.1, h, d / 2 - 1.2], [gx + w / 2, h / 2 + 0.2, gz - d / 4 - 0.6], { tile: 1.6 });
    B.box(M.corr, [0.1, h - 2.3, 2.4], [gx + w / 2, 0.2 + 2.3 + (h - 2.3) / 2, gz], { tile: 1.6 });
    B.box(M.corr, [w * 0.25, h, 0.1], [gx - w / 2 + w * 0.125, h / 2 + 0.2, gz - d / 2], { tile: 1.6 }); // front partial (north) - big opening
    B.box(M.corr, [w, h - 3.0, 0.1], [gx, 0.2 + 3.0 + (h - 3.0) / 2, gz - d / 2], { tile: 1.6 });   // lintel
    B.box(M.corrRust, [w + 0.8, 0.08, d + 0.8], [gx, h + 0.26, gz], { tile: 1.6 });          // flat roof (walkable)
    for (const [px, pz] of [[gx - w / 2, gz - d / 2], [gx + w / 2, gz - d / 2], [gx - w / 2, gz + d / 2], [gx + w / 2, gz + d / 2], [gx + w / 4, gz - d / 2]]) B.box(M.steelDark, [0.18, h + 0.3, 0.18], [px, (h + 0.3) / 2 + 0.2, pz], { tile: 1 });
    // roof parapet (low) except the ladder side
    for (const [px, pz, sw, sd] of [[gx, gz - d / 2 - 0.35, w + 0.8, 0.12], [gx - w / 2 - 0.35, gz, 0.12, d + 0.8], [gx + w / 2 + 0.35, gz, 0.12, d + 0.8]]) B.box(M.steelDark, [sw, 0.4, sd], [px, h + 0.5, pz], { tile: 1 });
    this.ladder(B, M, gx, gz + d / 2 + 0.05, 0.2, h + 0.3, new THREE.Vector3(0, 0, -1));
    // interior: truck + bench + drums
    this.truck(B, M, gx - 1.5, gz + 0.5, 90);
    B.box(M.roughWood, [0.8, 0.9, 3.0], [gx + w / 2 - 0.7, 0.65, gz + 1.5], { tile: 1 });
    B.cyl(M.barrelRust, 0.3, 0.88, [gx + w / 2 - 0.8, 0.64, gz - 2.5], { seg: 18, tile: 0.9 }); B.cyl(M.barrelBlue, 0.3, 0.88, [gx + w / 2 - 1.5, 0.64, gz - 2.9], { seg: 18, tile: 0.9 });
  }

  protected pillbox(B: Builder, M: Record<string, THREE.Material>, x: number, z: number, faceYawDeg: number) {
    const s = 3.2, h = 2.3, t = 0.4; const yaw = faceYawDeg * DEG; const rot: [number, number, number] = [0, yaw, 0];
    const L = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), ly, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    B.box(M.cracked, [s + 0.6, 0.2, s + 0.6], L(0, 0.1, 0), { rot, tile: 2 });
    // front wall with firing slit (facing -Z local)
    B.box(M.concrete, [s, 1.3, t], L(0, 0.2 + 0.65, -s / 2), { rot, tile: 2.2 });
    B.box(M.concrete, [s, 0.5, t], L(0, 0.2 + 1.3 + 0.35 + 0.25, -s / 2), { rot, tile: 2.2 });
    B.box(M.concrete, [0.5, 0.35, t], L(-s / 2 + 0.25, 0.2 + 1.3 + 0.175, -s / 2), { rot, tile: 2.2 }); B.box(M.concrete, [0.5, 0.35, t], L(s / 2 - 0.25, 0.2 + 1.3 + 0.175, -s / 2), { rot, tile: 2.2 });
    B.box(M.concrete, [t, h, s], L(-s / 2, 0.2 + h / 2, 0), { rot, tile: 2.2 }); B.box(M.concrete, [t, h, s], L(s / 2, 0.2 + h / 2, 0), { rot, tile: 2.2 });
    B.box(M.concrete, [s / 2 - 0.6, h, t], L(-s / 4 - 0.3, 0.2 + h / 2, s / 2), { rot, tile: 2.2 }); B.box(M.concrete, [s / 2 - 0.6, h, t], L(s / 4 + 0.3, 0.2 + h / 2, s / 2), { rot, tile: 2.2 }); // rear door
    B.box(M.cracked, [s + 0.6, 0.3, s + 0.6], L(0, 0.2 + h + 0.15, 0), { rot, tile: 2 });
    this.sandbags(B, M, ...[L(0, 0, -s / 2 - 1.2)[0], L(0, 0, -s / 2 - 1.2)[2]] as [number, number], faceYawDeg);
  }

  protected hangar(B: Builder, M: Record<string, THREE.Material>, hx: number, hz: number, yawDeg: number) {
    const r = 4.2, len = 14; const yaw = yawDeg * DEG;
    // arch roof (visual) + segmented colliders
    const g = new THREE.CylinderGeometry(r, r, len, 32, 1, true, 0, Math.PI);
    const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * r) / 1.6, uv.getY(i) * len / 1.6);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(hx, 0.3, hz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0))), new THREE.Vector3(1, 1, 1));
    B.custom(M.corrRust, g, m, false, 'metal');
    const segs = 7;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI, a1 = ((i + 1) / segs) * Math.PI; const am = (a0 + a1) / 2; const chord = 2 * r * Math.sin((a1 - a0) / 2);
      const cx = Math.cos(am) * r, cy = Math.sin(am) * r;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, am - Math.PI / 2)));
      const pos = new THREE.Vector3(cx, 0.3 + cy, 0).applyEuler(new THREE.Euler(0, yaw, 0)).add(new THREE.Vector3(hx, 0, hz));
      this.physics.addStaticBox(pos, new THREE.Vector3(chord + 0.1, 0.12, len), q, G.WORLD, { surface: 'metal' });
    }
    B.box(M.concreteFloor, [2 * r + 0.6, 0.3, len + 0.6], [hx, 0.15, hz], { rot: [0, yaw, 0], tile: 2.5 });
    // contents
    const L = (lx: number, lz: number): [number, number] => [hx + lx * Math.cos(yaw) + lz * Math.sin(yaw), hz - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    const [cx1, cz1] = L(1.5, -3); B.box(M.plywood, [1.3, 1.1, 1.3], [cx1, 0.85, cz1], { rot: [0, yaw + 0.3, 0], tile: 1.1 });
    const [cx2, cz2] = L(-1.8, 3.5); B.cyl(M.barrelRust, 0.3, 0.88, [cx2, 0.74, cz2], { seg: 18, tile: 0.9 }); B.cyl(M.barrelRust, 0.3, 0.88, [cx2 + 0.65, 0.74, cz2 + 0.2], { seg: 18, tile: 0.9 });
    const [cx3, cz3] = L(0.5, 4.5); B.box(M.roughWood, [2.2, 0.9, 0.8], [cx3, 0.75, cz3], { rot: [0, yaw, 0], tile: 1 });
  }

  protected buildOuterRing(B: Builder, M: Record<string, THREE.Material>) {
    // --- NORTH: second container yard + watchtower
    this.container(B, M, M.contBlue, -14, 0, -38, 0, 12.2, { openA: true });
    this.container(B, M, M.contRed, -15.5, 2.6, -40.6, 6, 12.2);
    this.container(B, M, M.contRust, -1, 0, -41, 90, 6.1, { openB: true });
    this.container(B, M, M.contGreen, 9, 0, -36, 0, 12.2, { openB: true });
    this.ramp(B, M, 16.6, -36, 0, 2.6, 4.2, 1.6, 270, M.planks);
    this.watchtower(B, M, 26, -41, 4.6);
    B.box(M.plywood, [1.2, 1.0, 1.2], [3, 0.6, -33], { tile: 1.1 }); B.box(M.plywood, [1.0, 0.9, 1.0], [-20, 0.55, -33.5], { tile: 1.1 });
    B.cyl(M.pipe2, 0.7, 26, [-28, 0.7, -30], { rot: [0, 0, Math.PI / 2], tile: 1.6, seg: 28 });
    // --- EAST: pump station + garage
    this.pumpjack(B, M, 39, -10, 0);
    this.pumpjack(B, M, 40, -24, 180);
    B.cyl(M.pipe, 0.35, 16, [36, 0.5, -17], { rot: [Math.PI / 2, 0, 0], tile: 1.4 });
    this.garage(B, M, 38, 14);
    for (const [x, z] of [[31, 2], [31.7, 2.6], [30.9, 3.2]]) B.cyl(M.barrelBlue, 0.3, 0.88, [x, 0.44, z], { seg: 18, tile: 0.9 });
    B.box(M.concreteBlock, [2.0, 0.9, 0.5], [32, 0.45, 26], { rot: [0, 0.4, 0], tile: 2 }); B.box(M.concreteBlock, [2.0, 0.9, 0.5], [34, 0.45, 25.4], { rot: [0, 0.4, 0], tile: 2 });
    // --- SOUTH: trench line (pillboxes + sandbag line) and truck depot
    this.pillbox(B, M, -22, 38, 180); this.pillbox(B, M, 22, 38, 180);
    for (const x of [-14, -8, 8, 14]) this.sandbags(B, M, x, 37.5, 0);
    this.truck(B, M, -4, 43, 10); this.truck(B, M, 4, 43, -8);
    B.cyl(M.rustyShutter, 1.2, 5, [12, 1.6, 44], { rot: [0, 0, Math.PI / 2], seg: 24, tile: 1.8 }); // fuel bowser
    for (const s of [-1, 1]) B.box(M.steelDark, [0.2, 1.0, 1.4], [12 + s * 1.8, 0.5, 44], { tile: 1 });
    B.cyl(M.pipe2, 0.7, 22, [0, 0.7, 31], { rot: [0, 0, Math.PI / 2], tile: 1.6, seg: 28 });
    // --- WEST: twin tanks with a top walkway + hangar
    const tanks: [number, number][] = [[-41, -14], [-41, 2]]; const r = 3.6, h = 5.0;
    for (const [tx, tz] of tanks) {
      B.cyl(M.cracked, r + 0.6, 0.3, [tx, 0.15, tz], { seg: 40, tile: 3 });
      B.cyl(M.rustyShutter, r, h, [tx, 0.3 + h / 2, tz], { seg: 44, tile: 2 });
      B.cyl(M.steelDark, r + 0.05, 0.25, [tx, 0.3 + h + 0.125, tz], { seg: 44, tile: 2 });
      const posts = 14; for (let i = 0; i < posts; i++) { const a = (i / posts) * Math.PI * 2; B.box(M.steelDark, [0.05, 1.0, 0.05], [tx + Math.cos(a) * (r - 0.1), 0.3 + h + 0.25 + 0.5, tz + Math.sin(a) * (r - 0.1)], { collide: false }); }
      B.cyl(M.steelDark, r - 0.1, 0.05, [tx, 0.3 + h + 0.25 + 1.0, tz], { seg: 44, open: true, tile: 1, collide: false });
    }
    B.box(M.grate, [1.4, 0.1, 16 - 2 * r + 0.4], [-41, 0.3 + h + 0.3, -6], { tile: 0.8 }); // walkway between the tanks
    for (const s of [-1, 1]) { B.box(M.steelDark, [0.05, 0.05, 16 - 2 * r + 0.4], [-41 + s * 0.68, 0.3 + h + 0.3 + 1.0, -6], { collide: false }); this.physics.addStaticBox(new THREE.Vector3(-41 + s * 0.68, 0.3 + h + 0.3 + 0.55, -6), new THREE.Vector3(0.04, 0.6, 16 - 2 * r + 0.4), undefined, G.WORLD, { surface: 'metal' }); }
    this.ladder(B, M, -41 + r + 0.1, -14, 0.3, 0.3 + h + 0.25, new THREE.Vector3(-1, 0, 0));
    B.cyl(M.pipe, 0.35, 10, [-34, 0.9, -6], { rot: [Math.PI / 2, 0, 0], tile: 1.4 });
    this.hangar(B, M, -38, 26, 90);
    B.box(M.plywood, [1.2, 1.0, 1.2], [-30, 0.6, 14], { tile: 1.1 }); B.box(M.roughWood, [1.0, 0.85, 1.0], [-31.2, 0.5, 14.5], { tile: 1 });
    // --- scattered cover along the ring roads
    const jersey = (x: number, z: number, yaw: number) => B.box(M.concreteBlock, [2.0, 0.9, 0.5], [x, 0.45, z], { rot: [0, yaw * DEG, 0], tile: 2 });
    jersey(-30, -30, 30); jersey(-28, -31, 30); jersey(30, -32, -20); jersey(28, 34, 60); jersey(-26, 34, -50); jersey(0, -46, 0); jersey(2.2, -46, 0); jersey(-46, 0, 90); jersey(46, -2, 90);
    for (const [x, z] of [[-33, -22], [34, 33], [-22, -44], [24, 44], [44, -40], [-44, 42]]) { B.box(M.plywood, [1.2, 1.0, 1.2], [x, 0.6, z], { rot: [0, rand(0, 6), 0], tile: 1.1 }); B.cyl(M.barrelRust, 0.3, 0.88, [x + 1.3, 0.44, z + 0.4], { seg: 18, tile: 0.9 }); }
  }

  // ---------------------------------------------------------------- PERIMETER
  protected buildPerimeter(B: Builder, M: Record<string, THREE.Material>) {
    // boulders in a ring
    const N = 70;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rand(-0.06, 0.06); const rr = 52 + rand(0, 8);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const s = rand(2.2, 5.5);
      const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4)); const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) { const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)); const n = 1 + fbm(v.x * 1.4 + i, v.z * 1.4 + v.y * 0.8 + i * 3, 4) * 0.28 + fbm(v.x * 4 + i, v.y * 4, 2) * 0.05; v.multiplyScalar(n); p.setXYZ(k, v.x, v.y * 0.7, v.z); }
      g.computeVertexNormals();
      const uv = g.attributes.uv as THREE.BufferAttribute; for (let k = 0; k < uv.count; k++) { const ang = Math.atan2(p.getZ(k), p.getX(k)); uv.setXY(k, ang * s / 3.5, (p.getY(k) + Math.hypot(p.getX(k), p.getZ(k)) * 0.5) * s / 3.5); }
      const y = this.groundHeight(x, z) + s * 0.2;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.2, 0.2), rand(0, 6.28), rand(-0.2, 0.2))), new THREE.Vector3(s * rand(0.8, 1.3), s * rand(0.6, 0.9), s * rand(0.8, 1.3)));
      B.custom(i % 3 === 0 ? M.laterite : M.sandstone, g, m, 'hull', 'rock');
    }
    // a few boulders inside the play area for cover
    for (const [x, z, s] of [[-24, -6, 2.2], [24, 22, 2.6], [-8, 24, 1.8], [24, -24, 2.4], [-40, 10, 2.6], [38, -34, 2.9], [12, 44, 2.1], [-36, -40, 3.1], [44, 22, 2.4], [-44, 40, 2.6], [30, 40, 2.2], [-6, -44, 2.4]]) {
      const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4)); const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) { const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)); v.multiplyScalar(1 + fbm(v.x * 1.6 + x, v.z * 1.6 + v.y + z, 4) * 0.26 + fbm(v.x * 4 + x, v.y * 4, 2) * 0.05); p.setXYZ(k, v.x, v.y * 0.65, v.z); }
      g.computeVertexNormals(); const uv = g.attributes.uv as THREE.BufferAttribute; for (let k = 0; k < uv.count; k++) { const ang = Math.atan2(p.getZ(k), p.getX(k)); uv.setXY(k, ang * s / 3, (p.getY(k) + Math.hypot(p.getX(k), p.getZ(k)) * 0.5) * s / 3); }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, s * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, 6), 0)), new THREE.Vector3(s, s * 0.8, s));
      B.custom(M.sandstone, g, m, 'hull', 'rock');
    }
    // desert scrub on the dunes (visual only) and small rocks near the fence line
    for (let i = 0; i < 140; i++) {
      const a = rand(0, Math.PI * 2); const rr = rand(49, 76); const x = Math.cos(a) * rr, z = Math.sin(a) * rr; const y = this.groundHeight(x, z);
      const n = 2 + Math.floor(rand(0, 4));
      for (let k = 0; k < n; k++) {
        const s = rand(0.35, 0.8); const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position as THREE.BufferAttribute;
        for (let q = 0; q < p.count; q++) { const v = new THREE.Vector3(p.getX(q), p.getY(q), p.getZ(q)); v.multiplyScalar(1 + fbm(v.x * 3 + i, v.z * 3 + k, 2) * 0.35); p.setXYZ(q, v.x, v.y * 0.7, v.z); }
        g.computeVertexNormals();
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x + rand(-1, 1), y + s * 0.25, z + rand(-1, 1)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, 6), 0)), new THREE.Vector3(s, s, s));
        B.custom(M.scrub, g, m, false, 'cloth');
      }
    }
    for (let i = 0; i < 70; i++) {
      const a = rand(0, Math.PI * 2); const rr = rand(30, 66); const x = Math.cos(a) * rr, z = Math.sin(a) * rr; const s = rand(0.5, 1.4);
      const g = mergeVertices(new THREE.IcosahedronGeometry(1, 2)); const p = g.attributes.position as THREE.BufferAttribute;
      for (let q = 0; q < p.count; q++) { const v = new THREE.Vector3(p.getX(q), p.getY(q), p.getZ(q)); v.multiplyScalar(1 + fbm(v.x * 2 + i, v.z * 2 + v.y, 3) * 0.3); p.setXYZ(q, v.x, v.y * 0.6, v.z); }
      g.computeVertexNormals(); const uv = g.attributes.uv as THREE.BufferAttribute; for (let q = 0; q < uv.count; q++) { const ang = Math.atan2(p.getZ(q), p.getX(q)); uv.setXY(q, ang * s / 2, (p.getY(q) + 1) * s / 2); }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, this.groundHeight(x, z) + s * 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, 6), 0)), new THREE.Vector3(s, s * 0.8, s));
      B.custom(M.rock3, g, m, rr < 50 ? 'hull' : false, 'rock');
    }
    // invisible boundary walls
    const b = RustMap.PLAY; this.bounds = b;
    for (const [x, z, w, d] of [[0, -b, b * 2 + 4, 1], [0, b, b * 2 + 4, 1], [-b, 0, 1, b * 2 + 4], [b, 0, 1, b * 2 + 4]]) this.physics.addStaticBox(new THREE.Vector3(x, 10, z), new THREE.Vector3(w, 30, d), undefined, G.WORLD, { surface: 'none', invisible: true });
  }

  // ---------------------------------------------------------------- SPAWNS & WAYPOINTS
  protected defineSpawns() {
    // yaw faces the map center (player convention: forward = (-sin yaw, -cos yaw))
    const S = (x: number, z: number, _yawDeg: number) => this.spawns.push({ pos: new THREE.Vector3(x, this.groundHeight(x, z) + 0.05, z), yaw: Math.atan2(x, z) });
    S(-24, 22, 0); S(24, 22, 0); S(24, -24, 0); S(-24, -24, 0); S(-25, 4, 0); S(25, -14, 0); S(0, 24, 0); S(-2, -26, 0);
    S(-40, 40, 0); S(40, 40, 0); S(40, -40, 0); S(-40, -40, 0); S(-44, 20, 0); S(44, 0, 0); S(0, 45, 0); S(-8, -46, 0); S(30, -44, 0); S(-30, 44, 0); S(44, 30, 0); S(-44, -26, 0);
  }

  protected defineWaypoints() {
    const W: [number, number, number][] = [];
    const add = (x: number, y: number, z: number) => { W.push([x, y, z]); return W.length - 1; };
    // ground grid (skip inside solids)
    const gh = (x: number, z: number) => this.groundHeight(x, z);
    const gridPts: [number, number][] = [];
    for (let x = -42; x <= 42; x += 6) for (let z = -42; z <= 42; z += 6) gridPts.push([x, z]);
    // extra ground points at doors / interesting spots
    gridPts.push([-15, -1.5], [-15, -6], [17, 1.5], [17, -3], [12, -3], [17, -8], [13, -22], [-9, -1], [-4, -1], [3, 3], [-2, 3], [-13, 10], [-8, 6], [5, 10], [-18, 20], [20, 12], [10, 20], [-2, 18], [-7, 19], [-21, -15.2], [-16, -15], [-26, -15], [16, -19], [25, -19], [20, -8.5], [3, 20], [19, 5], [9, -9], [-10, -10], [22.7, 1], [-6, -21],
      [38, 12], [36, 16], [40, 10], [-22, 41], [22, 41], [-22, 35], [22, 35], [-38, 26], [-38, 20], [-38, 32], [-41, -6], [-36, -14], [-36, 2], [-14, -35], [-1, -38], [9, -33], [26, -36], [39, -17], [0, 40], [8, 44], [-8, 44], [33, 6], [-33, -20], [30, -30], [-30, 30], [45, 24], [-45, -34]);
    const ground: number[] = [];
    for (const [x, z] of gridPts) {
      // check free (raycast down from 6m, must hit near ground level and have headroom)
      const hit = this.physics.raycast(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0), 20, G.WORLD);
      if (!hit) continue; const y = hit.point.y; if (y > gh(x, z) + 0.6) continue;
      const up = this.physics.raycast(new THREE.Vector3(x, y + 0.3, z), new THREE.Vector3(0, 1, 0), 2.0, G.WORLD); if (up) continue;
      // avoid points too close to tall walls in all 4 directions (stuck spots)
      let blocked = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.physics.raycast(new THREE.Vector3(x, y + 0.9, z), new THREE.Vector3(dx, 0, dz), 0.7, G.WORLD)) blocked++;
      if (blocked >= 3) continue;
      ground.push(add(x, y, z));
    }
    // tower levels
    const t1 = add(0.7, 3.62, -2), t1b = add(1.8, 3.62, -2.4), t1s = add(2.6, 3.62, -3.2), t2 = add(0.7, 7.02, -2), t2s = add(-2.35, 7.02, -3.9), t2l = add(2.2, 7.02, 0.1), top = add(0, 10.34, -2.5), topL = add(2.0, 10.34, 0.2);
    const stairBottom = add(8.3, 0.2, -3.2); // bottom of external stair (east of the tower)
    const s1mid = add(5.7, 1.9, -3.2);
    const s2bottom = add(-2.35, 3.62, 0.6); const s2mid = add(-2.35, 5.3, -1.6);
    // containers / roofs
    const blueTop = add(19, 2.72, -19), blueTop2 = add(14.5, 2.72, -19), redTop = add(17.5, 5.32, -21.8), ramp1b = add(12.6, 0.1, -19), ramp1m = add(10.7, 1.3, -19);
    const greenTop = add(15, 2.72, 13), greenTop2 = add(15, 2.72, 9), ramp2b = add(15, 0.1, 6.4), ramp2m = add(15, 1.3, 8.4);
    const bunkerRoof = add(17, 3.9, -3), bunkerRoof2 = add(14, 3.9, -3), bStairB = add(22.2, 0.3, 0.3), bStairM = add(22.2, 2.0, -2.5), bStairT = add(22.2, 3.9, -5.0);
    const bunkerIn = add(17, 0.3, -3), bunkerIn2 = add(14.5, 0.3, -3);
    const shedIn = add(-15, 0.3, -6), shedIn2 = add(-13.5, 0.3, -4.5);
    const tankTop = add(-19, 6.1, 13), tankLadderB = add(-19, 0.35, 8.2), tankTop2 = add(-19, 6.1, 10.5);
    const pipeTop = add(0.4, 3.4, 6.5), pipeTop2 = add(-4, 3.4, 6.5), pipeTop3 = add(4.5, 3.4, 6.5), pipeUpB = add(-9.6, 1.5, 6.5), pipeUpB2 = add(-12, 1.45, 6.5), pipeDnB = add(10.4, 1.5, 6.5), pipeDnB2 = add(13, 1.45, 6.5);
    const walkway = add(-4.5, 2.78, 4.4);
    const redCont = add(-7.2, 0.15, -1), redContTop = add(-7.2, 2.72, -1), crateNearTower = add(-5.2, 3.6, -1);
    // outer ring nodes
    const nGreenTop = add(9, 2.72, -36), nGreenTop2 = add(13, 2.72, -36), nRampB = add(17.5, 0.1, -36), nRampM = add(15.5, 1.3, -36);
    const nBlueTop = add(-14, 2.72, -38), nRedTop = add(-15.5, 5.32, -40.6);
    const wtTop = add(26, 4.84, -41), wtStairB = add(26, 0.2, -32.5), wtStairM = add(26, 2.5, -36.5);
    const garRoof = add(38, 4.4, 14), garRoof2 = add(35, 4.4, 12), garLadB = add(38, 0.3, 19), garIn = add(37, 0.3, 13);
    const tankA = add(-41, 5.8, -14), tankB = add(-41, 5.8, 2), walkMid = add(-41, 5.8, -6), tankLadB = add(-36.8, 0.35, -14);
    const hangIn = add(-38, 0.4, 26), hangIn2 = add(-38, 0.4, 22), hangIn3 = add(-38, 0.4, 30);
    const pbW = add(-22, 0.3, 38), pbE = add(22, 0.3, 38);
    const wps: Waypoint[] = W.map((p, i) => ({ id: i, pos: new THREE.Vector3(p[0], p[1], p[2]), links: [] }));
    const link = (a: number, b: number, ladder?: number) => { if (!wps[a].links.includes(b)) wps[a].links.push(b); if (!wps[b].links.includes(a)) wps[b].links.push(a); if (ladder !== undefined) { wps[a].ladder = ladder; wps[b].ladder = ladder; } };
    // auto-link ground & flat nodes by LOS + slope
    const flatNodes = [...ground, blueTop, blueTop2, redTop, greenTop, greenTop2, bunkerRoof, bunkerRoof2, bunkerIn, bunkerIn2, shedIn, shedIn2, tankTop, tankTop2, pipeTop, pipeTop2, pipeTop3, t1, t1b, t1s, t2, t2s, t2l, top, topL, walkway, redCont, redContTop, crateNearTower, ramp1b, ramp2b, bStairB, stairBottom, tankLadderB, pipeUpB2, pipeDnB2,
      nGreenTop, nGreenTop2, nRampB, nBlueTop, nRedTop, wtTop, wtStairB, garRoof, garRoof2, garLadB, garIn, tankA, tankB, walkMid, tankLadB, hangIn, hangIn2, hangIn3, pbW, pbE];
    for (let i = 0; i < flatNodes.length; i++) for (let j = i + 1; j < flatNodes.length; j++) {
      const A = wps[flatNodes[i]].pos, Bp = wps[flatNodes[j]].pos; const dxz = Math.hypot(A.x - Bp.x, A.z - Bp.z); const dy = Math.abs(A.y - Bp.y);
      if (dxz > 8.6 || dy > 0.55) continue;
      const a = A.clone().setY(A.y + 1.0), b = Bp.clone().setY(Bp.y + 1.0);
      if (!this.physics.clearLine(a, b)) continue;
      // also require the midpoint to have ground within 1m below (no gaps)
      const mid = a.clone().lerp(b, 0.5); const down = this.physics.raycast(mid, new THREE.Vector3(0, -1, 0), 1.6, G.WORLD); if (!down) continue;
      link(flatNodes[i], flatNodes[j]);
    }
    // explicit stairs / ramps / ladders
    link(stairBottom, s1mid); link(s1mid, t1s); link(t1s, t1b); link(t1b, t1);
    link(t1, s2bottom); link(s2bottom, s2mid); link(s2mid, t2s); link(t2s, t2);
    link(t2l, topL, 0); // ladder id 0: tower L2 -> top
    link(ramp1b, ramp1m); link(ramp1m, blueTop2); link(blueTop, redTop);
    link(ramp2b, ramp2m); link(ramp2m, greenTop2);
    link(bStairB, bStairM); link(bStairM, bStairT); link(bStairT, bunkerRoof);
    link(tankLadderB, tankTop2, 1); // ladder id 1: oil tank
    link(pipeUpB2, pipeUpB); link(pipeUpB, pipeTop2); link(pipeDnB2, pipeDnB); link(pipeDnB, pipeTop3);
    link(walkway, pipeTop2); link(redContTop, crateNearTower); link(crateNearTower, t1);
    // outer ring explicit links
    link(nRampB, nRampM); link(nRampM, nGreenTop2); link(nBlueTop, nRedTop);
    link(wtStairB, wtStairM); link(wtStairM, wtTop);
    link(garLadB, garRoof, 2); // ladder id 2: garage roof
    link(tankLadB, tankA, 3);  // ladder id 3: twin tanks
    link(tankA, walkMid); link(walkMid, tankB);
    // ensure the red container (near tower) is reachable: ground node near its open end
    this.waypoints = wps;
    // drop isolated nodes' links check (keep all; pathfinding handles)
  }

  nearestWaypoint(p: THREE.Vector3, requireLinks = true) {
    let best = -1, bd = Infinity;
    for (const w of this.waypoints) { if (requireLinks && w.links.length === 0) continue; const d = w.pos.distanceToSquared(p) + Math.abs(w.pos.y - p.y) * 6; if (d < bd) { bd = d; best = w.id; } }
    return best;
  }

  /** A* over the waypoint graph. Returns list of waypoint ids (excluding start). */
  findPath(from: number, to: number): number[] {
    if (from === to) return [to];
    const wps = this.waypoints; const open = new Set<number>([from]); const came = new Map<number, number>();
    const g = new Map<number, number>([[from, 0]]); const f = new Map<number, number>([[from, wps[from].pos.distanceTo(wps[to].pos)]]);
    while (open.size) {
      let cur = -1, bf = Infinity; for (const n of open) { const v = f.get(n) ?? Infinity; if (v < bf) { bf = v; cur = n; } }
      if (cur === to) { const path = [cur]; while (came.has(cur)) { cur = came.get(cur)!; path.push(cur); } path.reverse(); path.shift(); return path; }
      open.delete(cur);
      for (const nb of wps[cur].links) {
        const cost = wps[cur].pos.distanceTo(wps[nb].pos) * (wps[cur].ladder !== undefined && wps[nb].ladder !== undefined ? 2.2 : 1);
        const t = (g.get(cur) ?? Infinity) + cost;
        if (t < (g.get(nb) ?? Infinity)) { came.set(nb, cur); g.set(nb, t); f.set(nb, t + wps[nb].pos.distanceTo(wps[to].pos)); open.add(nb); }
      }
    }
    return [];
  }
}
