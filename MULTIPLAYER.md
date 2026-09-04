# RUST FFA — Multiplayer Design

**Status:** design complete, implementation not started (2026-09-02).
**Scope:** one game at a time. One password-protected lobby, up to 8 players, empty slots filled by the existing bots, CoD-style voice chat. Friends-only by design: we trust clients wherever that makes the game feel better and the build smaller.

This document is the build plan. The single-player game it starts from is described in [README.md](README.md).

---

## 1. Decisions

| Layer | Choice | Why |
| --- | --- | --- |
| Client | Vite + three.js + Rapier, as today | Rendering, audio, HUD and gunfeel stay untouched. |
| Game server | Node 22 + **Colyseus** (one room, `maxClients = 8`) | TypeScript, room lifecycle, join auth hook, reconnection, delta-compressed state. |
| Transport | WebSockets | Good enough for 8 players; Krunker-class shooters ship on it. WebTransport later if ever needed. |
| Shared sim | `shared/` package: map colliders, `Physics.moveCharacter`, bots, weapon defs | Same code on server (headless) and client. |
| Voice | **LiveKit Cloud** (SFU) + `livekit-client` | One upload per player, built-in relay, Krisp noise cancellation, active-speaker events. Free tier covers 8 people. |
| Hosting | One small **Fly.io** machine (server also serves `dist/`) | One URL, one process, one secret set. Cloudflare Tunnel from a Mac is the free alternative. |
| Accounts / DB / matchmaking | None | One lobby, one password. Callsign is typed at join. |

## 2. What players see

1. Open the URL. The menu gets **JOIN LOBBY**: callsign + password. Wrong password shakes and denies. There is no lobby list because there is one lobby. An invite link may carry the password in the URL **fragment** (`#pw=…`), which never reaches server logs.
2. **Lobby screen:** 8 slots. Humans fill slots as they arrive; the rest show as bots (host picks the bot count and difficulty). Everyone picks a loadout and toggles READY. The **host** (first to join, or whoever entered `HOST_PASSWORD`) sets the score limit and presses **START**.
3. **Match:** exactly today's game: 4 s countdown, killfeed, announcer/operator/enemy voice lines, streaks, radar, nameplates, hit markers. Late joiners drop in at the next spawn.
4. **End:** Final Killcam of the winning kill from the killer's eyes, scoreboard, then **REMATCH** returns everyone to the lobby with the same password. Auto-return after 30 s. The server stays up between games.
5. **Voice:** mic prompt once at the lobby. Push-to-talk on **V** (toggle in trackpad mode), open-mic optional. Lobby and results are flat "everyone" chat; in-match is **proximity** chat through the game's 3D audio. Per-player mute and volume on the scoreboard.

## 3. Architecture

```
  Each player's browser                              One Node process (Fly.io)
 ┌──────────────────────────────┐                   ┌────────────────────────────────────┐
 │ three.js render, HUD, audio  │   WebSocket       │ Express: serves dist/ (client)     │
 │ local Player  = authority    │◄─────────────────►│ Colyseus room "lobby" (max 8)      │
 │ RemotePlayer puppets (interp)│  state up 30 Hz   │   onAuth → LOBBY_PASSWORD          │
 │ Bot puppets from room state  │  patches down 20Hz│   phase / score / timer / spawns   │
 │ Bullets: own + incoming bot  │  events both ways │   headless Rapier + Bots.ts (7 max)│
 │ Grenades: own (streamed)     │                   │   mints LiveKit tokens             │
 │ LiveKit voice (PTT)          │                   └────────────────────────────────────┘
 └───────────────┬──────────────┘
                 │ Opus over WebRTC
                 ▼
          LiveKit Cloud (SFU)
```

Ticks: server sim **60 Hz** fixed step (Rapier + bots), state patches **20 Hz**. Clients send their own state at **30 Hz** and render everyone else **100 ms** in the past, interpolating between the two newest samples. Bandwidth is trivial (~8 entities × ~40 B × 20 Hz ≈ 6 kB/s per client).

## 4. Authority model (v1: "trust your friends")

| Thing | Who decides | Notes |
| --- | --- | --- |
| Your own movement, stance, ladder, slide | **Your client** | Zero added latency, no prediction/reconciliation code. Server only sanity-checks speed and bounds. |
| Human shoots human or bot | **Shooter's client** reports the hit | Instant hit markers. Server validates: victim alive, distance ≤ 200 m, damage ≤ weapon max, fire rate ≤ weapon RPM × 1.2. |
| Bot shoots human | **Victim's client** | Server broadcasts the bot's bullet (origin, dir, speed, dmg); the victim simulates it against its own body with the existing `Bullets` code and reports damage taken. Reuses today's code path exactly. |
| Bot shoots bot | **Server** | Both positions are exact on the server. |
| Grenades | **Owner streams position**, reports the explosion | Server applies blast damage to bots; each human computes its own blast damage from the broadcast (victim-authoritative). |
| Bots (AI, movement, aim) | **Server** | Headless `BotManager`; humans appear to it as targets built from their streamed positions. |
| Spawns, score, phases, timer, streak grants, airstrike bombs | **Server** | Single source of truth for the match. |
| Killcam | **Each client, locally** | Every client already receives every pose (incl. yaw/pitch). Extend the 9 s ring buffer to all entities and replay from the killer's streamed pose. No extra traffic. |

If this ever goes public, the upgrade path is server-authoritative movement with client prediction and lag-compensated hits. Nothing in v1 prevents that; it is deliberately not built.

## 5. Protocol

### Room state (Colyseus `@colyseus/schema`)

```ts
class Pose extends Schema { x; y; z; yaw; pitch; vx; vy; vz; anim: uint8 /* bitfield: crouch|slide|ladder|sprint|ads|reloading|moving */; weapon: uint8; }
class PlayerState extends Schema {
  id; name; isHost; ready; loadout: uint8; alive; health: uint8;
  score; kills; deaths; streak; ping: uint16;
  pose: Pose;                      // mirrored from the client's own report
  grenades: ArraySchema<Pose>;     // live grenades owned by this player (position only)
}
class BotState extends Schema { id; name; alive; skill; tint: uint8; weapon: uint8; pose: Pose; anim: uint8; }
class LobbyState extends Schema {
  phase: 'lobby' | 'countdown' | 'match' | 'killcam' | 'results';
  hostId; scoreLimit; difficulty: uint8; botCount: uint8;
  timeLeft: uint16; countdown: uint8;
  players: MapSchema<PlayerState>; bots: MapSchema<BotState>;
  winnerId; lastKill: { killerId; victimId; t };   // for the shared killcam cue
}
```

### Client → server messages

| Type | Payload | Rate / when |
| --- | --- | --- |
| `state` | `Pose` + `grenades[]` | 30 Hz while in match |
| `fire` | `{ weapon, o:[x,y,z], d:[x,y,z], seq }` | per shot; relayed to others for muzzle flash, tracer, sound |
| `hit` | `{ victimId, part: 'head'\|'body'\|'limb', dmg, weapon, seq }` | shooter-reported |
| `damage` | `{ sourceId, dmg, part, weapon }` | victim-reported (bot bullets, explosions) |
| `explode` | `{ id, p:[x,y,z] }` | owner's grenade burst |
| `respawn` | `{}` | after death timer; server answers with `spawn` |
| `streak` | `{ kind: 'uav' \| 'airstrike', mark?: [x,z], dir?: [x,z] }` | when earned + used |
| `lobby.*` | `loadout {n}`, `ready {b}`, `settings {scoreLimit, difficulty, botCount}` (host), `start` (host), `rematch` | lobby / results |

### Server → client messages (in addition to state patches)

| Type | Payload | Client reaction |
| --- | --- | --- |
| `spawn` | `{ p, yaw }` | teleport local player, restore loadout ammo |
| `fire` | `{ ownerId, weapon, o, d }` | remote muzzle flash, tracer, positional gunshot (uses `d.audio.far` at range) |
| `bot_fire` | `{ botId, weapon, o, d, speed, dmg }` | spawn an incoming bullet the local `Bullets` sim tests against the local body |
| `hurt` | `{ victimId, attackerId, dmg, part }` | victim: damage flash + health; attacker: confirmed hit marker; others: flinch on the puppet |
| `kill` | `{ killerId, victimId, weapon, headshot, streak }` | killfeed, voice lines, streak chips, death cam |
| `explosion` | `{ p, ownerId, radius, maxDmg, weapon }` | effects + victim-side blast damage |
| `voice_token` | `{ url, token }` | connect LiveKit (sent once after auth) |
| `phase` | `{ phase, countdown?, winnerId?, lastKill? }` | menu ↔ match ↔ killcam ↔ results |

Start with Schema + JSON messages. Pack `state`/`fire` into `ArrayBuffer`s only if profiling says so (it will not, at 8 players).

## 6. Server

```
server/
  index.ts        Express static (dist/) + Colyseus Server + WebSocketTransport, PORT (default 2567)
  LobbyRoom.ts    onAuth (password), onJoin/onLeave (host handoff, allowReconnection 20 s),
                  setSimulationInterval(1000/60) → tick(), setPatchRate(50)
  Match.ts        phases, countdown, score limit, timer, spawn picking (farthest from enemies), streaks, airstrike scheduler
  Sim.ts          headless world: RAPIER.init(), RustMap.buildColliders(), BotManager(headless), bullet/blast validation
  Voice.ts        LiveKit AccessToken minting (livekit-server-sdk)
shared/
  Map.ts (colliders + waypoints, no meshes)  Physics.ts  Bots.ts (puppet optional)  WeaponDefs.ts  util.ts
```

Headless requirements (the only real refactor):

- `RustMap` gets a `headless` mode that builds colliders, spawns and waypoints but no geometry, textures or lights. Today the builder merges three.js geometry per material; the collider descriptions already exist alongside it.
- `BotManager` accepts `puppet?: SoldierPuppet` and an `AudioEvents`-style callback set (it already has `BotEvents { onKill, onShot, onStep, onSpot, onHurt, onReload, onGrenade }`). On the server those events become `bot_fire` broadcasts and bot state changes; on the client bots render from room state.
- Bots need a target interface (`{ id, pos, eyePos, alive, name, health, lastDamageFrom }`). Humans are represented on the server by `RemoteTarget` objects updated from `state` messages.
- `@dimforge/rapier3d-compat` runs in Node as-is (`await RAPIER.init()`). `three` imports fine in Node for math; nothing that touches `document` may be reached in headless mode.

Validation rules (cheap, friend-proof, not cheat-proof): speed ≤ 9 m/s horizontal (slide) with a 2 m/tick teleport tolerance; positions inside map bounds; per-weapon fire-rate and damage caps; `hit` distance ≤ 200 m; only alive players fire or take damage; `respawn` only after the 3 s death timer.

## 7. Client changes

| File | Change |
| --- | --- |
| `src/game/Net.ts` (new) | Colyseus client, join with `{ name, password, reconnectToken }`, message routing, interpolation buffers per entity, ping display. |
| `src/game/RemotePlayer.ts` (new) | `SoldierPuppet` + interpolation + footstep/reload/fire audio from events + nameplate. Equivalent to today's bot rendering without AI. |
| `src/game/Game.ts` | `mode: 'solo' \| 'online'`. Online: no local `BotManager`; bots and players come from room state; phases/score/timer mirror the server; local `Player` posts `state` at 30 Hz; spawn from `spawn`; killfeed from `kill`; ring buffer covers all entities for the killcam. |
| `src/game/Weapons.ts` (`Bullets`, `Gunplay`) | Bullets carry `ownerId`. Hitting a remote hitbox sends `hit` (blood + hit marker shown optimistically). Incoming `bot_fire`/remote `fire` spawn visual-only or self-testing bullets. |
| `src/game/Grenades.ts` | Owner streams live grenade positions; on burst send `explode`. Remote grenades render from streamed positions. |
| `src/game/Player.ts` | `takeDamage` from `hurt`/local blast → also sends `damage` for bot/explosion sources. Death/respawn driven by server. |
| `src/game/HUD.ts` | Join screen, lobby (slots, loadouts, ready, host controls), results with REMATCH, ping + speaking indicators, scoreboard mute/volume. |
| `src/game/VoiceChat.ts` (new) | LiveKit connection, PTT, proximity routing (see §9). |
| `src/game/Voice.ts` | Unchanged. Announcer lines trigger from server `kill`/`phase`/`streak` events instead of local match logic. |

## 8. Lobby and password

- Password is `LOBBY_PASSWORD` on the server only. Never in the bundle, never in a query string, never logged.
- Check happens in the room's `onAuth` hook (static in Colyseus 0.16+). Compare SHA-256 digests with `crypto.timingSafeEqual` so lengths never leak. Reject with a clear code the join screen maps to "Wrong password".
- Rate limit: 5 failures per IP per minute, then a 60 s lockout. Log the count, not the attempt.
- Host = first connected client. On host leave, host passes to the earliest remaining joiner. `HOST_PASSWORD` (optional) claims host on join.
- Reconnect: Colyseus `allowReconnection(client, 20)`; the client stores the reconnection token in `localStorage` so a refresh puts you back in your body with score intact.
- Capacity: 9th join is refused with "Lobby full". Bots yield slots to humans automatically (`botCount` = max(0, configured − 0), humans first).

## 9. Voice chat

- **Tokens:** after `onAuth` passes, the server mints a LiveKit `AccessToken` (identity = player id, room `lobby`, ttl 4 h, grants `roomJoin`, `canPublish`, `canSubscribe`) and sends `voice_token`. API key and secret stay in server env.
- **Client:** `livekit-client` `Room.connect(url, token)`; publish mic with the Krisp noise filter when available; `setMicrophoneEnabled(true/false)` on PTT with a 150 ms release tail so word endings are not clipped. Open-mic uses LiveKit's built-in VAD.
- **Proximity routing:** on `TrackSubscribed`, wrap the remote `MediaStreamTrack` in a `MediaStream`, feed `audio.ctx.createMediaStreamSource()` into the game's existing HRTF `PannerNode` chain (refDistance 4, maxDistance 25, exponential rolloff), positioned every frame from the same interpolated pose the puppet is drawn at. Lobby/results phases bypass the panner (flat, full volume).
- **Radio flavor (setting, default off):** a 280–3800 Hz band-pass + light compression on in-match voice, matching the operator callouts.
- **Indicators:** `ActiveSpeakersChanged` drives the top-left speaker list and a speaker icon above the talking puppet's head. Scoreboard rows get a mute toggle and volume slider (local only).
- **Gotcha:** in Chromium a remote WebRTC track stays silent inside Web Audio unless the same stream is also attached to a muted `<audio>` element. Do both.
- **No recording, ever.** Tokens expire with the match; a new one is minted per join.
- **Fallback without LiveKit:** WebRTC peer mesh signaled over the Colyseus room (7 uploads per client, needs a TURN relay). Same spatial routing. Only if the vendor dependency is unwanted.

## 10. Hosting and operations

- **Fly.io:** one `shared-cpu-1x` / 512 MB machine near the players. `fly launch --no-deploy`, `fly secrets set LOBBY_PASSWORD=… LIVEKIT_URL=… LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=…`, `fly deploy`. Health check on `GET /healthz`. Redeploy = push.
- **Dockerfile (outline):** `node:22-alpine`, `npm ci`, `npm run build` (client) + `npm run build:server` (tsc), `CMD node server/dist/index.js`, `EXPOSE 2567`.
- **Free alternative:** run the server on a Mac and expose it with `cloudflared tunnel` (https link, WebSockets supported).
- **Env vars:** see [.env.example](.env.example). Never commit `.env`.
- **Observability:** `/healthz` (phase, player count, tick time), a client `?netstats=1` overlay (ping, up/down rates, interpolation delay).
- **Cost:** ≈ $5/month for the machine; LiveKit free tier for voice.

## 11. Milestones and acceptance checks

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Scaffold | `server/` runs locally; two browsers join with the password and see each other's callsigns in the lobby; wrong password is refused; 9th client refused. |
| M1 | Remote bodies | Two players see each other move, crouch, slide, climb ladders and switch weapons with no visible stutter at 100 ms artificial latency (`tools/play.mjs` with two contexts). |
| M2 | Combat & match flow | Shooting, hits, deaths, respawns, killfeed, score, countdown, score-limit end, results, rematch. A 2-human match to 5 completes without desync of scores. |
| M3 | Server bots | Lobby fills to 8 with bots; bots move on the server and shoot humans and each other; a solo human vs 7 server bots plays like today's single-player. |
| M4 | Parity | Grenades, UAV, airstrike, final killcam, announcer/operator lines all work online. |
| M5 | Voice | PTT, proximity chat in match, flat chat in lobby/results, speaker indicators, per-player mute. Two laptops in one room can hear direction. |
| M6 | Deploy | Live on Fly.io behind one URL; refresh reconnects into the same body; `?netstats=1` shows < 60 ms RTT for same-region players. |

Order of work inside each milestone: server first, then client, then a Playwright multi-context smoke test added to `tools/`.

## 12. Out of scope (by design)

Server-authoritative movement and lag compensation, anti-cheat, matchmaking, multiple rooms, accounts, persistence, leaderboards, spectator mode, mobile. Each has a clear slot in this architecture if the game ever goes public.

## 13. Current code this starts from

`src/game/Game.ts` (orchestration, match flow, killcam ring buffer), `Player.ts` (kinematic character, `takeDamage`), `Bots.ts` (`BotManager`, perception, states, A* over `Map` waypoints), `Puppet.ts` (`SoldierPuppet`: shared body for bots, shadow, killcam and soon remote players), `Weapons.ts` (`ViewModel`, `Bullets`, `Gunplay`), `WeaponDefs.ts`, `Grenades.ts`, `Map.ts` (`RustMap`, 96 m arena, 20 spawns, ~264 waypoints), `Physics.ts` (`moveCharacter` step-up), `Audio.ts` (buses, HRTF `play3D`, gunshot layering), `Voice.ts` (announcer/operator/enemy lines), `HUD.ts`. Debug flags and test tooling are listed in the README.
