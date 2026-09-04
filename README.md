# RUST — Free-For-All · Multiplayer

> **This is the multiplayer build** of [calloffable-public](https://github.com/rbrown101010/calloffable-public): one password-protected lobby for up to 8 players, empty slots filled by the existing bots, and CoD-style proximity voice chat.
> **Status: design complete, implementation not started.** The full plan, protocol, authority model and milestones are in [MULTIPLAYER.md](MULTIPLAYER.md). Server secrets are listed by name in [.env.example](.env.example).
>
> Everything below describes the single-player game this repo starts from. It still runs as-is with `npm run dev`.

A browser-based, Call of Duty–style first-person shooter set on a faithful recreation of the classic **Rust** map: the oil derrick tower, shipping containers, pump-house bunker, oil tank, the big pipe, ladders, stairs and a desert horizon lit by a real HDRI sky.

- **Mode:** 8-player Free-For-All against 7 AI operators (GHOST, ROACH, SOAP, PRICE, MEAT, ROYCE, OZONE) on an extended ~96 m Rust arena: the classic core plus a north container yard and watchtower, an east pump station and garage, a south trench line and truck depot, and west twin tanks with a top walkway and a hangar. Score limit is adjustable from 1 to 30 kills (default 10) or best score after 10 minutes. Three difficulty presets (Recruit / Regular / Veteran). The match ends with a **Final Killcam** replay of the winning kill from the killer's eyes (Enter to skip).
- **Killstreaks:** 3 kills = UAV (all enemies on the radar for 30 s, press **3**), 5 kills = Airstrike (press **4**, then click/F to mark the target; five bombs run forward from the mark). Earned streaks survive death until used.
- **Loadouts (4):** ASSAULT (SCAR-H + Desert Eagle), SNIPER (Intervention + M1911), RUSHER (MP5 + Desert Eagle, 2 frags), OVERKILL (AK-47 + SPAS-12).
- **Voice:** CoD-style announcer (UAV online, airstrike inbound, double kill, match point, you've taken the lead, victory/defeat…), your operator's callouts (reloading, frag out, tango down) and spatialized enemy chatter, generated through Vercel AI Gateway text-to-speech (`node tools/voice.mjs`, needs `AI_GATEWAY_API_KEY`).
- **Stack:** Vite + TypeScript + three.js (WebGL 2, PBR, 4K shadow map, SSAO, bloom, SMAA, ACES) + Rapier physics (character controller, ragdoll-free hit zones, rigid-body grenades and shell casings).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome (or any Chromium/Firefox/Safari with WebGL 2). Pick **MOUSE** or **TRACKPAD** controls, click **DEPLOY** — the game captures the pointer. Press **Esc** to pause.

**Trackpad mode** (MacBook without a mouse): look with the trackpad, fire with **F**, toggle aim with **E**; scroll-wheel weapon switching is disabled so two-finger drift doesn't swap guns.

Production build: `npm run build` then `npm run preview`.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Shift | Sprint (Shift while aiming: steady aim) |
| Space | Jump / let go of ladder |
| C or Ctrl | Crouch (press while sprinting to slide) |
| Left mouse / F | Fire |
| Right mouse / Alt (hold) · E (toggle) | Aim down sights (scope on the Intervention) |
| R | Reload |
| 1 / 2 / Q / wheel | Switch weapon |
| G (hold to cook) | Frag grenade |
| 3 / 4 | Call in UAV / Airstrike when earned |
| Tab | Scoreboard |
| Esc | Pause / settings (sensitivity, FOV, volume, render scale, wind ambience, aim mode) |

Walk into a ladder to climb it. Head-shots do extra damage; the Intervention is a one-shot kill to the head or body. A red grenade icon around the crosshair points at any live grenade within 9 m.

## Debug URL flags

`?noao=1` disable SSAO · `?god=1` invulnerable · `?ghost=1` bots ignore you · `?botfreeze=1` bots stand still · `?nolock=1` no pointer lock (automation)

## Credits

See `public/CREDITS.md` — every third-party asset is CC0 / CC-BY and credited there.

## License

Code is MIT (see `LICENSE`). Third-party assets keep their own licenses, all listed with attribution in `public/CREDITS.md`. This is a non-commercial fan tribute; "Call of Duty" and "Rust" are trademarks of Activision.
