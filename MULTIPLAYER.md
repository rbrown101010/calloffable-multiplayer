# Private multiplayer

## One lobby

The public site supports solo play. Multiplayer requires an unguessable invitation key. A Vercel function compares it against server-only environment variables, issues an InstantDB user token, and returns the one private room ID. The room ID is derived from the owner key and is not embedded in the public JavaScript.

Invite URLs use a fragment (`#invite=…`), which is removed from the address bar and kept in the current tab's session storage. The owner's `#host=…` link additionally retrieves the shareable invitation key. The first connected player is the simulation host; ownership and simulation hosting are separate.

No room list or public matchmaking exists. Maximum occupancy is eight humans. AI fill is reduced as people join. Matches are free-for-all on Sable Reach, with shared countdown, score limit, timer, scoreboard, deaths, respawns, and rematches. Late arrivals receive the host snapshot. Leaving the room transfers hosting to the next player.

## Authority and operating limits

InstantDB carries presence and ephemeral realtime messages. The elected browser runs AI, damage, scoring, health regeneration, respawns, grenades, and match completion. Clients send their locally controlled poses and shot events. The host checks shot sequence, cadence, equipped weapon, pellet count, distance, and world line of sight before applying reported hits.

The host grants exclusive ATV seats after checking distance and availability. A driver simulates their own suspension and movement locally, sends transforms with their player pose, and receives host-relayed states for other vehicles. The host bounds movement deltas and releases seats when drivers leave or die. Shared snapshots carry seats, parked positions, and supply cooldowns through late join and host transfer. Consumable pickup distance and cooldown checks run on the host; jump pads are deterministic local movement.

Vehicle impacts use swept chassis collision checks against living operators, bounded by the first solid obstruction. Parking-speed bumps below 4 m/s are harmless; damage increases with speed and becomes lethal to a full-health target at 12.5 m/s (45 km/h). Sustained contact deals damage once until the vehicle separates. For guest drivers, the host checks the accepted movement path and bounds impact speed by observed displacement and the ATV speed limit; clients never submit roadkill damage or victim IDs. Packet gaps over 350 ms do not produce swept damage. A small contact allowance accounts for the local collision stopping margin. Guests predict traversal on lethal contact, while health, kills, points, killstreaks, and impact notifications remain host-authoritative.

This is a friends-only browser-hosted game, not a competitive anti-cheat server. The host is trusted; clients report their own movement and hit candidates. Keep the host tab active for smooth simulation. Background browser throttling, poor connections, or host migration can cause a brief hitch. Scores and voice are not written to persistent match-history tables. There is no public ranked mode, dedicated simulation server, mobile touch UI, or positional voice attenuation.

Default InstantDB client data writes are denied in `instant.perms.ts`; only each user's own account can be viewed. The server holds the admin token. Room secrecy is a capability: anyone given the invite can join and pass it on. To revoke invitations, replace `LOBBY_INVITE_KEY` and redeploy. Rotate both owner and invite keys to move everyone to a new private room.

## Voice

Microphones are off until the person explicitly enables them and accepts browser permission. WebRTC sends direct Opus audio when possible. Signaling travels through the private InstantDB room. A private TURN service can be supplied as `TURN_ICE_SERVERS` (JSON ICE-server array).

If direct audio cannot connect, an AudioWorklet encodes 128 ms frames of 16 kHz mu-law audio and sends them as ephemeral private-room messages. Receivers schedule a short playback buffer and drop late frames. This fallback has lower quality and higher latency than WebRTC and uses extra InstantDB bandwidth. It does not record or persist audio. Per-player mute and push-to-talk apply to both paths. Leaving the room stops microphone tracks and closes audio connections.

## Hosting

The deployment uses Vercel for static assets and `/api/lobby`. Configure these production environment variables:

- `VITE_INSTANT_APP_ID`: public app ID.
- `INSTANT_APP_ID`: same app ID, used by the server.
- `INSTANT_APP_ADMIN_TOKEN`: sensitive InstantDB admin token.
- `LOBBY_HOST_KEY`: sensitive random owner key (at least 32 random bytes).
- `LOBBY_INVITE_KEY`: sensitive random invite key (at least 24 random bytes).
- `TURN_ICE_SERVERS`: optional sensitive JSON configuration for a private TURN relay.

`vercel.json` configures the Vite build, static output, no-store API responses, microphone permissions and no-referrer policy. `.vercelignore` excludes local secrets and inspection/test output.

```sh
vercel link
vercel env add INSTANT_APP_ADMIN_TOKEN production --sensitive
# Add the remaining variables, then:
vercel --prod
```

The requested InstantDB app is `ec099d8e-0cbc-4742-87f6-e01fac862c5c`. InstantDB's published service notice currently gives August 31, 2027 as the hosted-service end date; a future migration or self-hosted deployment will be needed if operating beyond that date. See https://www.instantdb.com/docs.
