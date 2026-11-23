# EverKart — Roadmap

**Race through Norrath.** A kart racer through real EverQuest zones. Read this before
touching anything — it is the design north star and the record of what the user expects.

---

## 1. Vision

The player should feel like they're *in EverQuest*, not in Mario Kart wearing an
EverQuest hat.

> **The racing is kart racing. Everything you see and hear is EverQuest.**

- **Racing:** a proper arcade kart racer — the standard every commercial kart game meets.
- **Everything else:** the zone's real geometry, textures, lighting, objects, inhabitants,
  sky and music. A screenshot of the Veeshan's Peak track should make an EQ player say
  *"that's VP — there's Hoshkar's lair"*.

Not doing: recreating Mario Kart (no Nintendo characters, art, items or music); shipping any
EverQuest data (each player builds the game from their own EverQuest files); EQ simulation
(NPCs are scenery that *looks* like EQ gameplay).

---

## 2. The quality bar (what "done" means)

These are the user's expectations. Meet them by default — the user should never have to ask.

### A kart racer, built the way kart racers are built
- **A defined track:** a modelled road surface you can always see, clear edges (kerbs),
  continuous barriers or the zone's own walls along the whole course — never stubs, gaps,
  random fence pieces, or a road that fades into the ground.
- **A smooth surface:** no jolts, steps, seams, bumps, or geometry poking through; banking
  and slopes that flow.
- **Clean geometry:** nothing sliced, stretched, floating or z-fighting; no zone object in the
  road; architecture (arches, columns, door frames) intact and passed through cleanly.
- **Kart mechanics:** drifting and mini-turbos, items, off-road slowdown, rubber-banded CPU
  racers that stay in the race, a chase camera that never pops or clips, a clean start
  (no rescues, no camera glitches on the grid).
- **Presentation like a commercial kart game:** a pre-race track flyover that shows the course
  and its sights, a smooth dolly down the starting grid into the chase camera, skippable; no
  text describing scenes; nothing that looks like a weekend game jam.

### EverQuest, accurately
- The zone looks like the zone (light, fog, sky, music).
- The route is one an EQ player knows (VP: zone-in → Hoshkar's lair → the pillow room →
  Phara Dar's lair).
- Inhabitants are the zone's own, where they really live: named NPCs at their real spawn
  points (Brewall's maps) in their own looks; common mobs in their areas (P99 spawn maps).
- **Off-track life (the Sega touch):** things happening beside the track that look like real
  EQ gameplay — a raid of 18 well-geared players on a dragon, a monk training a pack of mobs
  down a hallway (not in circles through walls), named dragons breathing fire.

### A professional project
- Top level: README, ROADMAP, CLAUDE.md, `.gitignore`, `Everquest/` (the player's EverQuest
  files) and the project's folders. No leftovers from abandoned directions.
- The user plays the packaged desktop app (Start menu → Games → EverKart). Nothing is done
  until it is in that app and the user has driven it.

---

## 3. Current state (2026-11-22)

- **Veeshan's Peak is the reference track** — waiting for the user's play-test of the
  2026-11-23 01:53 build. Point to point, ~10,300 units: zone-in platform in the lava cave →
  the octagon hall (one paved junction where the way back leaves through the north-west door)
  → down into Hoshkar's pit, a stone causeway over the lava, the roundabout round Hoshkar's
  island on its own raised deck, back out on the same road → the diamond hall (a monk training
  racnar down its south aisle) → the pillow room (the raid on Silverwing) → the winding
  passages through two door frames → the finish in Phara Dar's lair, Phara Dar facing the
  racers head-on.
- **The track surface (all tracks):** a road ribbon in a zone floor texture laid in the zone's
  own coordinates (no seams where stretches meet), lit by the zone's baked light; each edge out
  to its own wall (the planner's free floor on that side, up to ledges, drops and the footprints
  of columns and lava); banded kerbs in the zone's trim, never across another stretch of road;
  a low wall in the zone's stone along both edges, broken only where the track joins or crosses
  itself; forks paved as one junction; the line's bends rounded at every scale (no kinks). The
  zone's ground is shaped to sit just under the road. Off the road you slow to 60%.
- **The race intro (all tracks):** a flyover — drone runs down the road past the course's
  sights, in course order (dragons breathe as it passes) — then one crane move over the grid
  into the chase camera. The course's name in the corner, no captions over scenes; skippable.
- **The front end (2026-11-22):** a title screen, main menu, racer carousel, track cover flow,
  campaign (four cups, standings, podium, trophies), options and loading screens in one designed
  style over a 3D showroom of the real karts and drivers (P2). Every racer re-seated as a kart
  driver from its own stance.
- **The other 13 tracks** get all of the above automatically. Deep review (2026-11-22, P3): the
  road's width rules were fixed for every track (walls exact to a unit, hillsides cut into,
  placed objects and low overhangs stop the road), and each track's road, kerb and barrier
  textures were chosen from its own zone. Narrow stretches left (path points under ~8 a side):
  Temple of Veeshan, Kael, Faydark, Hate 1 each; Nektulos 14; Mischief 23; Unrest 21; Fear 78;
  Growth 101; Oasis 110; Lavastorm 159; Everfrost 211 — mostly real terrain (a ridge, a gap
  between rocks, a ledge path) where the route itself has to change. Crushbone was dropped
  (user, 2026-11-23) for a Karana track and a Commonlands track (P3).
- **New: Butcherblock Mountains** (2026-11-22) — a lap of ~11,000 along the zone's own dirt
  paths: the shore below the docks, south, east to the giant dwarf statue at Kaladim's gate,
  back west along the southern path and up the central valley; its orcs, dwarves and wildlife
  placed. Waiting for the user's play-test.

---

## 4. Open work (in order)

### P1 — Veeshan's Peak to the bar (user play-test → fix → repeat)
- [x] **Play-test of the 08:30 build** (user, 2026-11-22), fixed at the source, waiting for the
  next drive:
  - *Lock-up:* the race loop died on the first turbo or spin-out ("rumble is not a function":
    the kart's rolling sound hid the controller-rumble call). Fixed, and the race loop now
    logs any unexpected error and carries on instead of freezing.
  - *Rubber banding:* a CPU far behind got at most +16% top speed but still slowed for every
    bend to a fixed speed, so on a twisty track it never closed. Now: up to +30% top speed
    (Journeyman; Apprentice +21%, Master +38%), quicker acceleration and faster cornering the
    further behind it is; ahead of you it eases off. Checked: 440 units ahead, the pack closed
    the gap in ~5 s.
  - *Narrow road:* the floor measure stopped at sloping floors (sampled to whole units, a
    gentle slope looks like small steps) and at stairs. Fixed: three long narrow stretches
    (up to 190 units at 4 wide) are full width. Left narrow by the zone itself: the north-west
    doorway of the octagon hall (posts). The pillow room's sunken aisle between the dragon
    beds' platforms: the user chose a raised bridge → built (`bridges`): the road rises from
    the room's floor onto its own deck at the platforms' height, 52 wide with walls, and runs
    level across onto the upper floor.
  - *Racers:* faces / arms / legs and how they sit. Now: a steering wheel in every kart,
    each racer's arms solved so both hands hold it (the wheel goes to the hands); a low seat,
    legs stretched ahead in the tub; the head held as it is standing (level, looking ahead -
    hunched stances had tipped it up or down).
- [ ] User play-test of the 2026-11-23 01:53 build; fix everything found at its source.
- [x] **Intro cinematic** (built 2026-11-22, waiting for the user's drive) — a flyover down the
  course past its sights (Hoshkar, the statue hall, the pillow room, Phara Dar at the finish),
  then one crane move over the grid into the chase camera. Replaced the static zone shots and
  the pair-by-pair grid pan, which the user rejected as far below the bar.
- [x] **The octagon junction** (built 2026-11-22) — the hall is one paved junction: the trunk
  wall to wall, the way in (north ramp) and the way back (north-west door) parting at one nose.
  The way back leaves through a narrow doorway between two posts and a raised platform: a
  single-lane gate (~12 wide). Ask the user whether it is too tight.
- [ ] **Phara Dar's look** — texture set 6 (black, purple wings) is a guess; confirm.
- [x] **Hoshkar's roundabout, done properly** (built 2026-11-22, waiting for the user's drive):
  the whole out-and-back stretch from the second octagon to the island is built once (the way
  out is the way in reversed: one full-width road, drawn once); a stone causeway at the ring's
  height; an exact elliptical ring round the island on its own raised deck (road, kerbs and
  walls both sides, sides into the lava), the road meeting it at a paved mouth aimed at the
  island's centre; once round anticlockwise, back out.
- [x] **Dragons face the right way** (user; done 2026-11-22, waiting for the user's drive):
  a named NPC can face the racers coming at it (`face: "racers"`: back down the course) or a
  point (`face_at`). Phara Dar faces straight down the final stretch, over the finish arch;
  Hoshkar faces the causeway the karts arrive on.
- [x] **Breath from the mouth** (user; done 2026-11-22, waiting for the user's drive): the
  mouth is found from the model itself (the lower jaw's tip and the upper snout's tip, over
  every piece of the dragon), the fire starts just inside between them and goes out along the
  snout, following the head as it moves.
- [ ] Common VP mobs where they live (racnar, lava drakes, guardian wurms) from the P99 spawn
  map (the Project 1999 wiki's Veeshan's Peak spawn map, registered like the route map).

### P2 — The front end: a game studio's start screen (user, 2026-11-22)
Built 2026-11-22 (`game/src/frontend/`), waiting for the user's look:
- [x] **One look for every screen outside the race** (user) — ember-dark glass panels, gold
  trim, Cinzel titles, Alegreya Sans text, over a 3D showroom of real karts and drivers; the
  race's results and pause screens take the same look.
- [x] **Title screen** — the logo over the showroom, the racers turning by on the turntable,
  "press any button"; main menu: Single Race, Campaign, Options, Quit.
- [x] **Stage select** — a cover flow of the tracks: picture, name, zone, laps, length, racers,
  cup. Its pictures are old screenshots (the old road): retake them (`game/tools/previews.sh`).
- [x] **Options menu** — Video (fullscreen / window, render resolution, race intro), Audio
  (music, effects), Racing (rivals: Apprentice / Journeyman / Master, laps, minimap),
  Controls (the bindings). Kept between sessions. Not yet: rebinding keys.
- [x] **Campaign** — four cups (Antonica, Faydwer, Planes, Dragon), the same seven rivals all
  cup, 10-8-6-5-4-3-2-1 points, standings after each race, a podium, gold / silver / bronze
  trophies kept.
- [x] **Character select as a carousel** — one turning row of the real racers in their karts,
  the selected one on a lit turntable; hold left / right to run through the list (faster the
  longer it is held), up / down for armor, R / Y random. Only the racers near the selection are
  built, so the list can be as long as the models allow.
- [x] **Every character right** — every racer is seated the same way, from its own standing
  pose (`tools/eq_chr.py` `_seat`): the spine sat upright (a hunched or crouching stance too),
  the head held as it is standing (level, looking ahead), each leg solved so the feet stay
  inside the hull (low seat, legs stretched ahead), each arm solved so both hands hold the
  steering wheel (the game puts the wheel at the hands); placed by its hips on the seat and sized by the body above them
  (EverQuest heights, eased so an ogre and a gnome both fit). Faces the right way up and
  looking ahead. Checked racer by racer (`game/tools/racer_sheet.mjs`). Left: the Lord of
  Hate's cape hangs through the back of the kart; seen dead ahead, a few racers' feet show
  under the prow (Iksar, Kerran, Human female); the racers sit still (no idle animation in the
  kart yet).
- [ ] **A bigger racer list** — more of EverQuest's humanoid NPC models as racers (every zone's
  `_chr.s3d`), each checked on the racer sheet.

### P3 — Every track to the bar (the VP recipe: docs/TRACK_GUIDE.md)
- [ ] **Play-test 2026-11-23** (user): never narrower than ~two karts anywhere (Everfrost,
  Nektulos, Oasis named); item boxes sitting under the road or floating above it; Everfrost's
  grid putting racers off the road; skies wrong in some zones; random rain and EverQuest's other
  weather.
- [ ] **Play-test 2026-11-23, life beside the track** (user): roaming creatures walk onto the road
  and sink into it - keep every creature off the road; the off-track life is generic, boring and
  repetitive - make it varied and specific to each zone; arm and armor the fighters properly
  (armor sets, varied weapons and shields).
- [ ] **A full deep review of every current track** (user, 2026-11-22, next after the pillow
  room bridge): each one checked against the quality bar and fixed, not just a glance.
  - [x] Road width at the source, every track (see the feedback log, 2026-11-22).
  - [x] Road / kerb / barrier textures from each zone (Oasis: stone from its ruins, not a green
    road in the desert; Everfrost: packed dirt with ice kerbs and Halas stone; Nektulos and Fear
    lost a tree-trunk and a fire-gradient barrier).
  - [x] Zone poking through the road (road_check): Oasis's bandit tent (26 spots) gone.
  - [ ] Each track's remaining narrow stretches (route changes), Nektulos's 4 pokes by a stone
    house (~811), Fear's 9 (~1107); then each track's intro and scenes.
- [ ] **New tracks** (user, 2026-11-22, after the review): find other zones that would make good
  tracks and start building them (the recipe: docs/TRACK_GUIDE.md).
  - [x] Shortlist: outdoor zones with roads and landmarks suit a kart track best (Butcherblock,
    the Karanas, the Commonlands, Kithicor, Steamfont); dungeons are often too narrow.
  - [x] **Butcherblock Mountains** — in the game (Faydwer Cup), 2 laps of ~11,200: no narrow
    stretch, nothing poking through the road; the route keeps to the zone's path round the
    ridge east of the central valley (it had climbed 120 over it). Inhabitants from its own
    models: Crushbone orcs, Kaladim dwarves, brownies, aviaks, fire beetles, snakes, spiders,
    bats; orcs ambushing travellers, Kaladim's guards driving them off. Its fog and sky are
    estimated (pqdi.cc has no header for it).
  - [ ] Butcherblock next: a scene at the giant chessboard (south valley, ~(820, -2350): off the
    lap now) and the docks, its intro sights, then the user's play-test.
  - [ ] **Nagafen's Lair** (Sol B) — tried and parked: its passages are rivers of lava that drop
    ~20 in falls between levels (north cavern -109, the long hall -67, the lair 74), so the planner
    cannot link them; its side tunnels are 10-20 wide. It needs ramps built over each fall
    (`bridges`) and causeways (`plan_over`) before a route exists. Lord Nagafen: (-1395, -871).
- [ ] Per track: route check, road / kerb / barrier textures chosen from the zone, track
  surface checked down its whole length, intro flyover, then the user's play-test.
- [x] **Crushbone — dropped** (user, 2026-11-23): its ground is too cramped for the bar (about
  half the lap under 10 wide between the moat, 10-high banks and the orc huts; a loop round the
  hill meets a ~7-wide gap at the castle gatehouse). Removed from the game, the build and the
  cups; replaced by a Karana track and a Commonlands track (below).
- [x] **North Karana** (user, 2026-11-23: "ditch Crushbone for Karanas and Commonlands") — in
  the game (Antonica Cup): 2 laps of ~7,400 from the crossroads by the merchants, down the south
  road, across the plains past the druid circle, back along the diagonal west road. No narrow
  stretch, nothing through the road. Gnolls, hill giants, griffons, lions, wolves, centaurs,
  Qeynos travellers; a gnoll raid and a hill-giant fight beside the road. Its own music.
- [x] **East Commonlands** (user, 2026-11-23) — in the game (Antonica Cup): 2 laps of ~8,200
  from below the Freeport gate up the winding road, across to the east plain and back past the
  Nektulos turning. Three short stretches ~10 a side; nothing through the road. Deathfist orcs,
  the Freeport militia, travellers, pumas, wolves; an orc raid and the militia driving orcs off.
  East Freeport's music (the zone has none of its own).
- [ ] North Karana and East Commonlands next: the user's play-test; scenes at their landmarks
  (the druid circle and the Great Spires; the tunnel bazaar at the West Commonlands end); fog
  and sky values are estimated (no header on record).
- [ ] **Everfrost, Greater Faydark, Lavastorm, Oasis** — the audit (2026-11-22) shows long
  narrow stretches: Everfrost down a ledge with a sheer drop beside it, Faydark sunken paths
  between banks and a narrow ramp (~1068). Real terrain, but a kart track wants more room:
  check each route for a wider line.
- [ ] **Plane of Hate** — the lap got shorter under the new planner (1,204 units); check.
- [ ] **Plane of Growth** — a waypoint on a hillside was moved; check the new line.
- [ ] **Oasis** — the crocodiles now fight (their attack clips were never exported); check
  the intro shows them.
- [ ] **EQ-accurate inhabitants and off-track life, every zone** (docs/TRACK_GUIDE.md part B).

### P4 — Racing feel
- [ ] Rubber banding tuned by play-test (now: +16% top speed far behind you, −13% far ahead).
- [ ] CPU racers on shared two-lane roads and crossings (VP) — keep to their lane.
- [ ] Physical controller test; options menu.

### P5 — Stability
- [ ] **Hard lock / crash** reported by the user — play the new build, send the newest log
  (`~/.config/EverKart/logs/`). The zone's road-shaping now keeps ~2.4x fewer triangles,
  which may have been part of it.

### P6 — Later
- [ ] Ambient: zone emitters (`<zone>.emt`, `EnvEmitterEffects/`), zone sound effects.
- [ ] More spells as items (`ITEM_SPELLS` in `tools/export_spellfx.py`).
- [ ] Licence for the code (the user's choice).

---

## 5. Feedback log (what the user said, and what was done)

### 2026-11-23 — play-test: narrow spots, item boxes, Everfrost's grid, skies, weather
- "Some tracks are still too narrow in spots - check Everfrost, Nektulos Forest, Oasis; the track
  should never randomly narrow to only one kart wide" → fixed at the source, every track: the
  road is never under ~20 across where the ground allows it (a side the easing cut back for a
  narrow spot nearby gets its room back; a side with room makes up for one without, eased in
  and out); the road's bed now fills up to 20 (an embankment along a ridge or across a slope -
  Everfrost's ridge roads); the width measure reads the zone's own ground where the planner
  holds none (Oasis's dunes, steeper than the planner drives) and finds floor up to 20 from a
  line smoothed onto a slope. Everfrost's narrowest spots went from ~4 across to 14-19, Oasis's
  dune neck from 4 to full width, Nektulos 815 from 10 to ~20. Left: Nektulos ~521 runs through
  a structure (route change).
- "The power-up squares are sometimes under the track or too high above it" → open.
- "Everfrost starts some racers off the track" → open.
- "The sky is still wrong in some zones" → open.
- "Add rain to randomly happen, and other weather effects from the game" → open.
- "Creatures that roam onto the track clip under the road; they should be on top of it if they
  are on the track at all - which I don't think they should be, and they are in many tracks" →
  open: nothing should roam onto the road.
- "The stuff going on off track is still way too generic, boring and repetitive" → open.
- "The creatures need to be equipped better: more armor, different weapons, etc." → open.
- "About 20% of the weekly quota left: make getting the repo up on GitHub the priority, plus the
  fixes in progress" → the repository published (github.com/Ekco-S64QTN6/EverKart) with the
  road-width fixes; the rest of this list is next.

### 2026-11-23 — "Let's ditch Crushbone for Karanas and Commonlands"
- Asked to choose for Crushbone (a boardwalk along the moat, or replace the zone) → replace it.
  Crushbone removed from the game, the build, the cups and the docs; a North Karana track and
  an East Commonlands track are being built in its place (P3).

### 2026-11-22 — "Veeshan's Peak still has random parts of the track screwed up"
- "In Hoshkar's lair on the way out you can see through the floor into lava while merging back"
  → the road to the ring stopped short of the ring's curved edge (a lava wedge between them).
  Fixed: its last cross-section runs on into the ring's band under the ring's road.
- "Going left at the bridge the track randomly narrows - I guess because an NPC is standing
  there on the right, but it's narrow on the left instead of extending all the way to the
  cavern wall ... same with all zones if they have this same logic" → not the NPC (NPCs never
  shape the road): the cavern wall was beyond the 48 the walls were measured to, so that side
  was capped as open ground, and an S-bend in the racing line jogged the 36-wide edge. Fixed for
  every track: walls measured to 60, a side reaches its wall (up to 46), the line's bends rounded
  to 50, cross-sections square to a smoothed heading, edges smoothed in the world and never
  folding; the floor measure stops at walls (posts) only and steps over sampling gaps and low
  branches (Nektulos, Fear, Oasis, Everfrost, Lavastorm, Growth, Crushbone all had long
  stretches squeezed to a 4-wide road by it).
  Then, in the deep review (all tracks): the floor measure now finds walls exactly (every wall
  face of the zone to a unit, at kart height - a tree trunk no longer closes the 4-unit cell
  under the line, which had pinned Faydark, Oasis, Everfrost and others to a 2-wide road), counts
  all floor the zone has (also beside lava and under a low branch), ignores one stray sample,
  and lets the road take in a low dais or kerb beside the line (the Temple of Veeshan's raised
  floors had pinched its road to 2 in five places; none left). On hillsides the road is now a
  shelf cut into the slope (the side rays had taken any rising ground for a wall: Lavastorm's
  narrow points 360 → 159). Placed objects stop the road whatever their slope (Oasis's bandit
  tent had stood across half the widened road). A two-kart minimum that never did anything was
  removed; a "centre the line" pass was tried and deleted (it made lines wiggle).
  `game/tools/width_stages.mjs` shows why any stretch is the width it is.

### 2026-11-22 — the pillow room aisle; the next steps
- Narrow aisle between the pillow room's platforms → the user chose a raised bridge.
- "After that do a full deep review of each current track making sure it's up to our standards
  now, then look for other zones that would make good tracks and start working on those." → P3.

### 2026-11-22 — play-test of the 08:30 build
- "Parts of the Veeshan's Peak track get very narrow for no reason."
- "I randomly locked up and crashed."
- "The rubber banding isn't working: I was able to get 1st place and just stay way ahead of the
  other racers the entire time, making it very boring. Rubber banding is a well-known thing in
  all kart racing games."
- "The models' faces / arms / legs are weird for some racers, and their position sitting in
  the cart is weird."

### 2026-11-22 — the front end; the GitHub repository
- "A more professional game studio designed start screen, with options menu, campaign setting,
  character select." Character select: not a wall of slots but one rotating row — hold left or
  right to cycle to new models — so the list can be as big as possible; every character must
  animate correctly, sit in the kart correctly, face the right way up and look the right way.
  → P2. The droppable-gear idea is dropped from the roadmap.
- "Stage select screen being better designed as well; the whole game's style could be improved,
  from settings to campaign to character select to level select - all the menus outside of
  actually playing." → P2 (one style for every screen outside the race).
- GitHub repository set-up: .gitignore, one clearly named folder for the player's EverQuest
  files, a Linux install and a Windows installer, a proper README → done (see README, docs/INSTALL.md).

### 2026-11-22 — "update the AppImage so I can test"; "continue fixing the state of the project"
- Hoshkar's roundabout (in and out on one very wide road, a ring round his island on its own
  raised deck, no kerb lines running into each other) → built; the whole out-and-back stretch
  is one road; the mouth paved.
- Dragons facing the right way, Phara Dar head-on at the finish → `face` / `face_at`; breath
  from the centre of the mouth, out along the snout → found from the model's jaw and snout.
- Found on the way, fixed at the source: the road was squeezed to its minimum wherever another
  stretch ran nearby (forks, the road's own bends) → each edge now goes to its own wall; a fork
  is one paved junction; kinks in the line (a 24° turn in 12 units at the pit ramp) were missed
  by the corner rounding → bends measured at every scale; kerbs ran across other roads → left
  out there; road textures met with seams → laid in the zone's coordinates.
- Intro → rebuilt as a flyover + crane move (§3).

### 2026-11-21 — "every aspect is half done with bugs"
- Texture dirt and overlap on every track; Crushbone huts in the track, broken geometry;
  Veeshan's Peak far below the bar → rebuilt along the user's map (point to point, Hoshkar's
  roundabout, the pillow room, Phara Dar). Planner fixes found on the way: long ramps had
  holes in the floor grid; routes cut corners between blocked cells; architecture was cleared
  or driven through; non-solid lava was driven under; a hidden plane could win the floor vote.
- "A karting game needs a defined track, a smooth surface, rubber banding" — the bare-zone-
  floor experiment and the generic split-rail fences were rejected ("random fences not even
  connected", "weekend game jam"); replaced by the track surface in §3.
- Start bug: sitting still at the start, a thud and a jump every ~6 s (the "stuck" rescue
  applied to the player) → fixed. Camera popping in and out at the back of the grid (the
  camera snapped to walls and back) → fixed: it pulls in at once and eases out; VP's grid moved
  off the zone-in pedestal.
- Rubber banding → added. Intro: no scene captions, camera further back, skip works (Start
  used to pause) → done; the intro as a whole is still not good enough (P1).
- Characters properly equipped → EQ weapons and shields on the hand bones, fight styles.
  Model animations wrong → monsters had no attack clips of their own exported; fixed.
  Oasis crocodiles not shown → they could not attack; fixed, to be checked.
- Monk training racnar ran in circles through a wall → now runs a planned route down a hall.
- Log file for crashes → every desktop session writes one. Hard lock → open (P5).
- GitHub prep → `Everquest/` folder for the player's EverQuest files, tools read from it;
  no EQ data, generated data or prototype leftovers in the repository.
- Gear progression via EQ's inventory window → idea recorded; dropped by the user 2026-11-22.
- Process: the user plays the packaged app — today's fixes did not reach them for hours because
  the app was not rebuilt. Now: rebuild before handing over (CLAUDE.md).

### 2026-11-16 — first play-test (done)
Smooth road bed instead of a copy of the ground; upside-down BMP textures; zone brightness,
fog and view distance from the zone headers; Plane of Growth intro; Temple of Veeshan's
dragons (colours, breath); Plane of Hate route; CPU racers (speed, braking, drifting, spell
use); race intro (grid, zone scenes); animated textures; readable spell effects; Crushbone and
Unrest tracks; music for zones without their own; drift input buffering; Lavastorm and
Crushbone routes; stable routes; EQ sound effects; menus for 14 tracks; NPCs kept off the road.

---

## 6. Technical notes

- **Axes:** EQ is x east, y north, z up; the game is y up: (x, y, z) → (x, z, −y). EQ map
  files (Brewall) store points as (−y, −x, z) of the world.
- **Units:** EQ units throughout (a human is ~6 tall). Kart top speed ~80 units/s.
- **Lighting:** zones carry baked light in vertex colours; the game draws them unlit as
  `ambient + vertex colour × gain` (`ZONE_LOOK` in `game/src/world.js`). Karts and NPCs:
  ambient + hemisphere light. The road takes the zone's light under each point.
- **Collision:** the zone's visible solid polygons + invisible walls, the road and kerbs;
  foliage and passable polygons excluded. BVH raycasts (three-mesh-bvh).
- **Routes** (`tools/navgrid.py`, `tools/export_track.py`): the floor on a 4-unit grid
  (multiple levels); a cell is blocked where walls reach kart height, the ceiling is low, an
  architecture object stands (arch legs, columns, frames, statues, beds — their footprints),
  or the floor lies under lava / water (avoid textures; except a `plan_over_box` causeway).
  Steps up to 7 (or `step_up`), drops to 12; no diagonal moves past blocked corners. A*
  between waypoints prefers corridor centres; waypoints snap to the connected floor most of
  them share (ties: the upper floor — Oasis's hidden plane at z −262 loses). Open courses run
  start to finish; where the course comes back along a road it already took, each direction
  keeps right (two lanes).
- **Track surface** (`game/src/course.js`, `roadbed.js`): road bed = a straight cross-section
  (≤ 0.12 banking) fitted to the ground, smoothed along the track; road ribbon 0.3 above it,
  kerbs 0.35 higher, walls 2.6 high; the zone's ground under the road and kerbs is cut / filled
  to 0.7 below the bed (anything with something beneath it — roofs, platforms, arches — is
  left alone beside the road); triangles stay split only where they moved.
- **Characters:** skeletons posed from any frame; borrowed animations keep the borrower's
  bone lengths; a model missing clips borrows them per clip from one with the same bones.
  EQ animation codes: C01 kick … C11 round kick, T04–T06 casting (T06 dragon breath),
  T07–T09 monk strikes, L01 walk, L02 run, P01 stand, O01 fidget, P03 shuffle.
- **Spell effects:** `spellsnew.eff` 268-byte records; `spellsnew.edd` 416-byte emitters
  (layout per OpenEQ's notes).
- **Music:** XMI → MIDI (60 PPQN at 120 bpm) → FluidSynth + FluidR3_GM.

---

## 7. Track roster

| # | Zone | Course | Inhabitants | Music |
|---|---|---|---|---|
| 1 | Temple of Veeshan (NW wing) | lap: corridors and octagon junctions | dragons, drakes, wurms | `templeveeshan_1` |
| 2 | Kael Drakkal | lap: outer ring and the raised arena | Kael giants, ice wolves | `kael_3` |
| 3 | Greater Faydark | lap: forest, north leg under Kelethin | orcs, elf guards, wolves, unicorns | `gfaydark_4` |
| 4 | Oasis of Marr | lap round the oasis lake | crocodiles, dervishes, sand giants, spectres | `nro_2` |
| 5 | Everfrost Peaks | lap: ice canyons and the frozen plain | mammoths, wolves, polar bears, goblins | `halas_0` |
| 6 | Nektulos Forest | lap: cobbled S-bends under the pines | bears, wolves, zombies, spiders | `nektulos_0` |
| 7 | Lavastorm Mountains | lap between the lava flows | drakes, efreeti, fire goblins, snakes | `lavastorm_0` |
| 8 | Plane of Fear | lap round Cazic-Thule's temple | golems, tentacle terrors, scarelings | `innothule_2` |
| 9 | Plane of Hate | lap through Innoruuk's plaza | spectres, zombies, mimics, wisps | `neriakc_12` |
| 10 | Plane of Growth | lap round Tunare's tree | treants, unicorns, wolves, bears | `felwithea_0` |
| 11 | Plane of Mischief | lap through Bristlebane's garden | rats, bixies, unicorns, mimics | `rivervale_0` |
| 12 | Estate of Unrest | lap round the mansion | undead | `eerie_2` |
| 13 | **Veeshan's Peak** (reference) | point to point: zone-in → Hoshkar → pillow room → Phara Dar | Hoshkar, Silverwing (raid), Phara Dar, drakes, wurms, racnar | `templeveeshan_3` |
| 14 | Butcherblock Mountains (new, 2026-11-22) | lap ~11,000: the shore below the docks → the dwarven path south → east to the giant dwarf statue at Kaladim's gate → the southern path west → up the central valley | (not yet placed) | `butcher` |
| 15 | North Karana (new, 2026-11-23) | lap ~7,400: crossroads → south road → the plains past the druid circle → the diagonal west road | gnolls, hill giants, griffons, lions, wolves, centaurs | `northkarana_1` |
| 16 | East Commonlands (new, 2026-11-23) | lap ~8,200: below the Freeport gate → the winding road north → the east plain → past the Nektulos turning | Deathfist orcs, Freeport militia, pumas, wolves | `freporte_0` |
