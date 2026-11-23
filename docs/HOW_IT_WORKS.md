# How EverKart works

EverKart is two things: a **build** (Python, `tools/`) that reads the player's EverQuest files
and turns them into game data, and the **game** (three.js in Electron, `game/`) that races on
that data. Nothing from EverQuest is in the repository; everything below is made on the
player's machine from their own files.

## What comes from EverQuest

| In the game | Where it comes from |
|---|---|
| The zone around the track | the zone's `.s3d` world mesh, its textures and its baked vertex lighting |
| The track | a modelled road laid along a route planned over the zone's real floor: the zone's own floor texture (at the zone's own texture scale, lit by the zone's baked light), banded kerbs in the zone's trim, low walls in the zone's stone along both edges, each edge out to the zone's own walls; the zone's ground shaped to sit just under it |
| Trees, braziers, banners, furniture | the zone's placed objects (`objects.wld` + `<zone>_obj.s3d`), including those built as a rig with a mesh per bone (the swaying trees of Mischief and Growth); only clutter standing on the road is removed |
| Dragons, drakes, wurms, giants, wolves, orcs, guards | the zone's `<zone>_chr.s3d`, skinned, playing their own EverQuest animations; models without an animation borrow it from a matching skeleton, as EverQuest does |
| Racers | all 13 classic player races, male and female (`global_chr.s3d`, iksar from `global4_chr.s3d`), in every armor set the race has, and EverQuest NPC models. Each is seated as a kart driver from its own standing pose: sitting up, head level, legs stretched ahead in the kart's tub, both hands on the steering wheel |
| Weapons and shields | EverQuest's held items (`gequip.s3d`) on the characters' hand and shield bones; each character fights in its style (sword and board, two-handers, dual wield, casters, monks) |
| Life beside the track | named NPCs at their real spawn points (Brewall's maps), raids, a monk training racnar, landmark scenes per zone, and dragons breathing fire at passing karts (`scenes`, `vignettes`, `npcs3d` in `tracks/*.json`) |
| Karts | an original design, built from EverQuest textures (plank wood, iron) and flying real EverQuest banners |
| Spells (items) | EverQuest's spell icons and each spell's own particle effect: `spells_us.txt` gives the effect, `spellsnew.eff` its emitters, `spellsnew.edd` each emitter, with the sprites in `SpellEffects/` |
| Sky (outdoor zones) | the zone's own sky set from `sky.s3d`, with EverQuest's sun and moon through a day and a night; each zone's fog colour and distances are its real header values (`tracks/zone_headers.json`) |
| Music | the zone's `.xmi`, converted to MIDI and rendered with a General MIDI soundfont; zones without music of their own borrow the nearest EverQuest theme |
| Sound effects | EverQuest's own sounds (`snd*.pfs`): the mine-cart rumble for your kart, casting, spell hits, thunder, teleport, a wolf's howl, the level-up ding at the finish |
| Animated textures | fire, lava, smoke and water cycle their EverQuest frames at EverQuest's own rate |

Not from EverQuest: the HUD, menus, minimap and chevron boards.

## The race intro

Built from the track, with nothing to set up. First comes a **flyover**: a drone runs down
the road past each of the course's sights, cut together in course order. Then comes one
**crane move** from high in front of the grid, down over the racers, into your chase camera,
followed by the countdown.

## The build (`tools/`)

| Tool | Job |
|---|---|
| `eqfiles.py` | where EverQuest's files are read from: `Everquest/` (or `EVERQUEST_DIR`) |
| `s3d.py`, `wld.py` | read EverQuest's `.s3d` archives and `.wld` fragments (meshes, UVs, vertex colours, materials, skeletons, placements) |
| `extract_zone.py <zone>` | zone → `work/zones/<zone>/` mesh, textures, materials, objects |
| `export_gltf.py <zone>` | zone + placed objects → `game/public/zones/<zone>.glb` (render and collision) |
| `navgrid.py` | the drivable-route planner over the zone's floor (floor levels, walls, steps, drops, architecture) |
| `export_track.py <track>` | `tracks/<track>.json` waypoints → the routed racing line, the road's free width on each side, the start grid, junctions |
| `eq_chr.py`, `export_npcs.py`, `export_drivers.py` | pose EverQuest's character models (any animation frame) and export them |
| `export_spellfx.py`, `export_fx.py` | the spells' EverQuest particle effects and sprites |
| `export_sfx.py` | EverQuest's sound effects |
| `xmi2mid.py` | EverQuest `.xmi` music → standard MIDI |
| `mapview.py`, `floorplan.py` | top-down views of a zone, its floors, objects and a track's route (making tracks) |
| `build.py` | runs all of it, then packages the desktop app |

## The game (`game/src/`)

| File | Job |
|---|---|
| `main.js` | the race: loading, the camera, the intro, the HUD, the race loop |
| `world.js` | loading a zone (glTF), its look (fog, sky, light), collision raycasts |
| `course.js` | the track surface: the road, kerbs, walls, arches, chevrons, the minimap |
| `roadbed.js` | shaping the zone's ground to sit just under the road |
| `kart.js` | kart physics: grip, drifting, mini-turbos, jumps |
| `race.js` | the track's line, progress and laps, CPU drivers and rubber banding |
| `npcs.js` | the zone's inhabitants: named NPCs, raids, trains, fights, herds |
| `items.js`, `eqfx.js` | spells as items, and EverQuest's particle effects |
| `frontend/` | every screen outside the race: title, main menu, racer carousel, track cover flow, campaign (cups, standings, podium), options, loading (`frontend.js`), the 3D showroom of karts behind them (`showroom.js`), one stylesheet (`frontend.css`) |
| `settings.js` | the player's options, kept between sessions; the race reads them |
| `ui.js` | the racer and track lists, the race's results screen |

The desktop app (`game/electron/`) serves the built game from an `app://` scheme, starts
fullscreen, and writes a log of each session (Linux `~/.config/EverKart/logs/`, Windows
`%APPDATA%\EverKart\logs\`).
