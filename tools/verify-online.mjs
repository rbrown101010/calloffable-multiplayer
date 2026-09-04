import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.TEST_URL||'http://127.0.0.1:5178';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const errors=[];const clients=[];
try{
 const denied=await fetch(base+'/api/lobby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'wrong',name:'TEST'})});assert.equal(denied.status,403);console.log('PASS unauthenticated lobby join denied');
 for(const [name,key]of [['TEST ALPHA',process.env.LOBBY_HOST_KEY],['TEST BRAVO',process.env.LOBBY_INVITE_KEY]]){
  const context=await browser.newContext({viewport:{width:1280,height:800},permissions:['microphone']});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?nolock&noao');await page.waitForFunction(()=>window.__game?.state==='menu',undefined,{timeout:60000});
  await page.getByRole('button',{name:'PRIVATE MULTIPLAYER'}).click();await page.locator('#callsign').fill(name);await page.locator('#invite-code').fill(key);await page.locator('#lobby-join').click();
  await page.waitForFunction(()=>window.__game.online.connected&&window.__game.online.peers.size>0,undefined,{timeout:20000});clients.push({context,page});
 }
 const [a,b]=clients.map(c=>c.page);
 await a.waitForFunction(()=>window.__game.online.peers.size===2&&window.__game.online.remotes.size===1,undefined,{timeout:20000});await b.waitForFunction(()=>window.__game.online.peers.size===2&&window.__game.online.remotes.size===1,undefined,{timeout:20000});
 console.log('PASS two independent users joined one InstantDB lobby');
 // Presence from a just-closed verification run can briefly retain its match snapshot.
 await a.waitForFunction(()=>window.__game.online.isHost&&!window.__game.online.starting);
 await b.waitForFunction(()=>!window.__game.online.starting);
 if(await a.evaluate(()=>window.__game.online.world.phase!=='lobby')){
  await a.evaluate(()=>window.__game.online.finish());
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__game.state==='ended')));
  await Promise.all([a,b].map(p=>p.locator('#btn-again').click()));
 }
 await a.locator('#lobby-bots').selectOption('0');await a.locator('#lobby-limit').selectOption('10');await b.locator('#lobby-ready').click();await a.waitForFunction(()=>[...window.__game.online.peers.values()].some(p=>p.name==='TEST BRAVO'&&p.ready));await a.locator('#lobby-start').click();
 await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__game.state==='playing'&&window.__game.countdown<=0,undefined,{timeout:20000})));
 console.log('PASS shared countdown and match start');
 await a.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(50,0,24));g.player.yaw=-Math.PI/2;g.player.pitch=0;});
 await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(58,0,24));g.player.yaw=Math.PI/2;g.player.pitch=0;});
 await a.waitForFunction(()=>[...window.__game.online.remotes.values()][0].pos.x>57,undefined,{timeout:10000});
 console.log('PASS player positions replicated');
 await b.keyboard.press('c');await a.waitForFunction(()=>[...window.__game.online.remotes.values()][0].crouch,undefined,{timeout:10000});await b.keyboard.press('c');
 console.log('PASS crouch stance replicated');
 // Seats are host-granted; both local driving directions must replicate.
 await a.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(45,0,31));});
 await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(46,0,31));});
 await a.keyboard.press('e');await a.waitForFunction(()=>window.__game.player.mounted);
 await b.waitForFunction(()=>window.__game.vehicles.list[0].driver===window.__game.online.hostId);
 await b.evaluate(()=>window.__game.online.vehicleAction(0,'enter'));await b.waitForTimeout(500);
 assert.equal(await b.evaluate(()=>window.__game.player.mounted),false);
 console.log('PASS shared ATV has one exclusive driver seat');
 const oldZ=await a.evaluate(()=>window.__game.vehicles.current.pos.z);
 await a.keyboard.down('w');await a.waitForTimeout(1700);await a.keyboard.up('w');await a.keyboard.down('Space');await a.waitForTimeout(800);await a.keyboard.up('Space');
 await b.waitForFunction(z=>window.__game.vehicles.list[0].pos.z<z-10,oldZ);
 const az=await a.evaluate(()=>window.__game.vehicles.list[0].pos.z),bz=await b.evaluate(()=>window.__game.vehicles.list[0].pos.z);assert(Math.abs(az-bz)<2);
 console.log('PASS host ATV movement replicated to guest');
 await a.keyboard.press('e');await a.waitForFunction(()=>!window.__game.player.mounted);await b.waitForFunction(()=>!window.__game.vehicles.list[0].driver);
 await b.evaluate(()=>{const g=window.__game,v=g.vehicles.list[0];g.player.teleport(v.pos.clone().add({x:2.4,y:-.69,z:0}));});
 await a.waitForFunction(()=>{const g=window.__game,b=[...g.online.remotes.values()][0];return b.pos.distanceTo(g.vehicles.list[0].pos)<4;});
 await b.keyboard.press('e');await b.waitForFunction(()=>window.__game.player.mounted);
 const guestZ=await b.evaluate(()=>window.__game.vehicles.current.pos.z);await b.keyboard.down('w');await b.waitForTimeout(1500);await b.keyboard.up('w');await b.keyboard.down('Space');await b.waitForTimeout(700);await b.keyboard.up('Space');
 await a.waitForFunction(z=>window.__game.vehicles.list[0].pos.z<z-8,guestZ);
 const zA=await a.evaluate(()=>window.__game.vehicles.list[0].pos.z),zB=await b.evaluate(()=>window.__game.vehicles.list[0].pos.z);assert(Math.abs(zA-zB)<2);
 console.log('PASS guest ATV prediction and host relay agree');
 await b.keyboard.press('e');await b.waitForFunction(()=>!window.__game.player.mounted);
 await a.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(50,0,24));g.player.yaw=-Math.PI/2;g.player.pitch=0;});
 await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(58,0,24));g.player.yaw=Math.PI/2;g.player.pitch=0;});
 await a.waitForFunction(()=>[...window.__game.online.remotes.values()][0].pos.x>57);

 await a.evaluate(()=>{window.__game.player.pitch=-.005;});await a.mouse.down();
 await a.waitForFunction(()=>window.__game.player.kills>=1,undefined,{timeout:15000});await a.mouse.up();
 await b.waitForFunction(()=>window.__game.player.deaths>=1,undefined,{timeout:10000});
 console.log('PASS actual fired bullets kill remote player and synchronize score');
 await b.waitForFunction(()=>window.__game.player.alive,undefined,{timeout:12000});console.log('PASS authoritative respawn');
 await Promise.all([a,b].map(p=>p.evaluate(()=>window.__game.online.mic.toggle())));
 await a.waitForFunction(()=>[...window.__game.online.mic.peers.values()].some(p=>p.pc.connectionState==='connected'),undefined,{timeout:20000});
 let audio=[];
 for(let attempt=0;attempt<50;attempt++){
  audio=await Promise.all([a,b].map(page=>page.evaluate(async()=>{const v=window.__game.online.mic;return{enabled:v.enabled,talking:v.talking,ctx:v.audioContext?.state,peers:await Promise.all([...v.peers.values()].map(async p=>({state:p.pc.connectionState,trans:p.pc.getTransceivers().map(t=>({direction:t.direction,current:t.currentDirection,track:!!t.sender.track})),audio:[...(await p.pc.getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='audio').map(s=>({bytes:s.bytesReceived,packets:s.packetsReceived,energy:s.totalAudioEnergy}))})))}})));
  if(audio.every(v=>v.peers.some(p=>p.audio.some(s=>s.bytes>0&&s.packets>10))))break;
  await a.waitForTimeout(200);
 }
 console.log('VOICE DIAGNOSTICS',JSON.stringify(audio));assert(audio.every(v=>v.peers.some(p=>p.audio.some(s=>s.bytes>0&&s.packets>10))));console.log('PASS two-way WebRTC voice received audio packets');
 await Promise.all([a,b].map(p=>p.evaluate(()=>{for(const peer of window.__game.online.mic.peers.values())peer.pc.close();})));
 await a.waitForFunction(()=>window.__game.online.mic.fallbackFrames>=3,undefined,{timeout:15000});await b.waitForFunction(()=>window.__game.online.mic.fallbackFrames>=3,undefined,{timeout:15000});console.log('PASS voice radio fallback received and scheduled on both clients when WebRTC is blocked');
 await b.evaluate(()=>window.__game.online.mic.setPTT(true));assert.equal(await b.evaluate(()=>window.__game.online.mic.talking),false);await b.keyboard.down('v');assert.equal(await b.evaluate(()=>window.__game.online.mic.talking),true);await b.keyboard.up('v');assert.equal(await b.evaluate(()=>window.__game.online.mic.talking),false);console.log('PASS push-to-talk gates microphone tracks');
 await a.evaluate(()=>window.__game.online.finish());await b.waitForFunction(()=>window.__game.state==='ended');
 await a.locator('#btn-again').click();await a.locator('#lobby-bots').selectOption('3');await a.locator('#lobby-start').click();await b.waitForFunction(()=>window.__game.state==='playing');
 console.log('PASS shared results and rematch');

 await b.waitForFunction(()=>window.__game.countdown<=0);
 await b.evaluate(()=>{const g=window.__game;g.player.teleport(g.player.pos.clone().set(45,0,31));});
 await a.waitForFunction(()=>{const g=window.__game,b=[...g.online.remotes.values()][0];return b.pos.distanceTo(g.vehicles.list[0].pos)<4;});
 await b.keyboard.press('e');await b.waitForFunction(()=>window.__game.player.mounted);
 await a.evaluate(()=>window.__game.online.leave());await b.waitForFunction(()=>window.__game.online.isHost&&window.__game.bots.bots.filter(b=>b.alive).length===3,undefined,{timeout:20000});console.log('PASS host handoff and bot simulation survive the original host leaving');
 assert(await b.evaluate(()=>window.__game.player.mounted&&window.__game.vehicles.current.driver===window.__game.online.id));
 const handoffZ=await b.evaluate(()=>window.__game.vehicles.current.pos.z);await b.keyboard.down('w');await b.waitForTimeout(1200);await b.keyboard.up('w');assert((await b.evaluate(()=>window.__game.vehicles.current.pos.z))<handoffZ-5);console.log('PASS occupied ATV survives host handoff and keeps driving');

 console.log('ERRORS',JSON.stringify(errors));assert.equal(errors.length,0);
 await mkdir('output/playwright',{recursive:true});await a.screenshot({path:'output/playwright/online-host.png'});await b.screenshot({path:'output/playwright/online-guest.png'});
 await b.evaluate(()=>window.__game.online.finish());await b.evaluate(()=>window.__game.online.leave());
} catch(e){console.error('FAIL',e);for(let i=0;i<clients.length;i++){console.log('CLIENT',i,await clients[i].page.evaluate(()=>{const g=window.__game;return{state:g?.state,countdown:g?.countdown,time:g?.time,online:g?.online&&{connected:g.online.connected,id:g.online.id,host:g.online.hostId,world:g.online.world,peers:[...g.online.peers.values()].map(p=>({id:p.id,name:p.name,ready:p.ready})),remotes:[...g.online.remotes.values()].map(b=>({name:b.name,pos:b.pos,health:b.health,alive:b.alive}))},player:g?.player&&{pos:g.player.pos,kills:g.player.kills,deaths:g.player.deaths,health:g.player.health,alive:g.player.alive},status:document.getElementById('lobby-status')?.textContent}}));}console.error('ERRORS',errors);process.exitCode=1;
}finally{for(const c of clients)await c.context.close();await browser.close();}
