import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Shared geometry and textures are loaded once, including across map changes. */
export class PhysicalModels {
  private static models=new Map<string,THREE.Group>();
  private static ready?:Promise<void>;
  static preload(){return this.ready??=Promise.all(['atv','motorcycle','helicopter','optic'].map(async id=>{
    const model=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/'+(id==='optic'?'weapons':'vehicles')+'/'+id+'.glb')).scene;
    model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial){m.envMapIntensity=.85;if(id==='atv'&&m.map)m.color.set(0x9caa89);}}});
    this.models.set(id,model);
  })).then(()=>{});}
  static clone(id:string){const source=this.models.get(id);if(!source)throw new Error('Model not loaded: '+id);const model=source.clone(true);model.userData.sharedAsset=true;return model;}
}

/** Optical origin is centered on the glass window, with the base 5.5 cm below it. */
export function createWeaponOptic(){const g=new THREE.Group(),model=PhysicalModels.clone('optic');model.position.set(.00185,-.01735,0);g.add(model);return g;}
export function opticMountHeight(id:string,top:number){const offsets:Record<string,number>={m249:-.045,m14:-.02,p90:-.04,g36:-.012,vector:-.018,mp7:-.018,ak47:-.008,m32:-.005};return top+.055+(offsets[id]||0);}
