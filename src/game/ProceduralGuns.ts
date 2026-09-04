import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadTex } from './Materials';

/**
 * Procedurally built CheyTac M200 "Intervention" from real proportions (barrel 0.74m, overall ~1.35m).
 * Axis: muzzle points to -Z, up +Y, right +X. Origin at receiver center.
 */
export function buildIntervention(): THREE.Group {
  const g = new THREE.Group(); g.name = 'intervention';
  const detailN = loadTex('/textures/metal_plate_02/nor_gl.jpg'); const dn = detailN.clone(); dn.repeat.set(3, 3); dn.needsUpdate = true;
  const tan = new THREE.MeshStandardMaterial({ color: 0xb59c74, roughness: 0.62, metalness: 0.35, normalMap: dn, normalScale: new THREE.Vector2(0.25, 0.25) });
  const tanDark = new THREE.MeshStandardMaterial({ color: 0x8d7757, roughness: 0.7, metalness: 0.3, normalMap: dn, normalScale: new THREE.Vector2(0.25, 0.25) });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.42, metalness: 0.75, normalMap: dn, normalScale: new THREE.Vector2(0.2, 0.2) });
  const blackMatte = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.85, metalness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.95, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.35, metalness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1420, roughness: 0.05, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x08101c, emissiveIntensity: 0.4 });
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (mat: THREE.Material, geo: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    geo.applyMatrix4(m); if (!parts.has(mat)) parts.set(mat, []); parts.get(mat)!.push(geo);
  };
  const box = (mat: THREE.Material, w: number, h: number, d: number, pos: [number, number, number], rot?: [number, number, number]) => add(mat, new THREE.BoxGeometry(w, h, d), pos, rot);
  /** cylinder along Z */
  const cylZ = (mat: THREE.Material, r1: number, r2: number, len: number, pos: [number, number, number], seg = 20, rot: [number, number, number] = [Math.PI / 2, 0, 0]) => add(mat, new THREE.CylinderGeometry(r1, r2, len, seg), pos, rot);
  const cylY = (mat: THREE.Material, r1: number, r2: number, len: number, pos: [number, number, number], seg = 16, rot: [number, number, number] = [0, 0, 0]) => add(mat, new THREE.CylinderGeometry(r1, r2, len, seg), pos, rot);
  const cylX = (mat: THREE.Material, r1: number, r2: number, len: number, pos: [number, number, number], seg = 12) => add(mat, new THREE.CylinderGeometry(r1, r2, len, seg), pos, [0, 0, Math.PI / 2]);

  // ---- receiver (cylindrical body with flat top rail)
  cylZ(tan, 0.037, 0.037, 0.44, [0, 0, -0.04], 24);
  box(tan, 0.05, 0.03, 0.44, [0, 0.018, -0.04]);                    // flat top
  box(black, 0.028, 0.012, 0.42, [0, 0.04, -0.04]);                 // top rail
  for (let i = 0; i < 16; i++) box(black, 0.03, 0.006, 0.012, [0, 0.049, -0.24 + i * 0.026]); // rail ridges
  cylZ(steel, 0.014, 0.014, 0.05, [0, 0.005, 0.2], 12);              // bolt rear
  // bolt handle (right side, angled down)
  cylX(black, 0.007, 0.007, 0.06, [0.05, 0.0, 0.14]);
  add(black, new THREE.CylinderGeometry(0.007, 0.007, 0.05, 10), [0.085, -0.02, 0.14], [0, 0, 0.6]);
  add(black, new THREE.SphereGeometry(0.014, 12, 10), [0.1, -0.04, 0.14]);
  // ejection port
  box(blackMatte, 0.004, 0.02, 0.07, [0.037, 0.008, 0.03]);
  // ---- chassis / handguard
  box(tan, 0.056, 0.058, 0.4, [0, -0.008, -0.45]);
  box(tanDark, 0.058, 0.02, 0.4, [0, -0.04, -0.45]);
  for (let s of [-1, 1]) for (let i = 0; i < 7; i++) { box(blackMatte, 0.004, 0.016, 0.022, [s * 0.0285, 0.006, -0.3 - i * 0.05]); box(blackMatte, 0.004, 0.016, 0.022, [s * 0.0285, -0.02, -0.325 - i * 0.05]); }
  // ---- barrel (tapered) with chamber reinforcement and flutes
  cylZ(black, 0.02, 0.02, 0.12, [0, 0.008, -0.66], 16);
  cylZ(black, 0.0165, 0.013, 0.56, [0, 0.008, -0.99], 16);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; box(blackMatte, 0.004, 0.003, 0.46, [Math.cos(a) * 0.015, 0.008 + Math.sin(a) * 0.015, -0.98], [0, 0, a]); }
  // ---- muzzle brake
  cylZ(black, 0.024, 0.024, 0.135, [0, 0.008, -1.315], 16);
  cylZ(black, 0.027, 0.027, 0.02, [0, 0.008, -1.255], 16);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) box(blackMatte, 0.012, 0.014, 0.014, [s * 0.026, 0.008, -1.27 - i * 0.026]);
  for (let i = 0; i < 4; i++) box(blackMatte, 0.014, 0.012, 0.014, [0, 0.034, -1.27 - i * 0.026]);
  cylZ(blackMatte, 0.006, 0.006, 0.02, [0, 0.008, -1.385], 10); // bore
  // ---- scope mount & scope (Nightforce-style 56mm objective)
  for (const z of [-0.14, 0.03]) { box(black, 0.032, 0.05, 0.028, [0, 0.07, z]); box(black, 0.046, 0.018, 0.028, [0, 0.11, z]); }
  cylZ(black, 0.017, 0.017, 0.44, [0, 0.105, -0.05], 24);
  cylZ(black, 0.017, 0.034, 0.06, [0, 0.105, -0.3], 24);
  cylZ(black, 0.034, 0.034, 0.1, [0, 0.105, -0.38], 24);
  cylZ(glass, 0.031, 0.031, 0.004, [0, 0.105, -0.429], 24);
  cylZ(black, 0.017, 0.024, 0.05, [0, 0.105, 0.195], 24);
  cylZ(black, 0.024, 0.024, 0.075, [0, 0.105, 0.257], 24);
  cylZ(glass, 0.021, 0.021, 0.004, [0, 0.105, 0.294], 24);
  cylY(black, 0.02, 0.02, 0.036, [0, 0.135, -0.02], 18); cylY(black, 0.021, 0.021, 0.006, [0, 0.155, -0.02], 18);
  cylX(black, 0.018, 0.018, 0.034, [0.036, 0.105, -0.02], 18);
  cylX(black, 0.014, 0.014, 0.026, [-0.03, 0.105, -0.02], 18); // parallax
  cylZ(black, 0.026, 0.026, 0.03, [0, 0.105, 0.12], 24);        // magnification ring
  // ---- pistol grip & trigger
  add(black, new THREE.BoxGeometry(0.03, 0.115, 0.045), [0.0, -0.085, 0.12], [-0.28, 0, 0]);
  box(black, 0.032, 0.02, 0.06, [0, -0.035, 0.1]);
  box(black, 0.006, 0.05, 0.004, [0, -0.07, 0.035]); box(black, 0.006, 0.004, 0.09, [0, -0.095, 0.075]); box(black, 0.006, 0.05, 0.004, [0, -0.07, 0.12]); // trigger guard
  add(steel, new THREE.BoxGeometry(0.005, 0.03, 0.006), [0, -0.055, 0.052], [0.3, 0, 0]); // trigger
  // ---- magazine
  add(black, new THREE.BoxGeometry(0.04, 0.13, 0.1), [0, -0.1, -0.03], [-0.08, 0, 0]);
  box(blackMatte, 0.042, 0.012, 0.102, [0, -0.165, -0.035]);
  // ---- skeleton stock
  box(tan, 0.052, 0.08, 0.06, [0, -0.005, 0.245]);                       // hinge block
  box(tan, 0.024, 0.032, 0.31, [0, 0.03, 0.43]);                          // upper bar
  box(tan, 0.024, 0.032, 0.31, [0, -0.115, 0.43]);                        // lower bar
  box(tan, 0.024, 0.14, 0.03, [0, -0.045, 0.29]);                         // front vertical
  box(tan, 0.036, 0.2, 0.03, [0, -0.045, 0.585]);                         // butt plate
  box(rubber, 0.04, 0.205, 0.014, [0, -0.045, 0.607]);                    // butt pad
  box(rubber, 0.032, 0.026, 0.17, [0, 0.06, 0.41]);                       // cheek rest
  box(tanDark, 0.026, 0.01, 0.17, [0, 0.048, 0.41]);
  cylY(steel, 0.005, 0.005, 0.11, [0, -0.19, 0.545], 10);                 // monopod
  box(black, 0.03, 0.01, 0.02, [0, -0.25, 0.545]);
  cylY(black, 0.008, 0.008, 0.02, [0, -0.135, 0.545], 10);
  // ---- bipod (folded forward under the chassis)
  box(black, 0.05, 0.026, 0.04, [0, -0.052, -0.6]);
  for (const s of [-1, 1]) { add(black, new THREE.CylinderGeometry(0.006, 0.006, 0.24, 10), [s * 0.02, -0.056, -0.73], [Math.PI / 2, 0, s * 0.03]); box(rubber, 0.014, 0.014, 0.02, [s * 0.024, -0.056, -0.86]); }
  // ---- small details: sling loops, screws
  cylX(steel, 0.004, 0.004, 0.06, [0, 0.02, 0.24]);
  for (const z of [-0.2, -0.1, 0.05]) cylX(steel, 0.004, 0.004, 0.06, [0, -0.02, z]);

  for (const [mat, geos] of parts) {
    const merged = mergeGeometries(geos.map((x) => x.toNonIndexed()), false)!;
    const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'intervention_part';
    g.add(mesh);
  }
  return g;
}

/** M67 fragmentation grenade. */
export function buildGrenade(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), new THREE.MeshStandardMaterial({ color: 0x3b4a30, roughness: 0.7, metalness: 0.3 }));
  body.scale.set(1, 1.15, 1); g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.4, metalness: 0.9 })); top.position.y = 0.04; g.add(top);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.012), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.4, metalness: 0.9 })); lever.position.set(0.014, 0.02, 0); lever.rotation.z = -0.3; g.add(lever);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

/** Complete, meter-scale AK receiver, barrel, furniture and curved magazine. */
export function buildAK47():THREE.Group {
  const g=new THREE.Group();g.name='AK-47';
  const steel=new THREE.MeshStandardMaterial({color:0x303637,metalness:.8,roughness:.43});
  const dark=new THREE.MeshStandardMaterial({color:0x151a1c,metalness:.65,roughness:.6});
  const wood=new THREE.MeshStandardMaterial({color:0x85472a,metalness:.08,roughness:.63});
  const rubber=new THREE.MeshStandardMaterial({color:0x222120,roughness:.95});
  const parts=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(mat:THREE.Material,geo:THREE.BufferGeometry,p:number[],rot=[0,0,0])=>{geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p as [number,number,number]),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot as [number,number,number])),new THREE.Vector3(1,1,1)));if(!parts.has(mat))parts.set(mat,[]);parts.get(mat)!.push(geo);};
  const box=(mat:THREE.Material,s:number[],p:number[],rot?:number[])=>add(mat,new THREE.BoxGeometry(...s as [number,number,number]),p,rot);
  const tube=(mat:THREE.Material,r:number,len:number,p:number[])=>add(mat,new THREE.CylinderGeometry(r,r,len,14),p,[Math.PI/2,0,0]);
  box(steel,[.066,.075,.32],[0,0,0]);tube(dark,.034,.3,[0,.022,-.005]);
  tube(steel,.011,.5,[0,.006,-.39]);tube(dark,.017,.065,[0,.006,-.659]);
  tube(steel,.009,.29,[0,.045,-.3]);box(steel,[.033,.057,.035],[0,.025,-.43]);
  box(wood,[.072,.064,.22],[0,-.015,-.267]);tube(wood,.027,.17,[0,.033,-.27]);
  for(const z of[-.205,-.27,-.335])box(dark,[.074,.008,.009],[0,-.018,z]);
  box(steel,[.065,.012,.23],[0,.06,-.018]);for(let i=0;i<12;i++)box(dark,[.07,.006,.008],[0,.069,-.12+i*.018]);
  box(wood,[.054,.118,.062],[0,-.098,.103],[.25,0,0]);
  box(wood,[.052,.1,.265],[0,-.005,.298],[.09,0,0]);box(wood,[.057,.143,.095],[0,-.022,.43],[.08,0,0]);box(rubber,[.06,.15,.018],[0,-.023,.479],[.08,0,0]);
  box(steel,[.005,.035,.135],[.038,-.005,.045],[0,.08,-.05]);box(dark,[.092,.013,.013],[.018,.015,.055]);
  for(const z of[-.1,-.03,.1])add(dark,new THREE.CylinderGeometry(.005,.005,.072,8),[0,-.016,z],[0,0,Math.PI/2]);
  box(steel,[.015,.058,.018],[0,.03,-.588]);add(dark,new THREE.TorusGeometry(.014,.003,6,14),[0,.062,-.588]);box(steel,[.063,.022,.025],[0,.065,.1]);
  const guard=new THREE.Shape();guard.moveTo(-.048,-.049);guard.lineTo(.046,-.049);guard.lineTo(.054,-.105);guard.lineTo(-.035,-.105);guard.closePath();const hole=new THREE.Path();hole.moveTo(-.034,-.059);hole.lineTo(-.025,-.094);hole.lineTo(.04,-.094);hole.lineTo(.032,-.059);hole.closePath();guard.holes.push(hole);add(dark,new THREE.ExtrudeGeometry(guard,{depth:.008,bevelEnabled:false}).rotateY(Math.PI/2),[-.004,0,.07]);
  const shape=new THREE.Shape();shape.moveTo(-.04,-.04);shape.lineTo(.085,-.04);shape.quadraticCurveTo(.09,-.17,.16,-.285);shape.lineTo(.13,-.32);shape.lineTo(.035,-.298);shape.quadraticCurveTo(-.025,-.19,-.04,-.04);
  const mag=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.049,bevelEnabled:true,bevelThickness:.002,bevelSize:.003,bevelSegments:1,steps:1}).rotateY(Math.PI/2),dark);mag.position.x=-.0245;mag.name='magazine';g.add(mag);
  for(const [mat,geos]of parts){const mesh=new THREE.Mesh(mergeGeometries(geos.map(geo=>geo.index?geo.toNonIndexed():geo),false)!,mat);g.add(mesh);for(const geo of geos)geo.dispose();}
  return g;
}
