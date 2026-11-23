"""Render a top-down orthographic floorplan from work/zones/<zone>/mesh.npz.

    python3 tools/floorplan.py kael [--px 3000]

Writes into work/zones/<zone>/:
    floorplan.png         floors coloured by elevation, wall outlines, object dots, grid
    floorplan_mask.png    plain white-on-black walkable-floor mask (no annotations),
                          1 px = `units_per_px` world units; input for track authoring
    floorplan.json        the pixel<->world transform for both images
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FLOOR_NZ = 0.6   # triangles whose upward normal exceeds this count as drivable floor
WALL_NZ = 0.3    # |normal z| below this is a wall
MARGIN = 60

# elevation ramp low -> high (blue, teal, green, yellow, orange, red)
RAMP = np.array([[40, 70, 200], [30, 170, 190], [60, 190, 90],
                 [230, 220, 70], [240, 150, 50], [220, 60, 50]], float)


def ramp(t):
    t = np.clip(t, 0, 1) * (len(RAMP) - 1)
    i = np.minimum(t.astype(int), len(RAMP) - 2)
    f = (t - i)[:, None]
    return (RAMP[i] * (1 - f) + RAMP[i + 1] * f).astype(int)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zone")
    ap.add_argument("--px", type=int, default=3000, help="long side of the image in pixels")
    args = ap.parse_args()
    out = ROOT / "work" / "zones" / args.zone
    m = np.load(out / "mesh.npz")
    verts, tris, nz, solid = m["verts"], m["tris"], m["tri_normal_z"], m["tri_solid"]

    lo, hi = verts[:, :2].min(axis=0), verts[:, :2].max(axis=0)
    upp = float((hi - lo).max() / (args.px - 2 * MARGIN))  # world units per pixel
    w, h = (np.ceil((hi - lo) / upp).astype(int) + 2 * MARGIN).tolist()

    def to_px(xy):  # world (x, y) -> image (col, row); +y is up on the image
        return np.stack([(xy[..., 0] - lo[0]) / upp + MARGIN,
                         (hi[1] - xy[..., 1]) / upp + MARGIN], axis=-1)

    p = to_px(verts[:, :2])
    tri_z = verts[tris][:, :, 2].mean(axis=1)
    floor = (nz > FLOOR_NZ) & solid
    wall = (np.abs(nz) < WALL_NZ) & solid
    zlo, zhi = np.percentile(tri_z[floor], [1, 99])

    img = Image.new("RGB", (w, h), (18, 18, 22))
    d = ImageDraw.Draw(img)
    mask = Image.new("L", (w, h), 0)
    dm = ImageDraw.Draw(mask)

    # floors, lowest first so upper levels overdraw lower ones
    order = np.argsort(tri_z)
    order = order[floor[order]]
    colors = ramp((tri_z[order] - zlo) / max(zhi - zlo, 1e-6))
    for t, c in zip(order, colors):
        poly = [tuple(q) for q in p[tris[t]]]
        d.polygon(poly, fill=tuple(c))
        dm.polygon(poly, fill=255)

    # walls project to slivers: draw their outline
    for t in np.nonzero(wall)[0]:
        q = [tuple(v) for v in p[tris[t]]]
        d.line(q + [q[0]], fill=(0, 0, 0), width=1)

    # object placements
    objects = json.loads((out / "objects.json").read_text())
    for o in objects:
        x, y = to_px(np.array([o["x"], o["y"]]))
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 255, 255), outline=(0, 0, 0))

    # grid + labels every 500 world units
    font = ImageFont.load_default(size=18)
    for gx in np.arange(np.ceil(lo[0] / 500) * 500, hi[0], 500):
        x = to_px(np.array([gx, 0.0]))[0]
        d.line([(x, MARGIN), (x, h - MARGIN)], fill=(90, 90, 100), width=1)
        d.text((x + 3, MARGIN - 26), f"x={gx:.0f}", fill=(200, 200, 210), font=font)
    for gy in np.arange(np.ceil(lo[1] / 500) * 500, hi[1], 500):
        y = to_px(np.array([0.0, gy]))[1]
        d.line([(MARGIN, y), (w - MARGIN, y)], fill=(90, 90, 100), width=1)
        d.text((4, y - 22), f"y={gy:.0f}", fill=(200, 200, 210), font=font)

    # legend
    lx, ly = MARGIN, h - 40
    for i in range(240):
        d.line([(lx + i, ly), (lx + i, ly + 16)], fill=tuple(ramp(np.array([i / 239]))[0]))
    d.text((lx + 250, ly - 3),
           f"floor elevation z {zlo:.0f} .. {zhi:.0f}   |   white dots = placed objects   |   "
           f"{args.zone}: {upp:.2f} units/px", fill=(230, 230, 235), font=font)

    img.save(out / "floorplan.png")
    mask.save(out / "floorplan_mask.png")
    (out / "floorplan.json").write_text(json.dumps({
        "zone": args.zone, "width": w, "height": h, "units_per_px": upp, "margin": MARGIN,
        "world_x_at_col0": lo[0] - MARGIN * upp, "world_y_at_row0": hi[1] + MARGIN * upp,
        "note": "col = (x - world_x_at_col0)/units_per_px ; row = (world_y_at_row0 - y)/units_per_px",
        "floor_triangles": int(floor.sum()), "wall_triangles": int(wall.sum()),
        "floor_z_range": [float(zlo), float(zhi)],
    }, indent=1))
    print(f"{args.zone}: {w}x{h}px, {upp:.2f} units/px, {floor.sum()} floor / {wall.sum()} wall tris")


if __name__ == "__main__":
    main()
