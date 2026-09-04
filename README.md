# Modern Singularity 2

[Play Modern Singularity 2](https://modern-singularity-2.vercel.app)

A browser FPS with a 240 × 240 m desert refinery, ten loadouts, seven tactical AI operators, and one invite-only multiplayer lobby for up to eight people.

## Play

- **Deploy solo:** choose Sable Reach or the original Rust map, a loadout, difficulty, and score limit.
- **Private multiplayer:** open an invite link, enter a callsign, and join. Choose your class inside the lobby, then ready up; the first player hosts and starts the match. Bot fill keeps empty slots active.
- **Change class in a match:** press **L** or use **Escape → Change Loadout**. The selected class equips on your next respawn, with both weapons, full ammo and grenades. Your lobby, score and match stay intact.
- **Return or leave:** closing the lobby during a match returns to the game. Only **Leave lobby** disconnects you. Multiplayer continues while menus are open.
- **Voice:** microphone off by default. Enable it in the lobby or pause overlay. Optional push-to-talk uses **V**. Click a player's mic indicator to mute them locally.
- The lobby owner can copy the invite link. Share that link only with the people you want in the session.

Sable Reach has six areas: refinery, tank farm, freight terminal, command compound, extraction yard, and the quarry ridgeline. Roofs, stairs, a bridge, towers, interior rooms, container lanes, and cover clusters connect them. The playable area is 6.25 times the original 96 × 96 m arena. Photograph-based PBR materials, a sunset HDR environment, and scanned rocks, military crates, and generators provide surface detail.

Operators flank, hold angles, rush, change ranges, crouch under pressure, retreat to reload, and avoid live grenades. Weapon-space two-bone arm IK keeps both hands on their grips through movement and crouching; wrists and fingers use a firing grip. Helmet, headset, radio, pouch, and uniform variants distinguish the operators.

## Quarry Run update

- Six Kestrel ATVs: WASD driving, steering, reverse, Space handbrake, Shift boost, mouse orbit camera, E enter/exit. Wheel suspension follows slopes and ramps launch the vehicle into the air. Single driver per ATV; abandoned vehicles return to their parking spots. Driver poses and vehicle locations are shared in multiplayer, including host handoff.
- Run over enemies: impact damage scales with speed, with full-health roadkills at 45 km/h. Parking-speed bumps are harmless, slower collisions wound, and lethal hits let the ATV keep moving. Roadkills award the driver 100 points and count toward killstreaks in solo and multiplayer.
- A two-floor relay station with a roof, a 64 m upper catwalk, freight overlook, drive-through overpass, five ramps, culvert shelters, 6.5 m and 4.8 m ridges, and a 3.4 m excavated quarry. New navigation links let AI reach upper routes.
- Four medical stations, four ammunition stations, and three reusable jump pads. Supplies respawn after 22 seconds and use shared cooldowns in multiplayer.
- ADS camera and weapon idle drift removed; raw mouse deltas, pointer recapture, FOV-matched sensitivity, and a separate ADS sensitivity slider. Recoil springs use small simulation steps to stay stable during a slow frame.
- Auto graphics caps the internal pixel count and adapts resolution when frames slow down. Shadows use 2048 px at 30 Hz, minimap refresh is 10 Hz, and solo killcam recording is 20 Hz (disabled in multiplayer). Vehicle parts are batched; wrist/leg rig lookups reuse cached data. Full-resolution rendering remains an option under Escape > Graphics.

## Loadouts

| Class | Primary | Secondary |
|---|---|---|
| Assault | SCAR-H | Desert Eagle |
| Sniper | Intervention | M1911 |
| Rusher | MP5 | Desert Eagle |
| Overkill | AK-47 | SPAS-12 |
| Marksman | SCAR Scout | M1911 |
| Breacher | SPAS-12 | MP5 |
| Support | AK Support | M1911 |
| Recon | MP5 Recon | M1911 |
| Hunter | Intervention | SPAS-12 |
| Vanguard | SCAR-H | MP5 Recon |

## Controls

| Input | Action |
|---|---|
| WASD | Move / drive |
| E near an ATV | Enter / exit |
| Space while driving | Handbrake |
| Shift while driving | Boost |
| Shift | Sprint / steady scoped aim |
| Space | Jump / leave ladder |
| C or Ctrl | Crouch; sprint then crouch to slide |
| Left mouse / F | Fire |
| Right mouse / Alt | Aim |
| E | Toggle aim |
| R | Reload |
| 1 / 2 / Q / wheel | Switch weapon |
| G | Cook and throw frag |
| 3 / 4 | UAV / airstrike when earned |
| V | Push-to-talk, when selected |
| L | Choose class for your next respawn |
| Tab | Scoreboard |
| Esc | Pause / settings / multiplayer controls |

In the loadout menu, keys **1–9, 0** select the ten classes. Trackpad mode supports **F** to fire and **E** to aim when away from an available ATV. Desktop keyboard and mouse recommended; no touch controls are implemented.

## Development

```sh
npm ci
cp .env.example .env.local
# Fill in server credentials for private multiplayer. Solo needs no credentials.
npm run dev
```

Open `http://127.0.0.1:5178`. `npm run build` type-checks and builds the site. The dev server includes `/api/lobby`; production uses a Vercel serverless function. `npm run preview` serves the static build only and does not emulate that API.

- Stack: TypeScript, Vite, Three.js, Rapier, InstantDB, WebRTC and Web Audio.
- `api/lobby.mjs`: server-side invite check and scoped user token issuance.
- `src/game/Online.ts`: presence, lobby, match authority, replication, host transfer.
- `src/game/VoiceChat.ts`: opt-in voice, mute/PTT, signaling and radio fallback.
- `src/game/SableMap.ts`: deterministic map layout and navigation.
- `src/game/Puppet.ts`: animated operators and weapon grip IK.
- `public/CREDITS.md`: retained asset attribution plus new CC0 scenery sources.

Read [MULTIPLAYER.md](MULTIPLAYER.md) for deployment, session authority, and operating limits. Server secrets must never use a `VITE_` prefix.

## Verification

Start a test server in a separate terminal with `PLAYWRIGHT_TEST=1 npm run dev -- --port 5180`, then run:

```sh
export TEST_URL=http://127.0.0.1:5180
node --env-file=.env.local tools/verify-online.mjs
# Against a deployed build:
TEST_URL=https://your-site.vercel.app node --env-file=.env.local tools/verify-online.mjs
node tools/verify-operators.mjs
node tools/verify-expansion.mjs
node --env-file=.env.local tools/verify-roadkills.mjs
WIDTH=2560 HEIGHT=1440 DPR=2 node tools/benchmark.mjs
```

The multiplayer check uses two isolated Chrome contexts with fake microphone audio. It exercises invite rejection, joining, start, pose/crouch replication, exclusive vehicle seats, host and guest driving, occupied-vehicle host transfer, real bullet damage, respawn, voice packets, forced direct-media failure and radio fallback, push-to-talk, results, rematches, and host transfer. It is not an eight-device load test or a listening test of physical microphones.

`verify-expansion.mjs` exercises real pointer capture/re-entry, stationary aiming, steering/boost/braking, a ramp jump and landing, dismount, supplies, and launch pads. `benchmark.mjs` samples actual browser frame and CPU timings with seven bots. Set `TEST_URL` to select the server (inspection tools use port 5180 by default).

`verify-roadkills.mjs` drives real vehicle collisions against controlled targets: harmless bumps, nonlethal impacts, separation before repeat damage, two consecutive roadkills, reverse, near misses, height separation, and wall protection. With lobby keys it also verifies host-to-guest, guest-to-bot, and guest-to-host kills and shared scoring through InstantDB.

`tools/puppet-preview.html` is a local inspection stage. Operator verification checks both hands against each weapon grip in standing/crouched and raised/lowered aim poses. Debug URL flags include `?noao`, `?botfreeze`, `?passive`, `?ghost`, and `?nolock` for local inspection.

Code is MIT. Third-party assets retain their individual licenses. The retained Rust map is a fan tribute; Call of Duty and Rust are trademarks of Activision.

## Multiplayer verification

`npm run test:multiplayer-flow` checks fresh invitation entry, all ten classes, active versus queued equipment, duplicate spawn protection, guest shooting, death during class selection, visible bots and humans, late joining, rematches and host transfer across three browser contexts. `node --env-file=.env.local tools/verify-lobby-capacity.mjs` checks eight actual game clients and rejects a ninth.

`npm run test:online` exercises live bullets, score, respawn, driving and two-way voice. Multiplayer browser tests use an isolated ephemeral room suffix, so they do not join the players' lobby. Set `TEST_URL` to verify the deployed build.
