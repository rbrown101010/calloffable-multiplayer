# Modern Singularity 2

[Play Modern Singularity 2](https://modern-singularity-2.vercel.app)

A browser FPS with a 300 × 300 m desert refinery, an eight-floor central tower, 15 weapons, tactical AI, vehicles, and private multiplayer for up to 16 people. The original compact Rust map remains available.

## Create or join a game

Choose **Private Multiplayer → Create lobby**, enter a callsign and the six-digit create-game code, and create the lobby. The code lives in the server's `LOBBY_HOST_PIN`, not in the client. Anyone with that code can create a game. Creation replaces the previous lobby.

The creator chooses the map, player limit, bot fill and score limit, then copies the invitation for friends. Friends open it, enter a callsign, choose weapons, and ready up. The creator starts the match. No email, account form or password is needed. The microphone starts off; enable it explicitly, with optional **V** push-to-talk.

Only the creator can start/rematch, change map/capacity, remove players or end the lobby. Guests do not take over if the creator leaves. Rematches keep the invitation; a newly created lobby gets a fresh invitation.

## Skyline Assault update

- **Custom weapons:** choose a primary and secondary independently, with actual model previews. Press **L** during a match to queue both weapons for the next respawn. The lobby, score and voice connection remain intact. Both weapons reset together on a new life.
- **Primary weight:** movement follows the equipped primary, including while holding a secondary. MP5, P90 and Vector loadouts move 1.75 times as fast as Intervention loadouts. Sniper body damage remains 82; headshots remain lethal.
- **Launchers:** RPG-7 rockets and M32 grenades are moving explosive projectiles. Rockets travel quickly; grenades arc. Host-owned collision and line-of-sight blast falloff determine damage. RPG + M32 is a selectable pair.
- **Sights:** assault rifles, SMGs and the M249 use red dots; the semi-automatic M14 has a holographic sight with a ring-and-dot reticle.
- **Death aftermath:** 1.35 seconds of the victim's death animation before the killcam. Six fall styles include side falls, kneeling, spinning and blast recoil. Enter, Space or click skips the replay. Normal human respawn is six seconds.
- **Sable Reach:** an eight-floor central skyscraper with open windows, interior cover, a switchback staircase and shared elevator. Enter the lift, press **E**, and choose floor 1–8. Call it from a landing with **E**. The map also adds outer buildings, covered crossings, a roof connector and a 23 m corner hill with an overwatch bunker.
- **Vehicle firing:** fire your selected weapon forward with left mouse or **F**, switch weapons with **1 / 2 / Q**, and reload with **R**. Camera orbit is independent of the firing direction. ADS is disabled while driving; the projected gold marker shows the forward firing line.
- **Air support:** the UAV uses a 110 m radar view with edge indicators and height markers. Rewards at six, seven and eight kills add precision strikes, an attack helicopter and a stealth bomber. UAVs and support aircraft are visible in the sky.
- **Chopper gunner:** 35 seconds of controllable flight, explosive cannon, six rockets and a cannon heat meter. **WASD** flies, **Space / Ctrl** changes altitude, mouse aims, left click/**F** fires the cannon, right click fires rockets, **E** exits. The operator remains vulnerable on the ground. At most two controlled gunships and twelve support aircraft are active.

Existing features include six Kestrel ATVs, four faster Raven motorcycles, speed-based roadkills, supply stations, jump pads, rooftop routes, a relay station and refinery ladders. Operators flank, crouch, change ranges, retreat to reload, and avoid grenades. Map geometry and vehicle parts are batched; automatic render scaling, bounded audio voices and bounded replay/projectile pools control resource use.

## Arsenal

| Primary choices | Secondary choices |
|---|---|
| SCAR-H, AK-47, G36C | M1911 .45 |
| MP5, P90, Vector .45 | Desert Eagle |
| M14 EBR, Intervention | MP7 |
| SPAS-12, M249 SAW, RPG-7 | M32 GL |

## Killstreaks

| Consecutive kills | Reward | Activate |
|---|---|---|
| 3 | UAV, 35 seconds | 3 |
| 5 | Random airstrike, advanced UAV or resupply | 4 |
| 6 | Precision strike | 6 |
| 7 | Attack helicopter | 7 |
| 8 | Stealth bomber | 8 |
| 9 | Chopper gunner | 5 |

Earned unused rewards survive death. The streak counter resets when you die. Advanced UAV lasts 60 seconds. Resupply restores health, ammunition and two frags. A map or match reset clears rewards and active support.

## Controls

| Input | Action |
|---|---|
| WASD / Shift | Move / sprint |
| Space | Jump / leave ladder |
| C or Ctrl | Crouch; sprint then crouch to slide |
| Left mouse / F | Fire |
| Right mouse / Alt / E | Aim, when on foot and away from an interaction |
| R | Reload |
| 1 / 2 / Q / wheel | Switch equipped weapon |
| G | Cook and throw frag |
| L | Customize weapons for next respawn |
| E near vehicle / lift | Enter or exit vehicle / call or operate lift |
| Space / Shift while driving | Brake / boost |
| Tab | Scoreboard |
| Esc | Pause / settings; multiplayer simulation continues |
| V | Push-to-talk, when enabled |
| Enter / Space / click in killcam | Skip |

Desktop keyboard and mouse are recommended. Trackpad mode supports F to fire and E to aim. There are no mobile touch controls.

## Development and verification

```sh
npm ci
cp .env.example .env.local
# Fill server credentials for private multiplayer. Solo needs no credentials.
npm run dev
npm run build
```

The dev server is `http://127.0.0.1:5178` and includes `/api/lobby`. Vercel runs that API in production. Static `npm run preview` does not emulate the API.

For multiplayer tests, create `.env.expansiontest.local` with an independent random `LOBBY_HOST_KEY` and a test `LOBBY_HOST_PIN`. Keep the InstantDB credentials in `.env.local`. The mode override creates a separate lobby controller, so test creation cannot replace a live lobby. Never test lobby creation against production.

```sh
PLAYWRIGHT_TEST=1 npm run dev -- --mode expansiontest --port 5182
# In another terminal, set LOBBY_HOST_PIN to that isolated test code:
TEST_URL=http://127.0.0.1:5182 node --env-file=.env.expansiontest.local tools/verify-skyline.mjs
TEST_URL=http://127.0.0.1:5182 node tools/verify-combat-edges.mjs
TEST_URL=http://127.0.0.1:5182 node tools/verify-audio-performance.mjs
TEST_URL='http://127.0.0.1:5182/?nolock&god' node tools/benchmark.mjs
```

`verify-skyline.mjs` uses two independent Chrome contexts and real InstantDB messages to exercise custom equipment, launcher damage, death delay/skip, all elevator floors, vehicle fire and shared air support. Older multiplayer scripts target previous protocols and should be adapted before use. These checks are not a 16-physical-device or physical microphone listening test.

Stack: TypeScript, Vite, Three.js, Rapier, InstantDB, WebRTC and Web Audio. Read [MULTIPLAYER.md](MULTIPLAYER.md) for authority, voice and deployment details. Server secrets must never use a `VITE_` prefix.

Code is MIT. Third-party assets retain the licenses in [public/CREDITS.md](public/CREDITS.md). The retained Rust arena is a fan tribute; Call of Duty and Rust are Activision trademarks.
