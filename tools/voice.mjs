// Generate CoD-style announcer / operator / enemy voice lines through Vercel AI Gateway (OpenAI TTS-1 HD) and
// post-process them with ffmpeg (trim, normalize, radio band-limit for operators). Requires AI_GATEWAY_API_KEY in env.
import { generateSpeech } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
const OUT = 'public/sounds'; const TMP = '/private/tmp/claude-501/-Users-rileybrown-newone/03af17cf-159d-4c3d-90da-0f1933f23e88/scratchpad/tts/raw'; mkdirSync(TMP, { recursive: true });
const MODEL = process.env.VO_MODEL || 'openai/tts-1-hd';
const speechModel = (gateway.speech ?? gateway.speechModel).bind(gateway);
const ANN = { ffa: 'Free for all.', one_minute: 'One minute remaining.', thirty: 'Thirty seconds remaining.', match_point: 'Match point.', victory: 'Victory.', defeat: 'Defeat.', match_over: 'Match over.', uav_ready: 'U A V ready.', airstrike_ready: 'Airstrike ready.', uav_online: 'U A V online.', uav_offline: 'U A V offline.', airstrike_inbound: 'Airstrike inbound.', double_kill: 'Double kill.', triple_kill: 'Triple kill.', multi_kill: 'Multi kill.', taking_lead: "You've taken the lead.", lost_lead: "You've lost the lead." };
const OP = { reload: 'Reloading, cover me!', frag: 'Frag out!', enemy_down: 'Enemy down.', tango_down: 'Tango down.', hit: "I'm hit, I'm hit!", grenade: 'Grenade! Get down!', contact: 'Contact, contact!' };
const BOT = { contact: 'Contact, contact!', spotted: 'Enemy spotted!', taking_fire: 'Taking fire, taking fire!', reloading: 'Reloading, cover me!', frag: 'Frag out!', got_one: 'Got one, tango down!', man_down: "I'm hit, I'm hit!", moving: 'Moving up, moving up!' };
const SETS = [
  { prefix: 'vo_ann', lines: ANN, voice: 'onyx', speed: 0.98, radio: false },
  { prefix: 'vo_op', lines: OP, voice: 'echo', speed: 1.1, radio: true },
  { prefix: 'vo_bot1', lines: BOT, voice: 'fable', speed: 1.1, radio: true },
  { prefix: 'vo_bot2', lines: BOT, voice: 'alloy', speed: 1.12, radio: true },
];
const made = [];
for (const set of SETS) {
  for (const [key, text] of Object.entries(set.lines)) {
    const name = `${set.prefix}_${key}`; const raw = `${TMP}/${name}.mp3`; const out = `${OUT}/${name}.mp3`;
    if (!existsSync(raw) || (process.env.VO_REGEN && name.startsWith(process.env.VO_REGEN))) {
      try {
        const res = await generateSpeech({ model: speechModel(MODEL), text, voice: set.voice, outputFormat: 'mp3', speed: set.speed });
        writeFileSync(raw, Buffer.from(res.audio.uint8Array));
      } catch (e) { console.log('FAIL', name, String(e.message || e).slice(0, 200)); continue; }
    }
    const filters = ['silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03', 'areverse', 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08', 'areverse'];
    if (set.radio) filters.push('highpass=f=280', 'lowpass=f=3800', 'acompressor=threshold=-18dB:ratio=4:attack=5:release=80:makeup=4dB', 'volume=0.9');
    else filters.push('acompressor=threshold=-16dB:ratio=3:attack=8:release=120:makeup=3dB');
    filters.push('alimiter=limit=0.95:attack=1:release=40:level=false', 'apad=pad_dur=0.12');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', filters.join(','), '-ar', '48000', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '112k', out]);
    made.push(name); process.stdout.write('.');
  }
}
const mf = `${OUT}/manifest.json`; const cur = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : [];
writeFileSync(mf, JSON.stringify([...new Set([...cur, ...made])].sort()));
console.log(`\nvoice lines: ${made.length}`);
