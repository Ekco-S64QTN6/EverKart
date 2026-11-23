"""Export EQ spell-effect sprites (from Everquest/SpellEffects/)
for the game's particle system: game/public/fx/<name>.png + fx.json with each sheet's
flipbook grid (EQ packs animation frames as 2x2 or 4x4 grids).

    python3 tools/export_fx.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import eq, need  # noqa: E402


def grid_of(rgba):
    """Largest of 4 / 2 / 1 whose cell borders are (almost) empty in the sheet."""
    a = rgba[..., 3].astype(float) if rgba.shape[2] == 4 else rgba[..., :3].max(axis=2).astype(float)
    h, w = a.shape
    for g in (4, 2):
        cw, ch = w // g, h // g
        lines = [a[:, k * cw - 1:k * cw + 1].mean() for k in range(1, g)] + [a[k * ch - 1:k * ch + 1, :].mean() for k in range(1, g)]
        if max(lines) < max(6.0, a.mean() * 0.15):
            return g
    return 1


# the effect sprites the game's items and particles use (from Everquest/SpellEffects/)
FX_FILES = {"8starsp501.dds", "BlueStarsp501.dds", "Corona1.dds", "Dustsp502.dds", "ElectricA.dds", "ElectricB.dds",
            "Ether2.dds", "ExplosionA.dds", "ExplosionD.dds", "FireC.dds", "Firesp501.dds", "FlameD.dds", "Glowflare02.tga",
            "Root3.dds", "Root4.dds", "SmokeC.dds", "StarA.dds", "Thorn3.dds", "ZapMuzA.dds", "blueringa.dds", "cloudsp501.dds",
            "dustsp501.dds", "flamesp501.dds", "flare_blsp501.tga", "flare_whsp501.tga", "glittersp501.dds", "glittersp502.dds",
            "glyphsp501.dds", "lightningsp601.dds", "redburstsp501.dds", "runecircle00.dds", "vinesp501.dds", "vortexsp601.dds"}


def main():
    src = eq("SpellEffects")
    out = ROOT / "game" / "public" / "fx"
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for f in sorted(p for p in src.iterdir() if p.name in FX_FILES):
        try:
            im = Image.open(f).convert("RGBA")
        except Exception as e:
            print(f"  skip {f.name}: {e}")
            continue
        rgba = np.asarray(im)
        if rgba[..., 3].min() == 255:            # no alpha: use brightness (EQ blends these additively)
            rgba = rgba.copy()
            rgba[..., 3] = rgba[..., :3].max(axis=2)
            im = Image.fromarray(rgba, "RGBA")
        name = f.stem
        g = grid_of(rgba)
        im.save(out / f"{name}.png")
        meta[name] = {"grid": g}
    (out / "fx.json").write_text(json.dumps(meta, indent=1))
    print(f"{len(meta)} sprites:", ", ".join(f"{k}({v['grid']})" for k, v in meta.items()))


if __name__ == "__main__":
    main()
