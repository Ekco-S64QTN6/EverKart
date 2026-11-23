# EverKart

A kart racer through real EverQuest zones (three.js + Electron, `game/`), built from the
player's own EverQuest files. Read **ROADMAP.md** first: the vision, **the quality bar** (what
the user expects — section 2), the current state, the open work in order, and the log of the
user's feedback. **The racing is kart racing; everything you see and hear is EverQuest.**

**Making or fixing a track: follow `docs/TRACK_GUIDE.md`** — the route / track-surface recipe
and the EQ-accuracy recipe, with the definition of done. Veeshan's Peak (`tracks/vpeak.json`)
is the reference track.

## How to work on this project

- **Meet the quality bar without being asked.** The user expects a commercial-grade kart
  racer: a defined track (road, kerbs, continuous barriers), a smooth surface, rubber
  banding, a camera that never pops, a proper pre-race flyover and grid lineup. If a kart
  racer would have it, build it; if it would look like a game jam, it is not done.
- **The user plays the packaged app** (Start menu → Games → EverKart runs
  `game/release/EverKart-*.AppImage`). After any change they will test, rebuild it
  (`cd game && npm run dist`, seconds) and say it is rebuilt. Never leave them on a stale build.
- **The user is the play-tester.** Do not spend time on autopilot/CPU races to "validate" a
  track. Before handing over, look at the track yourself (screenshots down its whole length:
  `game/tools/road_shots.mjs`, `audit.mjs`; top-down: `tools/mapview.py`) and fix every
  visible construction defect; then the user drives it.
- **Write every piece of user feedback into ROADMAP.md at once** (open work + feedback log),
  with its status. Nothing the user said may be lost.
- **Fix problems at their source** (route, planner, exporter, track surface) — never a one-off
  hack for one spot. Write the lesson into `docs/TRACK_GUIDE.md` so every track gets it.
- **Plain words.** "Your EverQuest files", "the `Everquest/` folder" — no jargon in docs or replies.
- **Clean means deleted.** Abandoned approaches, prototypes and one-off scripts are removed,
  not archived.

## Commands

- `python3 tools/build.py` — the whole game from `Everquest/`: game data into `game/public/`, then the desktop app
- `python3 tools/build.py <track>` — one track's data only (development)
- `cd game && npm run dist` — rebuild the desktop app for this system (`game/electron-builder.config.cjs`:
  AppImage on Linux — with the system `electron39` when present, seconds — or the Windows installer)
- `./install.sh` (Linux) / `install.bat` → `install.ps1` (Windows) — the player's installers: check
  the tools, `.venv/`, `tools/build.py`, then install (desktop entry / NSIS installer). The user's
  own Start-menu entry runs `game/release/EverKart-*.AppImage` directly: `npm run dist` updates it.
- `cd game && npm run dev` — the game in a browser, hot reload; `?track=vpeak&mute&nointro` etc.
  (`NO_HMR=1 npx vite --port 5199` for headless tools: edits do not reload pages mid-test)
- `python3 tools/mapview.py route|floors|objects <track> ...` — top-down route / floor heights / object footprints
- `DEBUG_WP=1 python3 tools/export_track.py <track>` — where each waypoint lands on the floor
- `node game/tools/road_shots.mjs <track> <outdir> <path points...>` — look down the road at path points
- `node game/tools/audit.mjs <outdir> 16 [tracks]` — 16 views down the road per track, one sheet each
- `node game/tools/road_check.mjs [tracks] [-v]` — road smoothness, zone poking through the road
- `node game/tools/width_stages.mjs <track> <path points>` — why the road is the width it is there (each side, each stage)
- `node game/tools/ride_check.mjs <track> [seconds]` — bumps, airtime, wall hits, camera jumps on one drive
- `node game/tools/intro_shots.mjs <track> <outdir>` — shots down the race intro (each flyover run, the crane move)
- `node game/tools/top_shot.mjs <track> <path point> <span> <png> [above]` — straight down on the built track (junctions, forks, widths)
- `node game/tools/menu_shot.mjs <outdir> [--race]` — the front end screen by screen, real key presses (title → race)
- `node game/tools/racer_sheet.mjs <outdir> [CODE ...]` — every racer seated in a kart, front / side / three-quarter
  (`ALL_ARMORS=1` for every armor; one racer: `/tools/racerview.html?racer=HUM_3`)
- `node game/tools/npc_check.mjs <track>` / `npc_shot.mjs <track> <name> <png>` — what was placed (and why not) / one NPC up close
- `node game/tools/steer.mjs "http://localhost:5199/?track=vpeak&mute"` — real-keypress steering/drift check
- `http://localhost:5199/tools/npcview.html?models=pc_BAM&clips=P01,C01&yaw=0,90` — NPC / driver models in their clips
- Desktop app logs: `~/.config/EverKart/logs/everkart-*.log` (console, errors, crashes / hangs, a 5 s heartbeat)
- Steering convention: yaw increases = turn right; three.js meshes rotate by -yaw

## Repository

Public on GitHub: README (player-facing), docs/INSTALL.md, docs/HOW_IT_WORKS.md, docs/TRACK_GUIDE.md,
CONTRIBUTING.md, ROADMAP.md, `.github/` templates. Keep them true when behaviour changes, and
keep their wording neutral and professional (the user's feedback is logged in ROADMAP.md, in
substance, not as raw quotes).

## Rules

- EverQuest's files are read from `Everquest/` (the player copies their EverQuest folder in;
  or `EVERQUEST_DIR`) through `tools/eqfiles.py` — read only. Never modify the player's EverQuest install.
- Never commit EverQuest data or anything built from it: `Everquest/*`, `work/`, `game/public/`,
  `game/electron/icon.png` (`.gitignore` covers them).
- Original game only: no Mario Kart characters, art, items or music.
- Commit or push only when the user asks.
