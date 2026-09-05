import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto((process.env.TEST_URL||'http://127.0.0.1:5180')+'/tools/puppet-preview.html');await page.waitForFunction(()=>window.review);
 const images=await page.evaluate(async()=>{
  const {THREE}=window.review,{WEAPONS}=await import('/src/game/WeaponDefs.ts'),{loadWeaponModel,centerModel}=await import('/src/game/Weapons.ts'),{PhysicalModels,createWeaponOptic,opticMountHeight}=await import('/src/game/PhysicalModels.ts');await PhysicalModels.preload();
  const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setSize(640,210);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.7;
  scene.add(new THREE.HemisphereLight(0xf6f3e6,0x6b756c,3));const sun=new THREE.DirectionalLight(0xffedda,5);sun.position.set(2,4,3);scene.add(sun);const fill=new THREE.DirectionalLight(0xadc9dc,3);fill.position.set(-3,1,-2);scene.add(fill);
  const result={};for(const id of Object.keys(WEAPONS)){
   const def=WEAPONS[id],model=await loadWeaponModel(def);model.rotation.set(...def.model.rot);model.scale.setScalar(def.model.scale);centerModel(model);scene.add(model);const optic=createWeaponOptic();if(def.optic){optic.position.y=opticMountHeight(id,new THREE.Box3().setFromObject(model).max.y);scene.add(optic);}
   const size=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()),width=Math.max(size.z,size.x)*1.16,height=Math.max(width/3.0476,size.y*1.3);
   const distance=Math.max(5,size.length()*3);const camera=new THREE.OrthographicCamera(-height*3.0476/2,height*3.0476/2,height/2,-height/2,.01,distance*4);camera.position.set(distance,distance*.15,distance*.1);camera.lookAt(0,0,0);renderer.render(scene,camera);result[id]=renderer.domElement.toDataURL('image/png').split(',')[1];scene.remove(model,optic);
  }renderer.dispose();return result;
 });await mkdir('public/images/weapons',{recursive:true});for(const [id,image] of Object.entries(images))await writeFile('public/images/weapons/'+id+'.png',Buffer.from(image,'base64'));console.log('Rendered',Object.keys(images).length,'weapon previews');
}finally{await browser.close();}
