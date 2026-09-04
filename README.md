# Modern Singularity 2

[Play Modern Singularity 2](https://modern-singularity-2.vercel.app)

A browser FPS with a 240 × 240 m desert refinery, ten loadouts, seven tactical AI operators, and one invite-only multiplayer lobby for up to 16 people.

## Play

- **Deploy solo:** choose Sable Reach or the original Rust map, a loadout, difficulty, and score limit.
- **Private multiplayer:** open an invite link, enter a callsign, and join. Choose your class inside the lobby, then ready up. The first player hosts, selects **Match map → Rust — Small** or **Sable Reach — Large**, and starts the match. Everyone loads the selected map automatically. Bot fill keeps empty slots active.
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
- Auto graphics caps the internal pixel count and adapts resolution when frames slow down. Shadows use 2048 px at 30 Hz, minimap refresh is 10 Hz, and the legacy solo final-kill recorder is 20 Hz; multiplayer uses a separate capped 10 Hz death-replay buffer. Vehicle parts are batched; wrist/leg rig lookups reuse cached data. Full-resolution rendering remains an option under Escape > Graphics.

## Local combat update

- Skippable death replays in solo and multiplayer, including the match-ending death. Enter, Space or click skips; L opens the class picker during a match. The host keeps simulating while watching. Replays use recent locally observed poses, not server video recordings.
- Class cards show both actual weapon models. Automatic rifles and SMGs have a red-dot optic, steadier recoil and faster accuracy recovery. The complete AK model replaces the old asset, which contained only a grip. Intervention damage is 82 to the body and 123 to the head; a full-health body hit is no longer lethal.
- Visible gloved frag windup, release and follow-through; the grenade leaves the hand at 0.24 seconds and the weapon returns after 0.72 seconds.
- Three kills earn a UAV. Five earn a random airstrike, advanced UAV or resupply. Nine earn a 25-second chopper gunner. Use 3, 4 and 5. Earned unused rewards survive death; the streak counter resets. The chopper leaves your operator vulnerable and ends if they die. Two aircraft can be active at once.
- The host chooses a limit from 2–16 players and can kick other operators from the roster. Lowering the limit never silently ejects existing players. Kicked identities remain excluded for the current lobby, including rematches and host transfer; clearing browser identity creates a new identity.
- Sable Reach adds four windowed, enterable outposts with stairs and roof cover, twelve road-side cover positions, and safer ladder landing decks on the refinery columns. Rust retains its compact layout.
- Four Raven motorcycles join the six ATVs on Sable. Bikes reach 108 km/h normally and about 137 km/h with boost; ATVs reach about 68 / 94 km/h. The same exclusive-seat, collision, roadkill and host-validation rules apply.

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
| E near a vehicle | Enter / exit |
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
| 3 / 4 / 5 | UAV / random reward / chopper gunner |
| Enter / Space during killcam | Skip replay |
| Mouse + click / F in chopper | Aim + fire cannon |
| E in chopper | Return to operator |
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
node --env-file=.env.local tools/verify-combat-pass.mjs
node tools/verify-combat-edges.mjs
node --env-file=.env.local tools/verify-capacity.mjs
node tools/verify-operators.mjs
node tools/verify-expansion.mjs
node --env-file=.env.local tools/verify-roadkills.mjs
WIDTH=2560 HEIGHT=1440 DPR=2 node tools/benchmark.mjs
```

The multiplayer check uses two isolated Chrome contexts with fake microphone audio. It exercises invite rejection, joining, start, pose/crouch replication, exclusive vehicle seats, host and guest driving, occupied-vehicle host transfer, real bullet damage, respawn, voice packets, forced direct-media failure and radio fallback, push-to-talk, results, rematches, and host transfer. It is not a 16-device load test or a listening test of physical microphones.

`verify-expansion.mjs` exercises real pointer capture/re-entry, stationary aiming, steering/boost/braking, a ramp jump and landing, dismount, supplies, and launch pads. `benchmark.mjs` samples actual browser frame and CPU timings with seven bots. Set `TEST_URL` to select the server (inspection tools use port 5180 by default).

`verify-roadkills.mjs` drives real vehicle collisions against controlled targets: harmless bumps, nonlethal impacts, separation before repeat damage, two consecutive roadkills, reverse, near misses, height separation, and wall protection. With lobby keys it also verifies host-to-guest, guest-to-bot, and guest-to-host kills and shared scoring through InstantDB.

`tools/puppet-preview.html` is a local inspection stage. Operator verification checks both hands against each weapon grip in standing/crouched and raised/lowered aim poses. Debug URL flags include `?noao`, `?botfreeze`, `?passive`, `?ghost`, and `?nolock` for local inspection.

Code is MIT. Third-party assets retain their individual licenses. The retained Rust map is a fan tribute; Call of Duty and Rust are trademarks of Activision.

## Multiplayer verification

`npm run test:multiplayer-flow` checks fresh invitation entry, all ten classes, active versus queued equipment, duplicate spawn protection, guest shooting, death during class selection, visible bots and humans, late joining, rematches and host transfer across three browser contexts. `node --env-file=.env.local tools/verify-lobby-capacity.mjs` checks eight actual game clients and rejects a ninth.

`npm run test:online` exercises live bullets, score, respawn, driving and two-way voice. Multiplayer browser tests use an isolated ephemeral room suffix, so they do not join the players' lobby. Set `TEST_URL` to verify the deployed build.

`npm run test:multiplayer-maps` checks map selection, slow-loader synchronization, identical Rust collision layouts, room and microphone continuity, guest bullet damage and respawn, class changes, late joining, rematches between both maps, and host transfer in three isolated browser contexts.

`npm run test:audio` checks short gun reports, bounded concurrent sounds, audio-node cleanup, silent microphone suppression, stale voice packet dropping, and push-to-talk key-repeat handling. This browser test runs locally without lobby credentials.

The capacity test runs one rendered game with 15 independent authenticated clients sending real presence and pose traffic, and checks 17th-player rejection. It is a local protocol/load check, not 16 physical devices or 16 simultaneous microphones. The combat tests cover death replays, host continuity, skipping, final results, all reward types, chopper damage, kicks/rejoin, frag timing, tower landing and motorcycle entry. All tests use isolated room suffixes.
