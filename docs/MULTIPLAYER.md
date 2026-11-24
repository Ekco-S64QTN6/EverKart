# Multiplayer — design

Two ways to race other people: **split screen** on one machine (up to four players, one quarter
of the screen each, as the classic console kart racers did it) and **online** (a host opens a
lobby, friends join, the race runs between their machines). This document is the plan; the
work is tracked in ROADMAP.md (P7).

---

## 1. What both need first: a race with more than one driver at the controls

Today a race has exactly one human, `player` in `game/src/main.js`, and everything that means
"you" hangs off it. Both kinds of multiplayer start by replacing that with a list of **seats**:

| Today (one `player`) | Per seat |
|---|---|
| `readControls()` merges the keyboard and the first controller | each seat reads its own device (keyboard, pad 1–4) or a remote player |
| the chase camera's state is loose variables in `start()` (`camYaw`, `camIdeal`, `camReach`, `rearWas`) | a `ChaseCamera` per seat |
| one DOM HUD (`#hud`) | a HUD per seat, laid out in its part of the screen |
| lap times, best lap, WRONG WAY, rescue (R), the finish ding, rumble, the rolling sound | per seat |
| the items' "You" / "Your" lines (`items.js` `who`, `whose`) and sounds | per seat's name |
| rubber banding: every CPU measures its gap to `player` | to the leading human (the pack keeps the leader honest; trailing humans get the better spells) |
| results: one row marked "you" | every human's row marked |

Three more pieces of groundwork:

- **A race that ends without reloading the page.** Restart, Next track and Main menu all set
  `location.search` today, which reloads the page. Joined controllers and, above all, network
  connections live in the page, so a race must be started and torn down in place (its scene,
  GPU memory, listeners, timers).
- **A fixed simulation step.** The race advances by the frame's `dt` (clamped to 0.05 s), so a
  kart on a 144 Hz screen takes different collision steps from one on a 60 Hz screen. Racing
  online needs every machine to simulate the same way: physics at a fixed 60 steps a second,
  drawing in between. Separating "simulate" from "draw" is also what lets split screen draw the
  same moment from four cameras.
- **One random seed per race.** NPC placement, fights, weather and spell rolls use
  `Math.random()` (about 50 places). With a seeded generator, every machine in an online race
  builds the same race from the host's seed — the same raid, the same rain — without sending
  any of it over the network.

---

## 2. Split screen (local, up to four players)

**Layouts.** One player: full screen. Two: one view above the other (wide views, as the classic
kart racers did it; side by side as an option). Three and four: quarters; with three, the
fourth quarter shows the course map with every racer on it. Thin dividers in the front end's
gold trim.

**Drawing.** One renderer, one scene; for each seat, `setViewport` / `setScissor` to its part of
the screen, its camera (aspect from its rectangle), `render`. Everything that follows "the"
camera today is set per view before that view is drawn: the sky dome, the rain / snow box, the
rule that hides a kart right in front of the lens, effect sprites that face the camera.

**Performance — measured, not guessed.** Draw calls per frame for one view (2026-11-24, a race
a few seconds in, the game's own scene with each part hidden in turn):

| Track | Total | Creatures (NPCs) | Zone | Karts |
|---|---|---|---|---|
| Veeshan's Peak | ~1,300 | ~720–800 | ~35 | ~50 |
| North Karana | ~1,950 | ~1,350 | ~70 | ~70 |
| Butcherblock | ~2,050 | ~1,400 | ~80 | (noise) |

On the user's machine the desktop app's log shows 60–100 fps for one view at 1080p, North
Karana at the bottom (~62 fps with ~1,900 draw calls). Each extra view costs about a whole
frame's draw calls, so four views of North Karana as it stands would be ~7,800 draw calls — far
too many. The zone itself is cheap (its pieces are already culled to what the camera sees); the
**creatures are two thirds of the cost**. The plan, in order of payoff:

1. Each creature drawn in as few pieces as possible: merge a model's parts that share a texture
   at export (a creature is many small skinned pieces today).
2. Per view, skip creatures past the fog (they are drawn now even where the fog hides them) and
   past a distance where they are a few pixels tall; with three or four views, bring the fog and
   the far clip in (the classic kart racers did exactly this).
3. A render-resolution setting per view count (the Options' render resolution already exists).
4. Measure again on the user's machine after each step; the target is 60 fps with four views.

**Controllers.** A "press A to join" step: each device that presses joins as the next player (the
keyboard can be one player). Each player's rumble on their own pad. A pad that disconnects
mid-race pauses the race and asks for it back.

**Front end.** Main menu → number of players → class (50cc / 100cc / 150cc) → one racer panel
per player (each player turns their own carousel; only the racers near each selection are
built, as now) → track or cup, chosen by player 1. Campaign for two to four players: every human
scores points; standings and the podium show them all.

**Race.** The intro flyover plays full screen once (any player can skip), then the screen splits
and each player's camera drops in behind their kart. Start from any player pauses everyone.
Humans start at the back of the grid, as one player does now.

**Sound.** One listener: sounds in the world are heard from the nearest player's camera; each
player's own kart is mixed lower so four engines do not drown the race; the music once.

---

## 3. Online

### Who runs the race

| Approach | Verdict |
|---|---|
| A dedicated game server that simulates every race | **No.** The race cannot be simulated without the zone's geometry (walls, floor, road), which is built from each player's own EverQuest files. A server would have to hold EverQuest data — which this project never ships or hosts — and would cost money for every race. |
| Lockstep / rollback (fighting-game netcode) | **No.** It needs every machine's simulation to match bit for bit (BVH raycasts against the zone, floating point across machines) and either adds input delay or re-simulates eight karts against the zone on every correction. Kart racers do not use it. |
| Peer to peer, every machine sends to every other (mesh) | Works for eight, but 28 connections, and every one that fails to get through a home router breaks the race. |
| **Peer to peer around the host (star)** | **Chosen.** Each player connects to the host only. Each machine drives its own kart; the host decides everything shared. This is how console kart racers run their online races. |

### Who decides what

- **Your kart: your machine.** Your kart is simulated exactly as in single player — no input
  delay, ever. It sends its state about 30 times a second: position, velocity, heading, steering,
  drift state, turbo, spin-out, item held, progress, lap (~60 bytes).
- **Other karts: drawn from their messages.** Extrapolated from the last state by its age and the
  connection's delay (velocity and turn rate), the drawn kart eased toward that point (no
  teleports below ~15 units). Bumps: each machine pushes only its own kart away from the others.
- **CPU racers: the host** runs their drivers and sends them like any other kart.
- **Spell gems:** a pickup is claimed by the picker and confirmed by the host, which rolls the
  spell (by race position, as now) and respawns the gem for everyone.
- **Spells:** casting is an event to everyone with a spell id and its starting point. A flame
  bolt follows the racing line, so every machine flies it the same way from the same start; a
  hit by a bolt or a whirl is decided **by the machine of the kart that was hit** (it alone knows
  exactly where its kart is — what you see is what hits you). Spells with a target (Snare: the
  kart ahead; Lightning: the leader) are decided by the host at the moment of casting.
- **Race order, laps, finish:** each machine reports its own laps; finish times are taken on the
  racer's own machine in the shared race clock, so a lag spike never costs a place; the host
  publishes the final order.
- **The clock:** the host starts the countdown at a moment in its own time; each player knows the
  offset to the host's clock from a few ping exchanges, so "GO" lands at the same moment
  everywhere. Loading: the host waits until every player has loaded (with a time limit), then
  everyone's intro plays locally.
- **No pause online** — Start opens the menu over a race that carries on, as online racers do.
- **A player who drops:** their kart becomes a CPU on the host. If the host drops, the race ends
  for everyone (moving the host to another machine can come later, if it is ever needed).

### The connection

- **WebRTC data channels** — built into Electron's Chromium (and into the browser build), they
  get through most home routers on their own, and they are encrypted. Two channels per player:
  one unreliable and unordered for kart states (a late state is useless — the next one is
  already coming), one reliable and ordered for events (lobby, spells, hits, laps, finish).
- **Bandwidth:** a player sends ~2 KB/s. The host relays every kart to every player: with eight
  karts about 100 KB/s (under 1 Mbit/s) of upload, fine for a home connection.
- **Playable latency:** up to about 150 ms round trip (the same continent), because your own kart
  never waits for the network.
- **A small lobby service** — the only server. It lists open lobbies, hands out room codes, and
  passes each connection's setup between players until they are connected; then it is out of
  the race. It carries a few kilobytes per player and **no game data at all**. Its code lives in
  the repository (a small Node.js WebSocket server), so anyone can run one; the game's options
  hold its address.
- **Getting through strict routers:** most players connect directly (STUN: a public service
  tells each machine its outside address). For the remaining ~10–15% (strict NAT, some mobile and
  carrier networks) a relay (TURN) forwards their traffic: coturn on the same small server, or a
  hosted TURN service.
- **LAN:** the host's own app runs the lobby service on the local network and the others join by
  its address (or find it on the network) — no internet needed.
- **Privacy:** as in any peer-to-peer game, players in a race can see each other's IP addresses;
  forcing the relay hides them, at a little extra delay. Messages from other players are
  checked (sizes, ranges) before use.

### Each player built the game from their own files

Two players' builds can differ: another EverQuest client version (a Project 1999 install and a
current one do not have identical zones), or another EverKart version. A race only works if
everyone drives on the same road, so:

- the build writes a fingerprint of each track (a hash of its track data and its zone's collision
  geometry) and of the racer list;
- joining a lobby exchanges the EverKart version and those fingerprints;
- the host can only pick tracks every player has with an identical fingerprint; any other is
  shown greyed out with the reason ("Oasis of Marr: a player's copy was built from a different
  EverQuest version");
- a racer one player lacks is shown on that player's screen as a stand-in;
- **no EverQuest data is ever sent between players.**

### The lobby (front end)

Main menu → **Online** → *Host a race* / *Join with a code* / *Browse races* (public lobbies and
LAN races). The lobby screen: each player's name, racer, ping and ready state; the host picks the
class, track (or cup), laps and whether CPU racers fill the grid; Start when everyone is ready.
After a race, back to the lobby (track voting later). A player name in Options; no accounts.
Two players on one machine can join an online race together (split screen + online).

---

## 4. Order of work

1. **Groundwork** — seats; the race started and ended without a page reload; the fixed
   simulation step; the seeded random generator.
2. **Split screen, two players** — end to end: join, class, two racer panels, track, race, results.
3. **Three and four players** — the layouts, then the performance work above, measured on the
   user's machine at each step.
4. **Online core** — the network layer (WebRTC, the lobby service, a lag / packet-loss simulator
   for testing on one machine), host and join by room code, two players racing, CPUs from the host.
5. **Online racing complete** — spells and hits, finish order, players dropping, the track
   fingerprint check.
6. **Online polish** — public lobby browser, LAN races, online cups, split-screen players online.

**Testing:** split screen with a test page that fills the other seats with CPU drivers; online
with two app windows on one machine (`--windowed`) through the lag simulator, then two machines.
The user play-tests each step in the desktop app, as with everything else.

**The one decision that needs the user:** where the public lobby service runs (a small hosted
server — a monthly cost and an account — or a free tier of a hosting service). LAN and
direct-address play need nothing.
