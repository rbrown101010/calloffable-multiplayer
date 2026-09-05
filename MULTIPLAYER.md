# Private multiplayer

## Creating and joining a lobby

Choose **Create lobby**, enter a callsign and the six-digit create-game code, then select **Create new lobby**. The code is held only in the server's `LOBBY_HOST_PIN` environment variable. Anyone given that code can create a lobby. Creation replaces the previous lobby and issues a fresh invite link. Friends use **Join a lobby** and the copied invitation; the create-game code is never included in that link.

The server records the current lobby, its creator, and its invitation in a private InstantDB namespace. Only the creator can start/rematch, change map/capacity, kick players, or end that lobby. Server endpoints authorize start/end, and clients authenticate transport peer identities before accepting the creator's messages. Guests never take over hosting when the creator leaves. Each client checks every three seconds for session expiry or a replacement lobby and leaves the old game when it has ended. **End lobby for everyone** closes the session explicitly.

The six-digit code has a limit of eight incorrect attempts per 15-minute IP window. Failed-attempt counts are persisted server-side. Legacy host links and invitation codes are revoked by the reset. Each newly created lobby has its own invitation; rematches inside that lobby keep the same invitation.

Matches remain free-for-all on Rust or Sable Reach, with optional microphones, shared enemies, and a creator-selected limit of 2–16 humans.

## Choosing a map

The host selects **Match map** in the lobby before starting a match or rematch. Choose **Rust — Small** for the original compact arena, or **Sable Reach — Large** for the expanded map with vehicles and field supplies. Everyone loads the host's selection automatically, including late arrivals. The host waits for each connected player's map acknowledgement before starting the shared countdown.

Map changes preserve the room, invitation, player identity, and microphone connection. Scenery and collision switch together; inactive map colliders are disabled. Rust uses a fixed scenery seed so crates, barrels, rocks, and their collision shapes agree across clients. Both arenas are cached after their first load. A failed download shows Retry and Leave lobby controls.

After a match ends, return to the lobby, choose the next map, and start the rematch. Host and invite links stay the same for both maps.

## Weapon changes and session flow

An invite opens the callsign form directly. No email/password signup is needed. The lobby contains the weapon selector, ready button, invite copy, optional microphone and an explicit Leave lobby control. In an active match, closing the lobby resumes the game; it never disconnects the player.

Primary and secondary selection queues equipment for the next life. Only the host grants respawns. Every player pose and spawn grant carries a life number and equipped primary/secondary pair; a guest applies each life once, so a repeated grant or world snapshot cannot refill ammo or revert equipment. The host checks shots against that life's equipment, independently of the next equipment selected in presence. Weapons are cloned from templates preloaded at boot and both slots reset atomically on respawn.

World snapshots carry a monotonic sequence; recovery snapshots from presence cannot replace newer live state. Guest movement goes to the host and every other avatar is rendered from the host's snapshots, avoiding competing movement streams. Bot visibility and hitboxes follow the same authoritative roster through respawns and late joins. Protocol v6 uses a room suffix so old open tabs cannot mix incompatible map and spawn messages with the updated build. Everyone should refresh after this update and obtain the new invitation from the creator.

## Replays, rewards and moderation

Each browser records at most 64 pose frames at 10 Hz and 512 shot markers. After a 1.35-second death animation, the victim watches approximately three seconds from the killer's recorded perspective, with Enter/Space/click to skip. Replay puppets have no physics bodies. Only render transforms change, and they are restored synchronously before simulation or networking resumes. Respawns, loadouts, vehicles and voice continue normally. Live weapon reports are muted during playback; replay reports share the audio voice budget. Very early deaths may lack enough recorded history for a replay.

The host awards rewards at 3/5/6/7/8/9 kills and owns their consumption. Snapshots carry inventories, radar expiry, support aircraft and active choppers. Normal UAV lasts 35 seconds; advanced UAV lasts 60 seconds. Both use a 110 m radar view, edge markers and elevation indicators. Six kills unlock a precision strike, seven an attack helicopter, eight a stealth bomber. The chopper gunner lasts 35 seconds and accepts bounded directional/altitude input from its owner; missing input stops movement after 350 ms. Cannon explosions, rocket explosions, heat and the six-rocket inventory are host-owned. At most two controlled choppers and twelve support aircraft can exist. Active choppers end on operator death; unused rewards survive respawn. A match/map reset clears rewards and pending strikes.

RPG-7 and M32 shots launch host-simulated projectiles only after the equipped-weapon and cadence checks. Swept collision prevents tunneling; world geometry blocks blast damage. Snapshots replicate a bounded pool of 32 projectile visuals. Remote clients never apply projectile blast damage themselves. Primary weapon weight controls movement even while holding a secondary. Vehicle fire points along the chassis and does not allow ADS.

Sable's shared elevator accepts floor 1–8 requests only from a living operator in the cabin or at a nearby landing. The host publishes a destination, start time and duration. Clients move the cabin along that common schedule and carry their local rider with it. Landing doors block the empty shaft. The elevator and its colliders are cached and disabled with the inactive map.

Only the current host gets Kick controls. Removed IDs are carried in the host snapshot and filtered from admission, voice peers, avatars and incoming messages, even if a client ignores its disconnect. The same identity cannot rejoin that lobby. This is session moderation rather than a permanent account ban. The host cannot lower capacity below current occupancy.

## Authority and operating limits

InstantDB carries presence and ephemeral realtime messages. The creator’s browser runs AI, damage, scoring, health regeneration, respawns, grenades, and match completion. Clients send their locally controlled poses and shot events. The host checks shot sequence, cadence, equipped weapon, pellet count, distance, and world line of sight before applying reported hits.

The host grants exclusive ATV and motorcycle seats after checking distance and availability. A driver simulates their own suspension and movement locally, sends transforms with their player pose, and receives host-relayed states for other vehicles. The host bounds movement deltas and releases seats when drivers leave or die. Shared snapshots carry seats, parked positions, and supply cooldowns through late join. Consumable pickup distance and cooldown checks run on the host; jump pads are deterministic local movement.

Vehicle impacts use swept chassis collision checks against living operators, bounded by the first solid obstruction. Parking-speed bumps below 4 m/s are harmless; damage increases with speed and becomes lethal to a full-health target at 12.5 m/s (45 km/h). Sustained contact deals damage once until the vehicle separates. For guest drivers, the host checks the accepted movement path and bounds impact speed by observed displacement and that vehicle's speed limit; clients never submit roadkill damage or victim IDs. Packet gaps over 350 ms do not produce swept damage. A small contact allowance accounts for the local collision stopping margin. Guests predict traversal on lethal contact, while health, kills, points, killstreaks, and impact notifications remain host-authoritative.

This is a friends-only browser-hosted game, not a competitive anti-cheat server. The host is trusted; clients report their own movement and hit candidates. Keep the host tab active for smooth simulation. Background browser throttling or poor connections can cause a brief hitch. Scores and voice are not written to persistent match-history tables. There is no public ranked mode, dedicated simulation server, mobile touch UI, or positional voice attenuation.

Default InstantDB client data writes are denied in `instant.perms.ts`; only each user's own account can be viewed. The server holds the admin token. Room secrecy is a capability: anyone given the invite can join and pass it on. To revoke invitations, end the current lobby or create a new one. Rotate `LOBBY_HOST_PIN` and redeploy to change the create-game code. `LOBBY_HOST_KEY` is a separate signing secret, not the user-facing code.

## Voice

Microphones are off until the person explicitly enables them and accepts browser permission. WebRTC sends direct Opus audio when possible. Signaling travels through the private InstantDB room. A private TURN service can be supplied as `TURN_ICE_SERVERS` (JSON ICE-server array).

If direct audio cannot connect, an AudioWorklet encodes 128 ms frames of 16 kHz mu-law audio and sends them as ephemeral private-room messages. Receivers schedule a short playback buffer and drop late frames. This fallback has lower quality and higher latency than WebRTC and uses extra InstantDB bandwidth. It does not record or persist audio. Per-player mute and push-to-talk apply to both paths. Leaving the room stops microphone tracks and closes audio connections.

## Hosting

The deployment uses Vercel for static assets and `/api/lobby`. Configure these production environment variables:

- `VITE_INSTANT_APP_ID`: public app ID.
- `INSTANT_APP_ID`: same app ID, used by the server.
- `INSTANT_APP_ADMIN_TOKEN`: sensitive InstantDB admin token.
- `LOBBY_HOST_KEY`: sensitive random server signing secret (at least 32 random bytes).
- `LOBBY_HOST_PIN`: six-digit create-game code, shared only with people allowed to create games.
- Legacy `LOBBY_INVITE_KEY` is no longer used; each lobby receives a fresh random invitation.
- `TURN_ICE_SERVERS`: optional sensitive JSON configuration for a private TURN relay.

`vercel.json` configures the Vite build, static output, no-store API responses, microphone permissions and no-referrer policy. `.vercelignore` excludes local secrets and inspection/test output.

```sh
vercel link
vercel env add INSTANT_APP_ADMIN_TOKEN production --sensitive
# Add the remaining variables, then:
vercel --prod
```

The requested InstantDB app is `ec099d8e-0cbc-4742-87f6-e01fac862c5c`. InstantDB's published service notice currently gives August 31, 2027 as the hosted-service end date; a future migration or self-hosted deployment will be needed if operating beyond that date. See https://www.instantdb.com/docs.
