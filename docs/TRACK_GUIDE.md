# Turning an EverQuest zone into a track

The complete recipe, worked out on Veeshan's Peak (`tracks/vpeak.json`, the reference track).
Two halves, both required:

- **A. The track works** — a route an EQ player knows through the real zone, built as a
  proper kart track: a smooth road in the zone's own textures, kerbs, continuous walls, nothing
  broken, no clutter in the way, architecture intact.
- **B. The zone is EverQuest** — the zone's look, its real inhabitants where they really live,
  its named NPCs, and things happening off the track that an EQ player recognises.

A track is done when every box in **Definition of done** (bottom) is ticked — the last one is
the user driving it in the desktop app. The quality bar is ROADMAP.md section 2.

---

## 0. Before you start

- The zone's files are in `Everquest/` (your EverQuest game files: `<zone>.s3d`, `<zone>_obj.s3d`,
  `<zone>_chr.s3d`, `<zone>.xmi`, `maps/<zone>_1.txt` ... — see `Everquest/README.md`).
- Dev server running: `cd game && npm run dev` (headless tests: `NO_HMR=1 npx vite --port 5199`).
- Know the zone as a player would: which entrance, which named mobs where, which rooms people
  remember. Ask the user for a reference map (EQ atlas / P99 wiki map) and the route they want.

## A. The track

### A1. Extract the zone
```bash
python3 tools/extract_zone.py <zone>        # work/zones/<zone>/ mesh, objects, materials
python3 tools/floorplan.py <zone>           # floorplan.png (floors by height) + floorplan.json
```

### A2. Plan the route on the zone
1. **Register the reference map onto the floorplan.** EQ maps are often rotated or mirrored and
   drawn flat (all levels on one sheet). Pick 5–6 landmarks you can see on both (rooms, octagons,
   junctions, a named spawn) and fit an affine transform (see VP: the atlas map was rotated 90°,
   residuals ~30–80 units — good enough to place waypoints, then check every room).
   Brewall map files (`Everquest/maps/<zone>_1.txt`) give exact points: a line
   `P x, y, z, r, g, b, size, label` is at **world (x, y, z) = (−y, −x, z)**.
2. **Look at the real geometry** where it matters:
   - `python3 tools/mapview.py route <track>` — the floorplan with the line and waypoints.
   - `python3 tools/mapview.py floors <track> x0 x1 y0 y1 --z lo hi` — floors with heights,
     lava in orange. Use it for multi-level places (a lair pit under a gallery, a corridor over
     another): **a flat map hides levels** — VP's map showed Hoshkar's pit joined to a corridor
     240 units above it.
   - `python3 tools/mapview.py objects <track> x0 x1 y0 y1 --z lo hi` — placed objects at kart
     height: architecture (orange: arches, columns, door frames, statues, dragon beds...) and
     clutter (yellow: rocks, crates, steam).
3. **Check connectivity before fighting the route**: if a waypoint "snaps" far away
   (`DEBUG_WP=1 python3 tools/export_track.py <track>` prints where each waypoint lands), its
   area is not connected to the rest — find out why (stairs taller than the step limit, a
   gap, a door frame) instead of moving waypoints around blindly.

### A3. Write `tracks/<track>.json`
Route keys (all optional except the first three):

| key | what |
|---|---|
| `zone`, `waypoints`, `half_width` | the zone, EQ (x, y) waypoints, road half width (22–24) |
| `open: true` | point to point (start → finish once), with `start_index` (grid length, ~22) and `runout` |
| `laps` | laps of a closed course |
| `wp_z` | per waypoint floor height (null = nearest) — multi-level zones |
| `step_up` | tallest step the planner takes (default 7). 12 where halls have stairs / raised floors: the road bed grades them into ramps |
| `avoid` | textures never routed over or under (lava, water): their floor is taken out of the planner's grid, solid or not |
| `plan_over`, `plan_over_box` | non-solid surfaces planned as a **causeway** (a stone deck over lava), only inside the box |
| `bridges` | `[{from: [x, y], to: [x, y], z, ramp?, half_width?}]` — a **raised bridge** where the zone's way is too narrow for a kart track (VP: the pillow room's sunken aisle between the dragon beds' platforms): the road leaves the floor on its own deck — a ramp up (`ramp` units, default 140), level at `z` (the platforms' height), down again if the far end is lower — full width, walls on both edges, its sides down to the floor; nothing of the zone under it is reshaped |
| `keep_objects` | extra objects that are architecture (door frames are already) |
| `min_floor_z`, `z_hint`, `level_room`, `steep_walls`, `smooth_open` | planner details (see export_track.py) |
| `course` | the track's look, from the zone's own textures: `road` (a floor texture: the road surface), `kerb` (a trim: the banded kerbs), `barrier` (a wall texture: the low walls along the edges); `road_bright` (light on the road); `barriers: false` (none — rare); the textures' scale is taken from the zone itself (`road_tile` etc. to override) |

Waypoint rules learned the hard way:
- **Through the middle of every door frame / arch** (objects `*FRAME*`, `*ARCH*`): one waypoint
  at the frame's centre. The road narrows to the opening; the frame stays.
- **Never on architecture**: a waypoint on a dragon bed or a column makes A* skirt it with a
  bulge. Put waypoints in the open, between things.
- **Raised floors** (~10–15 up) and stairs: `step_up: 12` lets the planner take them (the road
  bed grades them into ramps) — but check what is *on* the raised floor (VP's pillow-room
  platform has a lava moat): often the clean line is round it.
- **The start**: on an open course the grid is the first `start_index` path points; keep it on
  open, level road well clear of the zone-in's furniture (VP: 45 points), or the chase camera
  behind the back row ends up in it.
- **A road taken both ways** (out to a lair and back): give the way out the *same* waypoints as
  the way in; the exporter splits them into two lanes (keep right) and shares the road.
- **A roundabout** at a dead end: waypoints round the centre, anticlockwise for keep-right.
- **Over lava**: `plan_over` + a tight `plan_over_box`; the causeway is flagged only where there
  is no solid floor.

### A4. Export
```bash
python3 tools/export_track.py <track>      # route, lanes, causeway spans, grid, NPC/scene config
python3 tools/export_gltf.py <zone>        # zone: clutter cleared off the road, architecture kept
python3 tools/export_npcs.py <track>       # inhabitants, named NPCs' looks, raiders' gear
```
(`python3 tools/build.py <track>` does all of it, plus music.) Read the export output:
- `WARNING: no drivable route after waypoints [...]` / `doubles back near path point N` → fix
  the route; no warnings allowed.
- `N floor cells under M pieces of architecture taken out` — architecture blocked for planning.
- `objects cleared off the road` — only clutter (rocks, crates, steam, braziers) may be cleared.
  Check the names (`tools/mapview.py objects`); architecture in that list is a bug.

### Rules for the track (from the user — never break these)
- **Walls never break.** Continuous along both edges the whole way; the only openings are where
  the track itself joins or crosses another stretch of the track. A gap where "the zone's wall
  is the edge" is still a gap: the player drives off the track through it.
- **The road uses the full width available** — wall to wall in halls, corridors and caverns
  (the walls are measured out to 60; a side reaches its wall up to 46 out, `course.max_width`),
  the whole causeway over lava; capped only in open ground with no wall in reach
  (`course.open_width`, default 36 half-width). Nothing living narrows the road: NPCs stand
  beside it, never shape it.
  **Each edge goes out to its own wall**: the racing line is rarely in the middle of a hall, so
  the road has a half width on each side (`roadWL` / `roadWR`), each from the free floor on that
  side. An edge follows the wall beside it (it does not pull in for a corner further on), and
  narrows only where something stands on its side.
- **A narrow way is bridged, not squeezed.** Where the zone's way is too narrow for a kart track
  (an aisle between raised platforms, a gap between ledges) but there is room at another level,
  the road rises onto a bridge (`bridges`) rather than shrinking to single file.
- **A roundabout's mouth is one paved merge.** The road to the ring stops at the ring's outer
  edge and its last cross-section runs on straight into the ring's band under the ring's road:
  no lava (or floor) shows between them, whatever the angle the road meets the ring at.
- **A fork is one paved junction.** Where a road taken both ways splits (the way back leaves
  through a different door), the trunk and both branches are paved together across the whole
  junction; the branches part at a single nose with a wall between them. No kerb ever runs
  across another stretch of road (kerbs are left out wherever they would lie on one).
- **A road taken both ways is one road**, full width, kerbs only at its outer edges, drawn once
  (`shared` / `shared_later` in the exported track); the karts keep right on it. Never two
  separate lanes side by side.
- **No folds, no jogs:** the line's corners are rounded (`min_radius`, default 50 — about the
  widest road's half width) until the road and its walls never fold over on the inside of a
  bend, measured at every scale (1, 2 and 3 points either side): a short sharp kink folds a
  wide road as surely as a long tight bend. The road's cross-sections are square to the line's
  heading smoothed over a few points (an S-bend in the racing line does not swing a wide edge
  back on itself), and each edge is smoothed as a line in the world, never wider than its
  limits; where an edge would still fold it is pulled in a little and smoothed again round the
  spot - a curve, never a notch. The road's own bend is never "another road alongside".
- **Two stretches side by side** (a switchback, the legs of a hairpin seen across open floor)
  share the space between them with one wall between them back to back — never a sliver of
  floor between two kerbs.
- **Smooth and seamless:** the racing surface has no steps, seams, jagged textures or artifacts.
- **Low clutter does not shape the road:** rocks, crates, braziers, bones etc. are ignored by
  the planner and cleared off the road; architecture and trees are routed round.

### How the track is built (what you get from the course settings)
A kart track is a modelled road, not the zone's bare ground:
- **Road bed** (`game/src/course.js`): along the line, a straight cross-section (a little
  banking where the ground leans) fitted to the zone's ground and smoothed along the track.
- **Road surface:** a ribbon 0.3 above the bed in the `road` texture, at the zone's own
  texture scale, lit by the zone's baked light where it runs — it reads as the zone's floor,
  but clean, smooth and continuous. Karts drive on it. The texture is laid in the zone's own
  coordinates (as EverQuest lays its floors), so where two stretches meet or overlap — a fork,
  the mouth of a roundabout — the stones line up with no seam.
- **Road width** (per side): the nearer of the free floor on that side (`room_r` / `room_l`
  from the exporter) and the nearest wall at kart height (`race.js` `measure`: a wall face
  steeper than 60° or an overhang — never a hillside rising beside the road, which the road's
  bed is cut into). The free floor: out across the line a unit at a time while there is floor
  the road can be laid on — every floor the zone has counts, including floor the planner will
  not route on (round lava, under a wall's foot, under a low branch), within what the road's
  bed cuts (up to 20 above the road: along a hillside the road is a shelf cut into it) and fills
  (up to 20 below: along a ridge or across a slope the road is an embankment). Where the
  planner holds no floor (with `steep_walls` it leaves out slopes over 44°, like Oasis's dunes)
  the measure reads the zone's own ground (`GroundQuery`: any surface up to 60°). It stops at a step of more than 7 between neighbouring 4-unit cells (steeper
  than 60°: a ledge, a riser) — unless the floor beyond is within 5.5 of the road itself (a low
  dais or kerb beside the line, or the line climbing onto one) — at the footprint of a column,
  statue or lava pool, at a wall face at kart height (exact to a unit, from every steep triangle
  of the zone: `WallMap` — posts, tree trunks, the cavern wall; never the planner's coarse
  4-unit cells, where one trunk would close the cell under the line), at any part of a placed
  object at kart height whatever its slope (a tent's canvas: the road's bed never reshapes an
  object — `planner.npz` marks object triangles, `tri_obj`), at floor under something lower
  than 7 (a rock slab, a low roof; a high branch is fine), or at two cells in a row with no
  floor at all. One stray sample of the floor beside the line does not count (the middle
  of three neighbours is taken). Then: eased along (an edge moves in and out by at most ~2 units
  per path point: round a tree or a post and straight back out), never wider than the floor
  allows — and **never under ~20 across where the floor allows it** (`min_width`): a side the
  easing cut back for a narrow spot nearby gets its room back, and a side with room makes up for
  one without, eased in and out; the edge smoothing after it keeps that width. To see why a stretch is the width it is: `node game/tools/width_stages.mjs <track>
  <path points>` (each side after each stage) and `DEBUG_ROOM=<x:y,...> python3
  tools/export_track.py <track>` (where and why the floor walk stops).
  Where the zone itself is narrow (a ridge, a gap between rocks), the route is what changes:
  another way through, or a bridge (`bridges`).
- **Kerbs:** banded strips in the `kerb` texture on both edges, except where they would lie on
  another stretch's road (a fork, a junction, a crossing).
- **Barriers:** a low wall (2.6 high) in the `barrier` texture along both edges, the whole way;
  broken only where the zone's own wall is the edge, where another stretch of the track runs
  alongside or crosses (shared lanes, junctions), and on the inside of turns too tight for it.
  Short gaps are closed, short stubs dropped: walls run in long clean lengths, with end caps.
  Karts bounce off them (`keepInside`).
- **The zone under it** (`game/src/roadbed.js`): the zone's ground under the road and kerbs is
  cut / filled to 0.7 below the road bed, so nothing pokes through; beside the road it blends
  to the natural ground. Anything with something beneath it (a roof, a platform, an arch) is
  left alone beside the road. Over lava (a causeway) the road's edges run down into the lava.
- **Off the road** you slow to 60% (boosts carry you over).
- No generic fences, no painted lines.

### A5. Check in the game
```bash
node game/tools/audit.mjs <outdir> 16 <track>         # 16 views down the road -> sheet_<track>.png
node game/tools/road_shots.mjs <track> <outdir> i...  # views at chosen path points
node game/tools/road_check.mjs <track>                # road smoothness, zone poking through
node game/tools/top_shot.mjs <track> <i> <span> <png>  # straight down on the built track (junctions, widths)
node game/tools/sweep.mjs 200 <track>                 # autopilot race: rescues (stuck spots), errors
node game/tools/steer.mjs "http://localhost:5199/?track=<track>&mute"   # real keypresses
```
Look at every sheet: anything standing in the road, sliced geometry, black or missing textures,
walls with gaps or stubs, a road through a wall → fix at the source (route, architecture list, planner),
not with a one-off hack.

## B. The zone is EverQuest

### B1. Look and sound
- `game/src/world.js`: `ZONE_HEADER` (the zone's own fog / sky / clip) and `ZONE_LOOK`
  (light, open sky, hour). Compare with real EQ screenshots of the zone.
- Music: the zone's `.xmi` (`music3d` / `music_zone` in the track file).

### B2. Who lives there, and where
1. **Named NPCs — exact spots**: Brewall's map file (`Everquest/maps/<zone>_1.txt`, P lines,
   world = (−y, −x, z)). VP: Hoshkar (−558.6, −1444.2, 269.9) → world (1444.2, 558.6, 269.9),
   exactly on his platform's top.
2. **Their look**: the zone's `<zone>_chr.s3d` models (`python3 -c "from eq_chr import
   Characters; print(Characters('<zone>').names())"`) and texture sets (`<model>ch<NN>01.bmp`:
   variant NN). Make a contact sheet of the variants and match the user's / wiki screenshot
   (Hoshkar = DRA texture set 4: olive body, orange-striped wings and belly).
3. **Common mobs**: what kind lives where — a P99 wiki zone map with spawn dots (colour key),
   registered like A2.1; or a spawn database. They are spread along the road (`npcs3d`) in the
   areas they really live; nudged off the road where the track runs through their spot.
4. In the track file:
   - `scenes`: `{name, model, variant, height, at: [x, y, z], breath}` plus which way it faces:
     `face: "racers"` (looks back down the course at the karts coming — a boss at the finish),
     `face_at: [x, y]` (a point, e.g. the road onto its island), or `yaw` (degrees) — named NPCs.
     Check each from the road (`road_shots.mjs` at the stretch before it): it must look at you.
   - `npcs3d`: `{model, count, height, variants?, wander?}` — common creatures by the road.

### B3. Life off the track (the Sega touch)
`vignettes` — each is in the world all race, and a sight the intro's flyover passes:

| kind | what |
|---|---|
| `named` | a named NPC from `scenes`, by `name` (Hoshkar on his platform) |
| `raid` | `count` raiders (`heroes`: well-geared `pc_*`) in an arc round a monster (`foe`, `foeVariant`, `foeName`): melee close, casters back, spells cast; the monster turns on them and breathes (`breath`) |
| `train` | a monk (`hero: pc_HUM_mnk`) pulling a pack (`foe`, `count`) down a hall: give `at` and `to` (EQ x, y, z); the exporter plans the run on the real floor; he runs it end to end and back, the pack on his trail |
| `kite` | a player running rings round a giant |
| `fight` | pairs of characters against the zone's monsters |
| `herd` | creatures wandering in an area |

Place them where an EQ player expects them (VP: the raid on Silverwing in the pillow room,
where raids camp), visible from the road, never on it (rings shrink until clear; skipped scenes
say why in the console: `node game/tools/npc_check.mjs <track>`).

### B4. Characters look and move right
- Player characters carry EQ items (`gequip.s3d`) on their hand / shield bones and fight in
  their style (`LOADOUT` / `STYLE_CLIPS` in `game/src/npcs.js`): sword and board, two-handers,
  dual wield, casters casting (T04–T06), monks punching and kicking.
- Monsters use the attacks they have (dragons C02/C05, raptors C05/C10, drakes C05); a model
  missing clips borrows them per clip from one with the same bones (wurms from dragons).
- Walk / run cycles are played at the speed the NPC moves (no sliding feet).
- Check: `node game/tools/npc_shot.mjs <track> <name> out.png`, `game/tools/npcview.html`.

### B5. The race intro (built from the track, nothing to set)
As kart racers do it, two parts, the camera always moving (`game/src/main.js`):
1. **The flyover** — a drone's runs down the road past each of the course's sights (its named
   NPCs and vignettes; a course with few sights gets runs down its open stretches), cut together
   in course order, ~3.6 s each: flying a little to the far side of the sight so it stays in
   frame, under any roof, looking down the road and turning to the sight as it comes up; a
   dragon breathes fire as the drone passes; each run stops a good way short of its sight.
   The course's name sits in the lower corner (no captions over scenes).
2. **The crane move** — one continuous move from high in front of the field, down over the
   racers, past yours, into the chase camera exactly (no cut), then the 3-2-1.
Enter / Space / Esc or A / Start skips it.

### B6. Check
```bash
node game/tools/intro_shots.mjs <track> <outdir>   # 3 shots down each flyover run, 5 down the crane move
node game/tools/npc_check.mjs <track>              # what was placed, what was skipped and why
```

---

## Definition of done
- [ ] Route matches the agreed route; export prints no warnings.
- [ ] No architecture in the "cleared" list; door frames, arches, columns, statues intact.
- [ ] Down the whole track (road_shots / audit): a continuous road with kerbs; walls or the
      zone's walls along both edges with no stubs or random gaps; nothing in the road; nothing
      sliced, floating or poking through; no black / missing textures.
- [ ] The start: the grid on open, level road; the camera behind the back row clear of walls.
- [ ] Intro (`intro_shots.mjs`): every run shows its sight (not a wall, not inside it), the crane
      move clear of walls and lands in the chase camera; no captions over scenes; skippable.
- [ ] Junctions and forks from above (`top_shot.mjs`): one paved surface, no kerb across a
      road, edges at the walls.
- [ ] Named NPCs at their Brewall spots, in their own looks; commons where they live;
      off-track scenes visible from the road and behaving like EQ gameplay.
- [ ] The desktop app rebuilt (`cd game && npm run dist`).
- [ ] **The user has driven it and is happy.** Their feedback goes into ROADMAP.md.
