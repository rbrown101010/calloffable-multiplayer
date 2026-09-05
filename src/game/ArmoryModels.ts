import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Original, distinct weapon silhouettes. Muzzle faces -Z; dimensions are in meters. */
export function buildArmoryWeapon(id:string):THREE.Group{
  const group=new THREE.Group();group.name=id;
  const steel=new THREE.MeshStandardMaterial({color:0x313b40,metalness:.83,roughness:.34});
  const polymer=new THREE.MeshStandardMaterial({color:0x20292a,metalness:.12,roughness:.75});
  const tan=new THREE.MeshStandardMaterial({color:0x6f7665,metalness:.25,roughness:.64});
  const wood=new THREE.MeshStandardMaterial({color:0x66503c,roughness:.65,metalness:.08});
  const brass=new THREE.MeshStandardMaterial({color:0xc8a552,metalness:.77,roughness:.33});
  const dark=new THREE.MeshStandardMaterial({color:0x0b1014,roughness:.85});
  const parts=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(mat:THREE.Material,geo:THREE.BufferGeometry,p:number[],rot:number[]=[0,0,0])=>{geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p as [number,number,number]),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot as [number,number,number])),new THREE.Vector3(1,1,1)));if(!parts.has(mat))parts.set(mat,[]);parts.get(mat)!.push(geo);};
  const box=(m:THREE.Material,w:number,h:number,d:number,x:number,y:number,z:number,rx=0)=>add(m,Math.min(w,h,d)>.019?new RoundedBoxGeometry(w,h,d,1,Math.min(.008,Math.min(w,h,d)*.15)):new THREE.BoxGeometry(w,h,d),[x,y,z],[rx,0,0]);
  const tube=(m:THREE.Material,r:number,l:number,x:number,y:number,z:number)=>add(m,new THREE.CylinderGeometry(r,r,l,20),[x,y,z],[Math.PI/2,0,0]);
  const rail=(z:number,length:number,y=.12)=>{box(steel,.055,.023,length,0,y,z);for(let t=z-length/2;t<z+length/2;t+=.027)box(dark,.067,.015,.012,0,y+.018,t);};
  const barrel=(z:number,len:number,r=.018)=>{tube(steel,r,len,0,.025,z);tube(dark,r*1.55,.06,0,.025,z-len/2);tube(steel,r*.75,.002,0,.025,z-len/2-.031);};
  const grip=(z:number,mat:THREE.Material=polymer)=>{box(mat,.052,.17,.083,0,-.12,z,-.24);for(let n=0;n<5;n++)box(dark,.054,.006,.08,0,-.065-n*.026,z);};
  if(id==='rpg7'){
    tube(steel,.052,.98,0,.025,0);tube(wood,.063,.34,0,.025,.19);tube(dark,.085,.12,0,.025,.55);
    tube(tan,.062,.16,0,.025,-.53);add(tan,new THREE.ConeGeometry(.076,.3,20),[0,.025,-.75],[-Math.PI/2,0,0]);
    grip(.03);grip(-.3);box(steel,.026,.16,.04,.065,.095,-.13);box(polymer,.09,.06,.2,.08,.19,-.13);rail(-.12,.2,.23);
  }else if(id==='m32'){
    box(tan,.15,.14,.26,0,.015,.08);tube(steel,.031,.31,0,.04,-.33);tube(dark,.04,.05,0,.04,-.51);
    tube(polymer,.132,.18,0,-.085,-.07);for(let n=0;n<6;n++){const a=n*Math.PI/3;tube(brass,.033,.19,Math.sin(a)*.085,-.085+Math.cos(a)*.085,-.07);tube(dark,.025,.003,Math.sin(a)*.085,-.085+Math.cos(a)*.085,-.166);}
    grip(.22);box(polymer,.08,.07,.28,0,.015,.32);box(polymer,.06,.19,.06,0,-.025,.49);rail(-.02,.3,.17);
  }else if(id==='p90'){
    box(tan,.105,.16,.51,0,0,.025);box(tan,.11,.22,.12,0,-.05,.29);box(polymer,.09,.1,.15,0,-.1,-.18);box(dark,.065,.085,.14,0,-.08,.055);
    box(steel,.09,.055,.36,0,.13,-.035);for(let i=0;i<14;i++)box(brass,.068,.015,.012,0,.15,-.19+i*.023);
    barrel(-.31,.17);rail(-.07,.18,.2);box(dark,.12,.23,.03,0,-.04,.36);
  }else if(id==='vector'){
    box(tan,.082,.14,.24,0,.035,0);box(tan,.095,.21,.13,0,-.095,-.06);box(polymer,.055,.25,.06,0,-.23,.005,.06);grip(.16);
    barrel(-.22,.2);box(steel,.035,.025,.23,0,.045,.27);box(polymer,.058,.16,.04,0,-.02,.39);rail(-.015,.26,.125);
  }else if(id==='m249'){
    box(tan,.12,.145,.43,0,0,0);box(polymer,.095,.15,.27,0,.005,.36);grip(.2);barrel(-.49,.55,.023);box(polymer,.115,.11,.28,0,-.03,-.33);
    box(tan,.23,.18,.21,0,-.16,-.03);for(let n=0;n<8;n++)tube(brass,.014,.085,.07+n*.018,-.065-n*.006,.0);
    box(steel,.025,.065,.19,.05,.16,-.025);rail(-.02,.33);for(const x of[-.06,.06])box(steel,.018,.34,.025,x,-.17,-.56,x>0?.3:-.3);
  }else if(id==='m14'){
    box(wood,.075,.11,.52,0,-.035,.03);box(steel,.065,.075,.28,0,.045,.03);box(wood,.065,.14,.28,0,-.035,.39);box(dark,.068,.16,.024,0,-.036,.54);
    barrel(-.51,.56);box(steel,.072,.16,.11,0,-.13,.04,-.1);grip(.24,wood);rail(.02,.22,.13);for(const x of[-.035,.035])box(dark,.009,.008,.27,x,.02,-.22);
  }else{
    const compact=id==='mp7';box(compact?polymer:tan,.082,.14,compact?.24:.38,0,0,0);grip(compact?.07:.15);
    box(polymer,.053,compact?.24:.19,.075,0,-.14,compact?.07:-.015,-.08);barrel(compact?-.22:-.4,compact?.2:.34);
    box(polymer,.075,.13,compact?.12:.22,0,0,compact?.2:.32);box(dark,.08,.18,.022,0,-.02,compact?.27:.44);
    box(polymer,.09,.1,compact?.13:.25,0,-.025,compact?-.15:-.22);rail(-.015,compact?.23:.36,.13);
    if(id==='g36'){for(const x of[-.035,.035])box(polymer,.015,.09,.025,x,.15,.115);rail(.025,.23,.205);for(let n=0;n<5;n++)for(const x of[-.046,.046])box(dark,.004,.03,.025,x,0,-.29+n*.04);}
  }
  // Receiver hardware gives each model readable scale, with few draw calls.
  if(!['rpg7','m32'].includes(id))for(const x of[-1,1])for(const z of[-.07,.09]){add(steel,new THREE.CylinderGeometry(.008,.008,.005,8),[x*.047,.01,z],[0,0,Math.PI/2]);}
  for(const [mat,geos]of parts){const merged=mergeGeometries(geos.map(g=>g.index?g.toNonIndexed():g),false)!;for(const geo of geos)geo.dispose();const mesh=new THREE.Mesh(merged,mat);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}
  return group;
}
