"""Export EverQuest's own spell particle effects for the game.

    python3 tools/export_spellfx.py

Reads EverQuest's particle data (Everquest/): spells_us.txt (spell -> effect
record, field 145), spellsnew.eff (effect -> three stages of emitter slots: cast,
projectile, impact) and spellsnew.edd (emitter definitions), plus the sprite textures in
SpellEffects/, EnvEmitterEffects/, ActorEffects/. Layout as documented by OpenEQ
(docs/SPELL_EFFECT_FORMAT.md, reverse-engineered from EQGraphicsDX9.dll).

Writes game/public/spellfx/spells.json and spellfx/tex/<name>.png.
"""
import json
import sys
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import EQ, eq  # noqa: E402
OUT = ROOT / "game" / "public" / "spellfx"

# kart items -> the EverQuest spell whose visuals they use
ITEM_SPELLS = {
    "wolf": "Spirit of Wolf",
    "fireball": "Flame Bolt",
    "whirlwind": "Whirl till you hurl",
    "snare": "Snare",
    "gate": "Gate",
    "invis": "Invisibility",
    "lightning": "Shock of Lightning",
}
EFFECT_FIELD = 145
EFF_SIZE, EDD_SIZE = 268, 416


def grid(frames):
    if frames <= 1:
        return [1, 1]
    if frames <= 4:
        return [2, 2]
    if frames <= 8:
        return [4, 2]
    if frames <= 16:
        return [4, 4]
    return [1, 1]


def emitter(edd, i):
    b = edd[8 + i * EDD_SIZE:8 + (i + 1) * EDD_SIZE]
    u = lambda o: struct.unpack_from("<I", b, o)[0]          # noqa: E731
    f = lambda o: struct.unpack_from("<f", b, o)[0]          # noqa: E731
    frames = u(304)
    return {
        "name": b[:64].split(b"\0")[0].decode("latin-1"),
        "texture": b[64:96].split(b"\0")[0].decode("latin-1"),
        "noDepth": u(100), "additive": u(104), "billboard": u(112), "follow": u(116),
        "duration": f(120), "life": f(124), "initial": u(128), "perTick": u(132), "rate": f(136), "delay": f(140),
        "fadeIn": f(144), "fadeOut": f(148), "growIn": f(152), "shrinkOut": f(156), "opacity": f(164),
        "shape": u(168), "dims": [f(172), f(176), f(180)], "offset": [f(184), f(188), f(192)],
        "angles": [f(196), f(200)], "width": [f(204), f(388)], "height": [f(380), f(384)],
        "color0": [u(212), u(216), u(220)], "color1": [u(224), u(228), u(232)],
        "axial": [f(236), f(240), f(244)], "trans1": [f(248), f(252), f(256)], "trans2": [f(260), f(264), f(268)],
        "radial": [f(272), f(276), f(280)], "orbit": [f(284), f(288), f(292)],
        "gravity": f(296), "windX": f(300), "frames": frames, "fps": f(308), "grid": grid(frames),
        "spin": [f(312), f(392)], "randomRotation": u(372), "sameWH": u(396),
    }


def find_texture(name):
    stem = Path(name).stem.lower()
    for folder in ("SpellEffects", "EnvEmitterEffects", "ActorEffects"):
        d = eq(folder)
        if not d.exists():
            continue
        for f in d.iterdir():
            if f.stem.lower() == stem:
                return f
    return None


def main():
    rows = {}
    for line in open(eq("spells_us.txt"), encoding="latin-1"):
        f = line.rstrip("\n").split("^")
        rows.setdefault(f[1], f)                         # first spell with that name
    eff = eq("spellsnew.eff").read_bytes()
    edd = eq("spellsnew.edd").read_bytes()
    (OUT / "tex").mkdir(parents=True, exist_ok=True)
    spells, textures, missing = {}, {}, set()
    for item, spell in ITEM_SPELLS.items():
        idx = int(rows[spell][EFFECT_FIELD])
        r = eff[idx * EFF_SIZE:(idx + 1) * EFF_SIZE]
        stages = []
        for st in range(3):
            o = 64 + st * 68
            slots = []
            for sl in range(4):
                e, _unk, mode, attach = struct.unpack_from("<4I", r, o + 4 + sl * 16)
                if not e:
                    continue
                em = emitter(edd, e)
                src = find_texture(em["texture"])
                if src is None:
                    missing.add(em["texture"])
                    continue
                key = src.stem.lower()
                if key not in textures:
                    im = Image.open(src).convert("RGBA")
                    if src.suffix.lower() == ".bmp":     # no alpha: EQ blends these additively
                        px = im.load()
                        for y in range(im.height):
                            for x in range(im.width):
                                rr, gg, bb, _ = px[x, y]
                                px[x, y] = (rr, gg, bb, max(rr, gg, bb))
                    im.save(OUT / "tex" / f"{key}.png")
                    textures[key] = str(src.relative_to(EQ))
                em["texture"] = key
                slots.append({"mode": mode, "attach": attach, "emitter": em})
            stages.append(slots)
        spells[item] = {"spell": spell, "effect": idx, "effectName": r[:64].split(b"\0")[0].decode("latin-1"),
                        "stages": stages}
        print(f"  {item:10s} <- {spell:22s} effect {idx:3d} '{spells[item]['effectName']}': "
              f"{[len(s) for s in stages]} emitters per stage")
    (OUT / "spells.json").write_text(json.dumps(spells, indent=1))
    print(f"{len(textures)} textures" + (f"; missing: {sorted(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
