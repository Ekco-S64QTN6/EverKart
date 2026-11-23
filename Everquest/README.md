# 📁 Everquest/ — copy your EverQuest folder here

EverKart is built from **your own EverQuest files**. This folder is where they go. It is empty
in the repository, because EverQuest's files are not ours to share.

## What to do

Copy everything in your EverQuest game folder into this folder. When you're done, it looks
like this:

```
Everquest/
├── README.md            ← this file
├── global_chr.s3d       ← if this is here, you're set
├── gequip.s3d
├── sky.s3d
├── crushbone.s3d
├── crushbone_chr.s3d
├── crushbone_obj.s3d
├── ...                  (all the other zone files)
├── spells_us.txt
├── SpellEffects/
├── uifiles/
└── maps/                (optional: Brewall's maps, only used to make new tracks)
```

Copied the folder itself rather than what's in it (`Everquest/EverQuest/global_chr.s3d`)?
That works too: the build finds it.

Then run the installer from the project folder: `./install.sh` on Linux, `install.bat` on
Windows. See [docs/INSTALL.md](../docs/INSTALL.md).

> **Which EverQuest?** EverKart is built and tested with the files from
> [Project 1999](https://www.project1999.com/) (the classic EverQuest client). Other classic
> clients may work; newer zones (`.eqg` files) are not supported.

> **Already have EverQuest somewhere else?** Instead of copying, you can point the build at
> it: `EVERQUEST_DIR=/path/to/EverQuest ./install.sh` (Linux) or
> `set EVERQUEST_DIR=C:\path\to\EverQuest` before `install.bat` (Windows).

## What the build uses

The build only **reads** this folder, and never changes it.

| Files | What they give the game |
|---|---|
| `<zone>.s3d`, `<zone>_obj.s3d`, `<zone>_chr.s3d`, `<zone>.xmi` | the zones, their objects, their creatures, their music |
| `global_chr.s3d`, `global2_chr.s3d`, `global4_chr.s3d`, `global7_chr.s3d` ... | the player races (the drivers, the raiders) |
| `gequip.s3d` | weapons and shields |
| `sky.s3d` | outdoor skies, the sun and the moon |
| `spells_us.txt`, `spellsnew.eff`, `spellsnew.edd`, `SpellEffects/`, `EnvEmitterEffects/`, `ActorEffects/` | spell effects |
| `uifiles/default_old/spells0*.tga` | spell icons |
| `snd*.pfs` | sound effects |
| `maps/<zone>_1.txt` (Brewall's EverQuest maps) | only when making a new track: where its named NPCs stand |

What the build makes from them goes into `game/public/` and `work/`, which are never
committed either. **The game you build contains EverQuest's art, so keep it to yourself.**
