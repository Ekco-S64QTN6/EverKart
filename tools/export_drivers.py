"""Export every classic (pre-Luclin) EQ player race, both genders, in every armor material, and
a set of EverQuest NPC models, as kart drivers (seated). The menus show them in 3D, in the kart.

Every driver is seated the same way: its own standing pose (or its race's shared one), bent into
a kart driver's pose at the hips, knees and arms (eq_chr.Characters.SEAT) - so each sits in the
kart with its legs inside, upright, its face the right way up and looking ahead.

    python3 tools/export_drivers.py

Models: global_chr.s3d (iksar: global4_chr.s3d). Classic races share animation sets the
way EverQuest does: large races use the ogre female's, short races the dwarves', the
rest the wood elves'. Armor = the body texture material number (0 cloth, 1 leather,
2 chain, 3 plate, 4 monk) where the race has it.

Writes game/public/drivers/<CODE>_<armor>.glb, game/public/drivers/index.json, game/public/kart/*.jpg
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import eq, need  # noqa: E402
from eq_chr import Characters  # noqa: E402
import export_npcs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# race, male code, female code, standing height in EQ units
RACES = [
    ("Human", "HUM", "HUF", 6.0), ("Barbarian", "BAM", "BAF", 7.0), ("Erudite", "ERM", "ERF", 6.0),
    ("Wood Elf", "ELM", "ELF", 5.0), ("High Elf", "HIM", "HIF", 5.6), ("Dark Elf", "DAM", "DAF", 5.0),
    ("Half Elf", "HAM", "HAF", 5.5), ("Dwarf", "DWM", "DWF", 4.0), ("Troll", "TRM", "TRF", 8.0),
    ("Ogre", "OGM", "OGF", 9.0), ("Halfling", "HOM", "HOF", 3.5), ("Gnome", "GNM", "GNF", 3.0),
    ("Iksar", "IKM", "IKF", 6.0),
]
ANIM_FROM = {  # EQ's animation sharing
    # HA = half elf, HO = halfling ("hobbit")
    "HUM": "ELM", "BAM": "ELM", "ERM": "ELM", "HIM": "ELM", "DAM": "ELM", "HAM": "ELM", "ELM": None,
    "HUF": "ELF", "BAF": "ELF", "ERF": "ELF", "HIF": "ELF", "DAF": "ELF", "HAF": "ELF", "ELF": None,
    "DWM": None, "HOM": "DWM", "GNM": "DWM", "DWF": None, "HOF": "DWF", "GNF": "DWF",
    "OGM": "OGF", "OGF": None, "TRM": "OGF", "TRF": "OGF",
    "IKM": None, "IKF": "IKM",
}
ARMOR_NAMES = {0: "Cloth", 1: "Leather", 2: "Chain", 3: "Plate", 4: "Monk"}


# NPC models as racers: (code, name, archive, height in EQ units), seated from their own stance.
NPCS = [
    ("QCM", "Gypsy", "lavastorm", 6.0), ("QCF", "Gypsy Dancer", "lavastorm", 5.8),
    ("BGM", "Dervish Cutthroat", "oasis", 6.0), ("HLM", "Halas Hunter", "everfrost", 7.0),
    ("HLF", "Halas Huntress", "everfrost", 6.6), ("COM", "Coldain", "kael", 4.2),
    ("COF", "Coldain Maiden", "kael", 4.0), ("KEM", "Kerran", "global7", 6.0),
    ("KEF", "Kerran Huntress", "global7", 5.8), ("ORC", "Orc", "everfrost", 6.5),
    ("GOB", "Goblin", "everfrost", 4.5),          # (the efreeti cannot sit: no sit animation, three-jointed legs)
    ("GNN", "Gnoll", "everfrost", 5.5), ("VSM", "Vampire", "hateplane", 6.0),
    ("VSF", "Vampiress", "hateplane", 5.8), ("DVM", "Lord of Hate", "hateplane", 6.5),
    ("FRG", "Froglok", "fearplane", 5.0), ("IKS", "Skeleton", "global4", 6.0),
    ("RIM", "Mischief Jester", "mischiefplane", 4.5), ("NGM", "Neriak Guard", "hateplane", 6.0),
    ("GFM", "Faydark Ranger", "gfaydark", 5.5), ("FEM", "Felwithe Guard", "gfaydark", 5.6),
    ("ZOM", "Zombie", "fearplane", 6.0), ("DEN", "Dread", "fearplane", 7.5),
]
def export_one(ch, code, out_file):
    ch.seated, ch.frame = True, 0                    # the kart driver's pose
    export_npcs.export("drivers", code, ch)
    (ROOT / "game" / "public" / "npcs" / f"drivers_{code}.glb").replace(out_file)
    ch.seated = False


def armors_of(chars, code):
    mats = {int(m.group(1)) for n in chars.files
            for m in [re.match(code.lower() + r"(?:ch|lg)(\d\d)\d\d\.bmp$", n)] if m}
    return sorted(a for a in mats if a in ARMOR_NAMES) or [0]


def main():
    out = ROOT / "game" / "public" / "drivers"
    ui = ROOT / "game" / "public" / "ui"
    out.mkdir(parents=True, exist_ok=True)
    for old in list(out.glob("*.glb")) + list(ui.glob("racer_*.png")):      # (portraits: no longer made)
        old.unlink()
    archives = {"global": Characters(archive=need("global_chr.s3d")),
                "global4": Characters(archive=need("global4_chr.s3d")),
                "global7": Characters(archive=need("global7_chr.s3d"))}
    index = []
    for race, male, female, height in RACES:
        for gender, code in (("Male", male), ("Female", female)):
            ch = archives["global4" if code.startswith("IK") else "global"]
            model = ch.model
            armors = armors_of(ch, code)
            for armor in armors:
                ch.anim_source, ch.armor, ch.anim_archive = ANIM_FROM[code], armor, None
                export_one(ch, code, out / f"{code}_{armor}.glb")
            index.append({"code": code, "race": race, "gender": gender, "height": height,
                          "armors": [{"id": a, "name": ARMOR_NAMES[a]} for a in armors]})
            print(f"  {race:10s} {gender:6s} {code}: armors {armors}")
    for code, name, where, height in NPCS:
        if where not in archives:
            f = eq(f"{where}_chr.s3d")
            archives[where] = Characters(archive=f) if f.exists() else Characters(where)
        ch = archives[where]
        ch.armor = None
        ch.anim_source = ch.anim_archive = None
        note = "seated from its own stance" if "P01" in ch.anims_of(code) else "seated from its base pose"
        export_one(ch, code, out / f"{code}_0.glb")
        ch.anim_source = ch.anim_archive = None
        index.append({"code": code, "race": name, "gender": "", "height": height, "npc": True,
                      "armors": [{"id": 0, "name": ""}]})
        print(f"  {name:18s} {code}: {note}")
    (out / "index.json").write_text(json.dumps(index, indent=1))


# kart materials and banners, straight from the zones' own textures
KART_TEX = {
    "wood": "gfaydark/textures/plank1.png", "metal": "gfaydark/textures/burnmetal.png",
    "banner0": "templeveeshan/textures/tvflag1.png", "banner1": "kael/textures/kaelflag200.png",
    "banner2": "gfaydark/textures/orcflag3.png", "banner3": "templeveeshan/textures/tvflag2.png",
    "banner4": "kael/textures/kaelbanner200.png",
}


def kart_textures():
    from PIL import Image
    out = ROOT / "game" / "public" / "kart"
    out.mkdir(parents=True, exist_ok=True)
    for name, src in KART_TEX.items():
        im = Image.open(ROOT / "work" / "zones" / src).convert("RGB")
        im.thumbnail((512, 512))
        im.save(out / f"{name}.jpg", quality=90)


if __name__ == "__main__":
    main()
    kart_textures()
