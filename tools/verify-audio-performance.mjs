import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:5180';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage(),cdp=await page.context().newCDPSession(page),nodes=new Map(),errors=[];
page.on('pageerror',e=>errors.push(e.message));cdp.on('WebAudio.audioNodeCreated',({node})=>nodes.set(node.nodeId,node.nodeType));cdp.on('WebAudio.audioNodeWillBeDestroyed',({nodeId})=>nodes.delete(nodeId));await cdp.send('WebAudio.enable');
try {
  // Test the actual audio code without requiring a rendered arena or production credentials.
  await page.route('**/audio-harness',r=>r.fulfill({contentType:'text/html',body:'<html><body>Audio regression</body></html>'}));
  await page.goto(base+'/audio-harness');
  await page.evaluate(async()=>{const {AudioManager}=await import('/src/game/Audio.ts');window.audio=new AudioManager();await audio.ctx.resume();await audio.load(Object.fromEntries(['shot_ar_far','shot_bolt3_far','shot_pistol_far','ar_1','imp_metal_1'].map(n=>[n,'/sounds/'+n+'.mp3'])));});
  const clips=await page.evaluate(()=>[...audio.buffers].filter(([n])=>n.startsWith('shot_')).map(([name,b])=>({name,duration:b.duration,attack:Math.max(...b.getChannelData(0).slice(0,b.sampleRate*.1).map(Math.abs))})));
  assert.equal(clips.length,3);assert(clips.every(c=>c.duration<=1.651&&c.attack>.01));console.log('PASS distant gun recordings start promptly and contain one short report',clips);
  const persistent=nodes.size;
  const burst=await page.evaluate(()=>{const pos=audio.listenerPos.clone().set(5,0,0);let peak=0,spatial=0;for(let i=0;i<300;i++){audio.play3D('shot_ar_far',pos,{ref:6,reverb:.5});audio.play('ar_1',{bus:'gun'});audio.hitmarker();peak=Math.max(peak,audio.voices.size);spatial=Math.max(spatial,[...audio.voices.values()].filter(v=>v.spatial).length);}window.callback=false;const cue=audio.play('ar_1',{bus:'ui'});if(cue)cue.onended=()=>window.callback=true;return{peak,spatial,cue:!!cue,outOfRange:audio.play3D('shot_ar_far',pos.set(300,0,0),{max:60})===null};});
  assert(burst.peak<=64&&burst.spatial<=24&&burst.cue&&burst.outOfRange);console.log('PASS combat audio remains bounded and important cues survive overload',burst);
  await page.waitForFunction(()=>audio.voices.size===0&&window.callback,{}, {timeout:8000});await cdp.send('HeapProfiler.collectGarbage');assert(nodes.size<=persistent+2);console.log('PASS ended sounds disconnect and are collected; caller onended still runs');
  await page.evaluate(()=>{audio.buffers.clear();const p=audio.listenerPos.clone().set(3,0,0);for(let i=0;i<12;i++){audio.whizz();audio.ricochet(p);audio.impact(p,true);audio.bodyHit(p);audio.grenadeBounce(p,1);audio.explosion(p,20);}audio.jetFlyby();});
  await page.waitForFunction(()=>audio.voices.size===0,{}, {timeout:8000});await cdp.send('HeapProfiler.collectGarbage');assert(nodes.size<=persistent+2);console.log('PASS synthesized fallback sounds also release their audio graph');
  await page.evaluate(()=>audio.ctx.close());
  // Feed known silence and sound through the actual capture worklet and fallback encoder.
  await page.evaluate(async()=>{const {VoiceChat}=await import('/src/game/VoiceChat.ts');const ctx=new AudioContext({sampleRate:16000});await ctx.resume();const o=ctx.createOscillator(),gain=ctx.createGain(),dest=ctx.createMediaStreamDestination();gain.gain.value=0;o.connect(gain);gain.connect(dest);o.start();navigator.mediaDevices.getUserMedia=async()=>dest.stream;window.voiceSource={ctx,gain};window.packets=[];window.changes=0;window.voice=new VoiceChat('a',[],msg=>{if(msg.kind==='voice-audio')packets.push({at:performance.now(),size:msg.audio.length});});voice.onChange=()=>window.changes++;await voice.sync(['a','z']);await voice.toggle();for(const peer of voice.peers.values())peer.pc.close();await voice.sync(['a','z']);});
  await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>packets.length),0);console.log('PASS silent microphones send no fallback packets');
  await page.evaluate(()=>voiceSource.gain.gain.value=.1);await page.waitForFunction(()=>packets.length>=5);assert(await page.evaluate(()=>packets.every(p=>p.size===2732)));console.log('PASS speech produces decodable fallback frames');
  await page.evaluate(()=>{packets=[];const end=performance.now()+1400;while(performance.now()<end){}});await page.waitForTimeout(400);assert(await page.evaluate(()=>packets.every((p,i)=>!i||p.at-packets[i-1].at>=90)));console.log('PASS a stalled main thread cannot burst stale voice packets');
  await page.evaluate(()=>{voice.setPTT(true);window.changes=0;packets=[];});await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>packets.length),0);
  await page.keyboard.down('v');await page.keyboard.down('v');await page.keyboard.down('v');assert.equal(await page.evaluate(()=>changes),1);await page.waitForFunction(()=>packets.length>=2);await page.keyboard.up('v');assert.equal(await page.evaluate(()=>voice.talking),false);console.log('PASS push-to-talk gates capture and key repeat does not republish presence');
  await page.evaluate(()=>{voice.destroy();voiceSource.ctx.close();});assert.deepEqual(errors,[]);console.log('PASS no browser errors');
} finally {await browser.close();}
