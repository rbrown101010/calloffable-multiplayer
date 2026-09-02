// Regenerate voice lines whose raw TTS output came back silent, trying alternate voices.
import { generateSpeech } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { writeFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
const TMP = '/private/tmp/claude-501/-Users-rileybrown-newone/03af17cf-159d-4c3d-90da-0f1933f23e88/scratchpad/tts/raw';
const speechModel = (gateway.speech ?? gateway.speechModel).bind(gateway);
const LINES = { vo_op_reload: 'Reloading!', vo_op_frag: 'Frag out!', vo_op_enemy_down: 'Enemy down.', vo_op_tango_down: 'Tango down.', vo_op_hit: "I'm hit!", vo_op_grenade: 'Grenade!', vo_op_contact: 'Contact!', vo_bot1_contact: 'Contact!', vo_bot1_spotted: 'Enemy spotted!', vo_bot1_taking_fire: 'Taking fire!', vo_bot1_reloading: 'Reloading!', vo_bot1_frag: 'Frag out!', vo_bot1_got_one: 'Got one!', vo_bot1_man_down: "I'm hit!", vo_bot1_moving: 'Moving up!', vo_bot2_contact: 'Contact!', vo_bot2_spotted: 'Enemy spotted!', vo_bot2_taking_fire: 'Taking fire!', vo_bot2_reloading: 'Reloading!', vo_bot2_frag: 'Frag out!', vo_bot2_got_one: 'Got one!', vo_bot2_man_down: "I'm hit!", vo_bot2_moving: 'Moving up!', vo_ann_ffa: 'Free for all.', vo_ann_one_minute: 'One minute remaining.', vo_ann_thirty: 'Thirty seconds remaining.', vo_ann_match_point: 'Match point.', vo_ann_victory: 'Victory.', vo_ann_defeat: 'Defeat.', vo_ann_match_over: 'Match over.', vo_ann_uav_ready: 'U A V ready.', vo_ann_airstrike_ready: 'Airstrike ready.', vo_ann_uav_online: 'U A V online.', vo_ann_uav_offline: 'U A V offline.', vo_ann_airstrike_inbound: 'Airstrike inbound.', vo_ann_double_kill: 'Double kill.', vo_ann_triple_kill: 'Triple kill.', vo_ann_multi_kill: 'Multi kill.', vo_ann_taking_lead: "You've taken the lead.", vo_ann_lost_lead: "You've lost the lead." };
const peak = (p) => { const r = spawnSync('ffmpeg', ['-i', p, '-af', 'astats=measure_overall=Peak_level:measure_perchannel=none', '-f', 'null', '-'], { encoding: 'utf8' }); const m = (r.stderr || '').match(/Peak level dB:\s*(-?[\d.]+)/); return m ? parseFloat(m[1]) : -120; };
const voicesFor = (name) => name.startsWith('vo_op') ? ['ballad', 'verse', 'onyx'] : name.startsWith('vo_bot1') ? ['echo', 'sage', 'onyx'] : name.startsWith('vo_bot2') ? ['fable', 'alloy', 'onyx'] : ['onyx', 'echo'];
let fixed = 0;
for (const f of readdirSync(TMP)) {
  if (!f.endsWith('.mp3')) continue; const name = f.slice(0, -4); const p = `${TMP}/${f}`;
  if (peak(p) > -30) continue;
  const text = LINES[name]; if (!text) continue;
  let ok = false;
  for (const voice of voicesFor(name)) {
    try {
      const res = await generateSpeech({ model: speechModel('openai/tts-1-hd'), text: text.replace('!', '!!'), voice, outputFormat: 'mp3', speed: 1.05 });
      writeFileSync(p, Buffer.from(res.audio.uint8Array));
      const pk = peak(p); console.log(name, voice, 'peak', pk.toFixed(1));
      if (pk > -30) { ok = true; break; }
    } catch (e) { console.log('FAIL', name, voice, String(e.message || e).slice(0, 120)); }
  }
  if (ok) fixed++;
}
console.log('fixed', fixed);
