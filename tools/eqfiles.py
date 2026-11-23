"""Where EverQuest's files are read from: the Everquest/ folder.

EverKart ships none of EverQuest's files. You copy your EverQuest game folder (Project 1999)
into Everquest/ (or point EVERQUEST_DIR at it); the build reads the files it needs from
there, exactly as EverQuest lays them out, and never changes them:

    Everquest/<zone>.s3d, <zone>_obj.s3d, <zone>_chr.s3d, <zone>.xmi     zones, objects, NPCs, music
    Everquest/global*_chr.s3d, gequip.s3d, sky.s3d                        player races, items, sky
    Everquest/spells_us.txt, spellsnew.eff, spellsnew.edd                 spell effects
    Everquest/SpellEffects/, EnvEmitterEffects/, ActorEffects/            effect textures
    Everquest/uifiles/default_old/spells0*.tga                            spell icons
    Everquest/snd*.pfs                                                    sound effects
    Everquest/maps/<zone>_1.txt                                           Brewall map points (named spawns)
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _find():
    """Everquest/ itself, or - when the EverQuest folder was copied in whole rather than its
    contents (Everquest/EverQuest/..., Everquest/Project1999/...) - the folder inside it."""
    base = Path(os.environ.get("EVERQUEST_DIR") or ROOT / "Everquest")
    if (base / "global_chr.s3d").exists() or not base.is_dir():
        return base
    inner = [d for d in base.iterdir() if d.is_dir() and (d / "global_chr.s3d").exists()]
    return inner[0] if len(inner) == 1 else base


EQ = _find()


def eq(*parts):
    """Path of an EverQuest file: Everquest/<parts>."""
    return EQ.joinpath(*parts)


def need(*parts):
    """Like eq(), but stop with a clear message when the file is missing."""
    p = eq(*parts)
    if not p.exists():
        if not (EQ / "global_chr.s3d").exists():
            raise SystemExit(f"no EverQuest files in {EQ}\n"
                             f"  copy your EverQuest game folder into it (see Everquest/README.md)")
        raise SystemExit(f"missing EverQuest file: {p}\n"
                         f"  EverKart is built with Project 1999's EverQuest files (see Everquest/README.md)")
    return p


def has(*parts):
    return eq(*parts).exists()
