# Contributing to EverKart

Thanks for wanting to help race through Norrath. This page is how the project works.

## The one rule

**Never commit EverQuest's files, or anything made from them.** That covers zones, models,
textures, sounds, music, screenshots, and the game's built data (`game/public/`, `work/`,
`game/release/`). `.gitignore` covers the usual places. If you add a new output folder, add it
there too. EverKart only works because every player brings their own EverQuest files.

## Setting up

You need your own EverQuest files in `Everquest/` (see [Everquest/README.md](Everquest/README.md)),
then:

```bash
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt       # Windows: .venv\Scripts\pip
.venv/bin/python tools/build.py vpeak                 # one track's data (no app build)
cd game && npm install
npm run dev                                           # http://localhost:5199/?track=vpeak
```

| Command | |
|---|---|
| `npm run dev` | the game in a browser, hot reload (`?track=<id>&nointro&mute&laps=1`) |
| `npm run app` | build and run the desktop app |
| `npm run dist` | package the desktop app for this system (`game/release/`) |
| `python3 tools/build.py` | everything: all tracks' data, then the desktop app |
| `python3 tools/build.py <track>` | one track's data |

## Where things are

| | |
|---|---|
| `game/src/` | the game: race loop and camera (`main.js`), track surface (`course.js`), karts (`kart.js`), CPU drivers (`race.js`), inhabitants (`npcs.js`), menus (`ui.js`) |
| `game/electron/` | the desktop app |
| `game/tools/` | in-game checks: screenshots down a track, road smoothness, the intro, NPCs |
| `tools/` | the build: reading EverQuest's files, planning routes, exporting zones, characters, effects |
| `tracks/` | one JSON file per track |
| `docs/` | install guide, how it works, the track guide |

[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) explains each part.

## Making or fixing a track

Follow **[docs/TRACK_GUIDE.md](docs/TRACK_GUIDE.md)**. It covers planning a route on the real
geometry, the track file's options, the track surface's rules (walls never break, the road uses
the full width, junctions are one paved surface), and making the zone's inhabitants
EverQuest-accurate. Veeshan's Peak (`tracks/vpeak.json`) is the reference track.

Before you open a pull request for a track, look at it:

```bash
node game/tools/audit.mjs <outdir> 16 <track>          # 16 views down the road
node game/tools/road_check.mjs <track>                 # smoothness, anything poking through
node game/tools/top_shot.mjs <track> <i> 240 out.png   # junctions from above
node game/tools/intro_shots.mjs <track> <outdir>       # the race intro
```

(These need the dev server: `cd game && NO_HMR=1 npx vite --port 5199`.)

## How we work

- **Fix things at their source.** Fix the route, the planner, the exporter or the track
  surface, never with a one-off patch for one spot. Write the lesson into the track guide so
  every track gets it.
- **The quality bar is a commercial kart racer.** A defined track, a smooth surface, a camera
  that never pops. If a kart racer would have it, it belongs; if it looks unfinished, it isn't
  done. [ROADMAP.md](ROADMAP.md) section 2 spells it out.
- **Plain words** in docs, messages and the game: "your EverQuest files", not jargon.
- **Clean means deleted.** Abandoned approaches and one-off scripts are removed, not archived.

## Pull requests

- One topic per pull request, with a short description of what it changes and why.
- Say how you checked it (which tools, which tracks), and attach screenshots of anything visual
  (they stay in the pull request, not in the repository).
- Keep the docs true: if you change how something works, update the docs that describe it.

## Reporting bugs

[Open an issue](../../issues/new/choose). Every session of the desktop app writes a log (Linux
`~/.config/EverKart/logs/`, Windows `%APPDATA%\EverKart\logs\`). Attach the newest one: after a
crash or a freeze, its last lines say what was going on.
