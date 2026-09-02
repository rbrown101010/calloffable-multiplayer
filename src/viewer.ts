import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const params = new URLSearchParams(location.search);
const url = params.get('m') || '';
const info = document.getElementById('info')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x3a4048);
const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(3, 5, 2); scene.add(light);
function onLoaded(root: THREE.Object3D, anims: THREE.AnimationClip[] = []) {
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
  let tris = 0, meshes = 0; const mats = new Set<string>(); const texs = new Set<string>(); const names: string[] = [];
  root.traverse((o: any) => { if (o.isMesh) { meshes++; names.push(o.name); const g2 = o.geometry; tris += (g2.index ? g2.index.count : g2.attributes.position.count) / 3; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m: any) => { mats.add(m.name || m.type); for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap']) if (m[k]) texs.add(k + ':' + m[k].image?.width + 'x' + m[k].image?.height); }); } });
  const maxDim = Math.max(size.x, size.y, size.z);
  scene.add(new THREE.GridHelper(maxDim * 2, 20, 0x888888, 0x555555).translateY(box.min.y));
  const view = params.get('v') || 'iso';
  // profile view: look along the thinnest axis so the weapon silhouette is visible
  const thin = size.x <= size.y && size.x <= size.z ? new THREE.Vector3(1, 0.12, 0.05) : size.z <= size.y ? new THREE.Vector3(0.05, 0.12, 1) : new THREE.Vector3(0.05, 1, 0.1);
  const off = view === 'side' ? thin : view === 'top' ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(1, 0.5, 1);
  camera.position.copy(center).add(off.normalize().multiplyScalar(maxDim * 1.6)); controls.target.copy(center); camera.near = maxDim / 100; camera.far = maxDim * 100; camera.updateProjectionMatrix();
  info.textContent = `${url}\nsize: ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}  center: ${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)}\nmeshes: ${meshes} tris: ${Math.round(tris)}\nmats: ${[...mats].join(', ')}\ntex: ${[...texs].join(', ')}\nanims: ${anims.map(a => a.name + '(' + a.duration.toFixed(1) + 's)').join(', ')}\nnodes: ${names.slice(0, 40).join(', ')}`;
  (window as any).__ready = true;
}
if (url.endsWith('.obj')) {
  const mtl = url.replace(/\.obj$/, '.mtl');
  new MTLLoader().load(mtl, (m) => { m.preload(); new OBJLoader().setMaterials(m).load(url, (o) => onLoaded(o)); }, undefined, () => new OBJLoader().load(url, (o) => onLoaded(o)));
} else {
  new GLTFLoader().load(url, (g) => onLoaded(g.scene, g.animations), undefined, (e) => { info.textContent = 'ERR ' + e; });
}
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
function onResize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', onResize); setTimeout(onResize, 100); setTimeout(onResize, 1000);
