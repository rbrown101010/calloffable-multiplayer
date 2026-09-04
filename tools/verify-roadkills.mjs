import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const base=process.env.TEST_URL||'http://127.0.0.1:5180';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],contexts=[];const testRoom='roadkill-'+crypto.randomUUID();
const open=async()=>{const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/lobby',async route=>{const response=await route.fetch();const data=await response.json();if(response.ok())data.roomId+='-'+testRoom;await route.fulfill({response,json:data});});await page.goto(base+'/?nolock&noao');await page.waitForFunction(()=>window.__game?.state==='menu',undefined,{timeout:90000});return page;};
const stop=async p=>{await p.keyboard.up('w');await p.keyboard.up('Shift');await p.keyboard.down('Space');await p.waitForTimeout(900);await p.keyboard.up('Space');};
const soloFixture=async(page,speed,targets)=>page.evaluate(({speed,targets})=>{
  const g=window.__game;g.bots.frozen=true;g.bullets.list.length=0;
  for(const b of g.bots.bots){b.die();b.respawnT=1e9;}
  for(let i=0;i<targets.length;i++)g.bots.bots[i].spawnAt(g.player.pos.clone().fromArray(targets[i]),0);
  const v=g.vehicles.current;v.pos.set(45,.7,29);v.yaw=0;v.pitch=v.roll=v.vy=0;v.speed=speed;v.grounded=true;g.vehicles.contacts.clear();g.vehicles.place(v);
}, {speed,targets});
const stats=page=>page.evaluate(()=>{const g=window.__game;return{health:g.bots.bots.map(b=>b.health),alive:g.bots.bots.map(b=>b.alive),kills:g.player.kills,score:g.player.score,p:g.vehicles.current?.pos.toArray(),speed:g.vehicles.current?.speed,feed:g.hud.killfeed.textContent,messages:g.hud.centerMsgs.textContent};});

try{
 const p=await open();await p.locator('#btn-deploy').click();await p.waitForFunction(()=>window.__game.state==='playing'&&window.__game.countdown<=0,undefined,{timeout:20000});
 await p.evaluate(()=>{const g=window.__game;g.bots.frozen=true;g.player.teleport(g.player.pos.clone().set(45,0,31));});await p.keyboard.press('e');await p.waitForFunction(()=>window.__game.player.mounted);
 await soloFixture(p,3,[[45,0,26.7]]);await p.waitForTimeout(1000);
 let s=await stats(p);assert.equal(s.health[0],100);assert(s.p[2]>28.1&&s.p[2]<29,JSON.stringify(s));console.log('PASS parking-speed contact causes no damage');
 await soloFixture(p,8,[[45,0,26]]);await p.waitForFunction(()=>window.__game.bots.bots[0].health<100,undefined,{timeout:4000});
 const medium=await stats(p);assert(medium.health[0]>0&&medium.health[0]<90,JSON.stringify(medium));
 await p.keyboard.down('w');await p.waitForTimeout(1700);await p.keyboard.up('w');s=await stats(p);assert.equal(s.health[0],medium.health[0]);console.log('PASS moderate impact wounds once; sustained contact cannot farm damage',medium.health[0]);
 // Reverse away far enough to separate, then a fresh approach may deal damage again.
 await p.keyboard.down('s');await p.waitForTimeout(1700);await p.keyboard.up('s');await stop(p);
 await p.keyboard.down('w');await p.waitForFunction(h=>window.__game.bots.bots[0].health<h,medium.health[0],{timeout:6000});await stop(p);console.log('PASS separating and making a new approach permits a new impact');
 const before=await stats(p);
 await soloFixture(p,0,[[45,0,12],[45,0,4],[47.2,0,12],[45,4,12]]);
 await p.keyboard.down('w');await p.keyboard.down('Shift');await p.waitForFunction(()=>!window.__game.bots.bots[0].alive&&!window.__game.bots.bots[1].alive,undefined,{timeout:6000});
 s=await stats(p);assert.equal(s.kills,before.kills+2);assert.equal(s.score,before.score+200);assert.equal(s.health[2],100);assert.equal(s.health[3],100);assert(s.feed.includes('KESTREL ATV'));assert(s.messages.includes('ROADKILL'));assert(s.p[2]<6,JSON.stringify(s));
 await mkdir('output/playwright',{recursive:true});await p.screenshot({path:'output/playwright/roadkill.png'});await stop(p);
 assert.equal((await stats(p)).kills,before.kills+2);console.log('PASS boosted run-over kills two enemies, carries through, and awards each kill once');console.log('PASS nearby and elevated enemies are untouched');
 await soloFixture(p,-7,[[45,0,32]]);await p.waitForFunction(()=>window.__game.bots.bots[0].health<100,undefined,{timeout:4000});s=await stats(p);assert(s.health[0]>0);console.log('PASS reverse impacts scale with their lower speed');
 await soloFixture(p,19,[[45,0,18]]);
 await p.evaluate(()=>{const g=window.__game,V=g.player.pos.constructor;window.testWall=g.physics.addStaticBox(new V(45,1.5,21),new V(5,3,.35));});
 await p.keyboard.down('w');await p.waitForTimeout(1500);await stop(p);s=await stats(p);assert.equal(s.health[0],100);assert(s.p[2]>22,JSON.stringify(s));console.log('PASS solid wall stops the ATV and protects the enemy behind it');
 await p.context().close();contexts.splice(contexts.indexOf(p.context()),1);

 if(process.env.LOBBY_HOST_KEY&&process.env.LOBBY_INVITE_KEY){
   const a=await open(),b=await open();
   for(const [page,name,key]of [[a,'ROADKILL HOST',process.env.LOBBY_HOST_KEY],[b,'ROADKILL GUEST',process.env.LOBBY_INVITE_KEY]]){
     await page.getByRole('button',{name:'PRIVATE MULTIPLAYER'}).click();await page.locator('#callsign').fill(name);await page.locator('#invite-code').fill(key);await page.locator('#lobby-join').click();await page.waitForFunction(()=>window.__game.online.connected,undefined,{timeout:20000});
   }
   await a.waitForFunction(()=>window.__game.online.peers.size===2&&window.__game.online.remotes.size===1,undefined,{timeout:15000});
   await b.waitForFunction(()=>window.__game.online.remotes.size===1,undefined,{timeout:15000});
   await a.waitForFunction(()=>window.__game.online.isHost&&!window.__game.online.starting);await b.waitForFunction(()=>!window.__game.online.starting);
   if(await a.evaluate(()=>window.__game.online.world.phase!=='lobby')){await a.evaluate(()=>window.__game.online.finish());await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__game.state==='ended')));await Promise.all([a,b].map(p=>p.locator('#btn-again').click()));}
   await a.locator('#lobby-bots').selectOption('3');await a.locator('#lobby-limit').selectOption('10');await b.locator('#lobby-ready').click();await a.waitForFunction(()=>[...window.__game.online.peers.values()].some(p=>p.ready));await a.locator('#lobby-start').click();
   await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__game.state==='playing'&&window.__game.countdown<=0,undefined,{timeout:20000})));
   await a.evaluate(()=>{const g=window.__game;g.bots.frozen=true;for(const b of g.bots.bots){b.die();b.respawnT=1e9;}g.player.teleport(g.player.pos.clone().set(45,0,31));});
   await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(45,0,12));});
   await a.waitForFunction(()=>Math.abs([...window.__game.online.remotes.values()][0].pos.z-12)<.1);
   await a.keyboard.press('e');await a.waitForFunction(()=>window.__game.player.mounted);
   await a.keyboard.down('w');await a.keyboard.down('Shift');await a.waitForFunction(()=>window.__game.player.kills===1,undefined,{timeout:6000});await stop(a);
   await b.waitForFunction(()=>!window.__game.player.alive&&window.__game.player.deaths===1,undefined,{timeout:6000});
   assert((await a.locator('#center-msgs').textContent()).includes('ROADKILL'));assert((await b.locator('#killer-weapon').textContent()).includes('KESTREL ATV'));console.log('PASS host-driven roadkill synchronizes guest death and driver score');
   await a.keyboard.press('e');await a.waitForFunction(()=>!window.__game.player.mounted);await b.waitForFunction(()=>window.__game.player.alive,undefined,{timeout:12000});
   // Reset the parked vehicle on the authority, then board it as the guest through the normal seat protocol.
   await a.evaluate(()=>{const g=window.__game;g.vehicles.reset();g.player.teleport(g.player.pos.clone().set(60,0,20));g.bots.bots[0].spawnAt(g.player.pos.clone().set(45,0,26),0);});
   await b.waitForFunction(()=>Math.abs(window.__game.vehicles.list[0].pos.z-29)<.1&&!window.__game.vehicles.list[0].driver);
   await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(45,0,31));});await a.waitForFunction(()=>[...window.__game.online.remotes.values()][0].pos.distanceTo(window.__game.vehicles.list[0].pos)<4);
   await b.waitForTimeout(400);await b.keyboard.press('e');await b.waitForFunction(()=>window.__game.player.mounted,undefined,{timeout:5000});
   await b.keyboard.down('w');await a.waitForFunction(()=>window.__game.bots.bots[0].health<100,undefined,{timeout:5000});
   const wound=await a.evaluate(()=>window.__game.bots.bots[0].health);assert(wound>0);await b.waitForTimeout(1000);assert.equal(await a.evaluate(()=>window.__game.bots.bots[0].health),wound);await stop(b);console.log('PASS guest moderate impact wounds once through host collision validation',wound);
   await b.keyboard.press('e');await b.waitForFunction(()=>!window.__game.player.mounted);
   await a.evaluate(()=>{const g=window.__game;g.vehicles.reset();g.bots.bots[0].spawnAt(g.player.pos.clone().set(45,0,12),0);});
   await b.waitForFunction(()=>Math.abs(window.__game.vehicles.list[0].pos.z-29)<.1&&!window.__game.vehicles.list[0].driver);
   await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(45,0,31));});await a.waitForFunction(()=>[...window.__game.online.remotes.values()][0].pos.distanceTo(window.__game.vehicles.list[0].pos)<4);
   await b.waitForTimeout(400);await b.keyboard.press('e');await b.waitForFunction(()=>window.__game.player.mounted,undefined,{timeout:5000});
   await b.keyboard.down('w');await b.keyboard.down('Shift');await b.waitForFunction(()=>window.__game.player.kills===1,undefined,{timeout:7000});await stop(b);
   await a.waitForFunction(()=>!window.__game.bots.bots[0].alive&&[...window.__game.online.remotes.values()][0].kills===1);
   assert((await b.locator('#center-msgs').textContent()).includes('ROADKILL'));assert.equal(await b.evaluate(()=>window.__game.player.score),100);console.log('PASS guest-driven bot roadkill is validated and scored by the host');
   await b.keyboard.press('e');await b.waitForFunction(()=>!window.__game.player.mounted);
   await a.evaluate(()=>{const g=window.__game;g.vehicles.reset();g.player.teleport(g.player.pos.clone().set(45,0,12));});
   await b.waitForFunction(()=>Math.abs(window.__game.vehicles.list[0].pos.z-29)<.1&&!window.__game.vehicles.list[0].driver);
   await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(45,0,31));});await a.waitForFunction(()=>[...window.__game.online.remotes.values()][0].pos.distanceTo(window.__game.vehicles.list[0].pos)<4);
   await b.waitForTimeout(400);await b.keyboard.press('e');await b.waitForFunction(()=>window.__game.player.mounted,undefined,{timeout:5000});
   await b.keyboard.down('w');await b.keyboard.down('Shift');await b.waitForFunction(()=>window.__game.player.kills===2,undefined,{timeout:7000});await stop(b);
   assert.equal(await a.evaluate(()=>window.__game.player.alive),false);assert.equal(await a.evaluate(()=>window.__game.player.deaths),1);console.log('PASS guest-driven roadkill also defeats the host player');
   await a.evaluate(()=>window.__game.online.finish());await b.waitForFunction(()=>window.__game.state==='ended');await Promise.all([a,b].map(p=>p.evaluate(()=>window.__game.online.leave())));
 }else console.log('SKIP multiplayer: provide lobby keys through .env.local');
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS no browser errors');
}catch(e){console.error('FAIL',e);for(const context of contexts)for(const p of context.pages()){console.error('STATE',await p.evaluate(()=>{const g=window.__game;return{state:g?.state,player:{p:g?.player?.pos,alive:g?.player?.alive,kills:g?.player?.kills,health:g?.player?.health},vehicles:g?.vehicles?.snapshot(),bots:g?.bots?.bots.map(b=>({p:b.pos,health:b.health,alive:b.alive})),host:g?.online?.isHost};}).catch(()=>null));}console.error('ERRORS',errors);process.exitCode=1;
}finally{for(const c of contexts)await c.close();await browser.close();}
