import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:5181';
assert(new URL(base).hostname==='127.0.0.1','Run against local API so live games are not reset');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],errors=[];
async function boot(hash){const c=await browser.newContext({viewport:{width:1280,height:900}}),p=await c.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/?nolock&noao#'+hash);await p.waitForFunction(()=>window.__game?.state==='menu',{}, {timeout:60000});return p;}
async function create(name){const p=await boot('host');await p.locator('#callsign').fill(name);await p.locator('#invite-code').fill(process.env.LOBBY_HOST_PIN);await p.locator('#lobby-join').click();await p.waitForFunction(()=>window.__game.online.isHost&&window.__game.online.peers.size>0,{}, {timeout:30000});return p;}
try{
 let r=await fetch(base+'/api/lobby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',key:'000000',name:'WRONG'})});assert.equal(r.status,403);
 const a=await create('LOBBY HOST'),invite=await a.evaluate(()=>window.__game.online.inviteKey);
 const b=await boot('invite='+invite);await b.locator('#callsign').fill('LOBBY GUEST');await b.locator('#lobby-join').click();
 await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__game.online.remotes.size===1,{}, {timeout:30000})));
 assert(await b.locator('#lobby-start').isHidden());assert(await b.locator('#lobby-map').isDisabled());
 const denied=await b.evaluate(async()=>{const r=await fetch('/api/lobby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',access:window.__game.online.access})});return r.status;});assert.equal(denied,403);
 await a.locator('#lobby-bots').selectOption('3');await b.locator('#lobby-ready').click();await a.waitForFunction(()=>[...window.__game.online.peers.values()].some(p=>p.ready));await a.locator('#lobby-start').click();
 await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__game.state==='playing'&&window.__game.countdown<=0,{}, {timeout:45000})));
 await a.evaluate(()=>window.__game.bots.frozen=true);
 await b.waitForFunction(()=>window.__game.bots.bots.slice(0,3).every(b=>b.alive&&b.model.visible)&&window.__game.online.world.seq>5);
 const ping=await b.evaluate(async()=>{const o=window.__game.online;let seen=0;const receive=o.receive.bind(o);o.receive=(from,data)=>{if(data.kind==='world')seen++;receive(from,data);};await new Promise(r=>setTimeout(r,800));return seen;});assert(ping>3,'Live wire messages must flow, not only presence snapshots');
 console.log('PASS code creates lobby, invite joins, only creator can start, shared live match and visible bots');
 await a.evaluate(()=>window.__game.online.leave());await b.waitForFunction(()=>window.__game.online.peers.size===1);assert.equal(await b.evaluate(()=>window.__game.online.isHost),false);assert(await b.locator('#lobby-start').isHidden());
 const c=await create('NEW HOST');await b.waitForFunction(()=>!window.__game.online.connected,{}, {timeout:15000});assert.match(await b.locator('#lobby-status').innerText(),/ended/);
 r=await fetch(base+'/api/lobby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'join',key:invite,name:'EXPIRED'})});assert.equal(r.status,403);
 await c.locator('#lobby-end').click();await c.waitForFunction(()=>!window.__game.online.connected);
 assert.deepEqual(errors,[]);console.log('PASS no guest host takeover, new lobby ends previous lobby, old invite revoked, explicit end and zero browser errors');
}catch(e){console.error(e);for(const p of pages)console.log(await p.evaluate(()=>({status:document.querySelector('#lobby-status')?.textContent,connected:window.__game?.online.connected,phase:window.__game?.online.world.phase,peers:window.__game?.online.peers.size,verified:window.__game?.online.verifiedPeers.size})).catch(()=>null));process.exitCode=1;}
finally{for(const p of pages)await p.context().close();await browser.close();}
