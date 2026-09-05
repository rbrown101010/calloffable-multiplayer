import {chromium} from 'playwright';import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:5182';assert.equal(new URL(base).hostname,'127.0.0.1');
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];const p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(e.message));
try{
 await p.goto(base+'/?nolock&noao&god');await p.waitForFunction(()=>window.__game?.state==='menu',null,{timeout:90000});await p.locator('#btn-deploy').click();await p.waitForFunction(()=>window.__game.state==='playing');
 const results=await p.evaluate(async()=>{
  const g=window.__game,THREE=await import('/node_modules/three/build/three.module.js'),{WEAPONS}=await import('/src/game/WeaponDefs.ts'),{ZIP_LINES}=await import('/src/game/Ziplines.ts');g.state='paused';g.countdown=0;g.bots.frozen=true;g.input.reset();
  const report={};report.vehicles=g.vehicles.list.map(v=>({kind:v.kind,wheels:v.wheels.length,front:v.front.length,box:new THREE.Box3().setFromObject(v.model).getSize(new THREE.Vector3()).toArray(),bottom:new THREE.Box3().setFromObject(v.model).min.y,gnd:g.map.groundHeight(v.pos.x,v.pos.z)}));
  const R=g.physics.R,capsule=new R.Capsule(.54,.36),q={x:0,y:0,z:0,w:1};report.zipObstacles=[];
  for(let i=0;i<=100;i++){const feet=g.ziplines.point(0,i/100),center=feet.clone().add(new THREE.Vector3(0,.95,0));const hit=g.physics.world.intersectionWithShape(center,q,capsule,undefined,undefined,g.player.collider,g.player.body,c=>!!(c.collisionGroups()>>>16&1));if(hit)report.zipObstacles.push({t:i/100,p:feet.toArray()});}
  report.landings=ZIP_LINES.flatMap(l=>[l.a,l.b].map(v=>g.physics.raycast(new THREE.Vector3(...v).add(new THREE.Vector3(0,.5,0)),new THREE.Vector3(0,-1,0),1,1)?.point.y));
  const ctx={canControl:true,canLook:false,speedMul:1,adsHeld:false,adsFov:60,adsTime:.2,firing:false};
  const walk=(x,z,n=600)=>{g.input.keys.add('KeyW');let count=0;while(Math.hypot(g.player.pos.x-x,g.player.pos.z-z)>.22&&count++<n){g.player.yaw=Math.atan2(g.player.pos.x-x,g.player.pos.z-z);g.player.update(1/60,ctx);g.physics.step(1/60);}g.input.reset();return{p:g.player.pos.toArray(),feet:g.player.feetY,count};};
  report.buildings=[];for(const [x,z,w]of [[18,-126,18],[-129,7,16],[80,126,22]]){const sx=x+w/2+1.6;g.player.teleport(new THREE.Vector3(sx,.25,z+11.5));const route=[walk(sx,z+3),walk(sx,z+1),walk(sx,z-6),walk(x+w/2-1,z-5)];report.buildings.push(route);}
  g.player.teleport(new THREE.Vector3(13,29.75,9));report.roofApproach=walk(15,9);g.player.yaw=Math.PI/2;g.input.keys.add('KeyW');for(let i=0;i<180;i++){g.player.update(1/60,ctx);g.physics.step(1/60);if(g.player.feetY>34.2&&!g.player.climbing)break;}g.input.reset();report.roof={p:g.player.pos.toArray(),feet:g.player.feetY};
  // Ballistic arc is independent of frame subdivision and cannot detonate before arming.
  const oldExplode=g.grenades.explodeAt.bind(g.grenades);let blasts=0;g.grenades.explodeAt=()=>blasts++;
  const fire=(x,z)=>{g.ordnance.clear();g.player.teleport(new THREE.Vector3(x,.1,z));g.player.yaw=0;g.player.pitch=0;g.player.updateRig(0);g.ordnance.launch(g.player,'m32');};
  fire(0,145);for(let i=0;i<30;i++)g.ordnance.update(1/120);const fine=g.ordnance.list[0]?.p.clone();fire(0,145);for(let i=0;i<5;i++)g.ordnance.update(.05);report.arcError=fine.distanceTo(g.ordnance.list[0].p);
  const wall=g.physics.addStaticBox(new THREE.Vector3(0,2,142),new THREE.Vector3(3,4,.25));g.physics.step(1/60);fire(0,145);for(let i=0;i<30;i++)g.ordnance.update(1/60);report.dud={blasts,dud:g.ordnance.list[0]?.dud};g.physics.world.removeCollider(wall,true);
  const farWall=g.physics.addStaticBox(new THREE.Vector3(0,2,133),new THREE.Vector3(3,4,.25));g.physics.step(1/60);fire(0,145);for(let i=0;i<35;i++)g.ordnance.update(1/60);report.armedBlasts=blasts;g.physics.world.removeCollider(farWall,true);g.ordnance.clear();g.grenades.explodeAt=oldExplode;
  report.rpm=WEAPONS.m32.rpm;report.damage=WEAPONS.m32.projectile.damage;
  return report;
 });console.log(JSON.stringify(results,null,2));
 for(const v of results.vehicles){assert.equal(v.wheels,v.kind==='atv'?4:2);assert.equal(v.front,v.kind==='atv'?2:1);assert(Math.abs(v.bottom-v.gnd)<.03,'Vehicle contacts ground');assert(v.box[1]>.8&&v.box[1]<2.2);}
 assert.equal(results.zipObstacles.length,0,'Zip-line clearance');assert(Math.abs(results.landings[0]-34.275)<.03);assert(Math.abs(results.landings[1]-5.64)<.03);
 for(const route of results.buildings)assert(Math.abs(route.at(-1).feet-7.82)<.2,'Building roof access');assert(results.roof.feet>34.2,'Tower roof ladder');
 assert(results.arcError<.001);assert.deepEqual(results.dud,{blasts:0,dud:true});assert.equal(results.armedBlasts,1);assert.equal(results.rpm,42);assert.equal(results.damage,180);assert.deepEqual(errors,[]);
 console.log('PASS vehicle model bounds and animated axles, all new roof routes, zip-line clearance, launcher arc, arming safety and blast');
}catch(e){console.error(e);await p.screenshot({path:'output/visual-round-failure.png'}).catch(()=>{});process.exitCode=1;}finally{await browser.close();}
