"""Top-down views of a track's zone for planning and checking a route.

    python3 tools/mapview.py route   <track> [out.png]                 floorplan + exported line + waypoints
    python3 tools/mapview.py floors  <track> x0 x1 y0 y1 [--z LO HI] [out.png]
        the zone's floors (top-most first), height labels, lava in orange, the line (causeways yellow)
    python3 tools/mapview.py objects <track> x0 x1 y0 y1 [--z LO HI] [out.png]
        floors + placed objects' footprints at kart height (architecture vs clutter) + the line + waypoints

Coordinates are EQ's (x east, y north); the game's are (x, height, -y). Waypoints in
tracks/<track>.json are EQ (x, y). Output defaults to work/maps/<track>_<mode>.png.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import eq, need  # noqa: E402


def load(track):
    cfg = json.loads((ROOT / "tracks" / f"{track}.json").read_text())
    exp = ROOT / "game" / "public" / "tracks" / f"{track}.json"
    return cfg, (json.loads(exp.read_text()) if exp.exists() else None)


def draw_line(d, t, P, every=20, width=3):
    if not t:
        return
    pts = [P(p[0], -p[2]) for p in t["path"]]
    d.line(pts + ([] if t.get("open") else [pts[0]]), fill=(255, 0, 255), width=width)
    for i in t.get("deck", []):
        d.ellipse([pts[i][0] - 3, pts[i][1] - 3, pts[i][0] + 3, pts[i][1] + 3], fill=(255, 230, 0))
    for i in range(0, len(pts), every):
        d.text((pts[i][0] + 4, pts[i][1] - 10), str(i), fill=(255, 255, 255))


def draw_waypoints(d, cfg, P):
    for k, (x, y) in enumerate(cfg["waypoints"]):
        q = P(x, y)
        d.rectangle([q[0] - 4, q[1] - 4, q[0] + 4, q[1] + 4], outline=(0, 255, 0), width=2)
        d.text((q[0] + 6, q[1] + 2), f"w{k}", fill=(0, 255, 0))


def grid(d, P, box, step):
    x0, x1, y0, y1 = box
    gx = math.ceil(x0 / step) * step
    while gx <= x1:
        d.line([P(gx, y0), P(gx, y1)], fill=(70, 70, 70))
        d.text((P(gx, y1)[0] + 2, 2), str(int(gx)), fill=(255, 255, 0))
        gx += step
    gy = math.ceil(y0 / step) * step
    while gy <= y1:
        d.line([P(x0, gy), P(x1, gy)], fill=(70, 70, 70))
        d.text((2, P(x0, gy)[1] + 2), str(int(gy)), fill=(255, 255, 0))
        gy += step


def route(track, out):
    cfg, t = load(track)
    zone = cfg["zone"]
    fp = json.loads((ROOT / "work" / "zones" / zone / "floorplan.json").read_text())
    im = Image.open(ROOT / "work" / "zones" / zone / "floorplan.png").convert("RGB")
    u = fp["units_per_px"]
    P = lambda x, y: ((x - fp["world_x_at_col0"]) / u, (fp["world_y_at_row0"] - y) / u)
    d = ImageDraw.Draw(im)
    draw_line(d, t, P, every=100, width=5)
    draw_waypoints(d, cfg, P)
    if t:
        pts = [P(p[0], -p[2]) for p in t["path"]]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        im = im.crop((max(0, min(xs) - 150), max(0, min(ys) - 150), min(im.width, max(xs) + 150), min(im.height, max(ys) + 150)))
    im.thumbnail((1600, 1600))
    im.save(out)


def floors_and_objects(track, box, zr, out, objects):
    cfg, t = load(track)
    zone = cfg["zone"]
    x0, x1, y0, y1 = box
    m = np.load(ROOT / "work" / "zones" / zone / "mesh.npz", allow_pickle=True)
    mats = json.loads((ROOT / "work" / "zones" / zone / "materials.json").read_text())
    tri = m["verts"][m["tris"]]
    c = tri.mean(1)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    nz = n[:, 2] / (np.linalg.norm(n, axis=1) + 1e-9)
    floor = (nz < -0.5) & (c[:, 0] > x0 - 80) & (c[:, 0] < x1 + 80) & (c[:, 1] > y0 - 80) & (c[:, 1] < y1 + 80)
    if zr:
        floor &= (c[:, 2] > zr[0]) & (c[:, 2] < zr[1])
    zs = c[floor, 2]
    zlo, zhi = (np.percentile(zs, 2), np.percentile(zs, 98)) if len(zs) else (0, 1)
    s = 1100 / max(x1 - x0, y1 - y0)
    im = Image.new("RGB", (int((x1 - x0) * s), int((y1 - y0) * s)), (20, 20, 24))
    d = ImageDraw.Draw(im)
    P = lambda x, y: ((x - x0) * s, (y1 - y) * s)
    for k in np.flatnonzero(floor)[np.argsort(c[floor, 2])]:            # top-most drawn last
        mi = m["tri_material"][k]
        tex = (mats[mi]["texture"] or "") if mi < len(mats) else ""
        g = int(60 + 180 * np.clip((c[k, 2] - zlo) / (zhi - zlo + 1e-9), 0, 1))
        fill = (240, 110 + g // 6, 20) if "lava" in tex.lower() else (g // 2, g, g)
        d.polygon([P(*tri[k, j, :2]) for j in range(3)], fill=fill, outline=(0, 0, 0))
    step = 25 if max(x1 - x0, y1 - y0) < 500 else 50
    grid(d, P, box, step)
    for gx in np.arange(x0 + step / 2, x1, step):                      # floor height labels
        for gy in np.arange(y0 + step / 2, y1, step):
            near = floor & (np.abs(c[:, 0] - gx) < step / 2) & (np.abs(c[:, 1] - gy) < step / 2)
            if near.any():
                q = P(gx, gy)
                d.text((q[0] - 8, q[1] - 5), str(int(c[near, 2].max())), fill=(255, 255, 255))
    if objects:
        import re
        from s3d import read_archive
        from wld import Wld
        from scipy.spatial import ConvexHull
        from export_track import ARCHITECTURE
        obj = eq(f"{zone}_obj.s3d")
        if obj.exists():
            files = read_archive(obj)
            w = Wld(next(v for k, v in files.items() if k.endswith(".wld")))
            meshes = {mm["name"].replace("_DMSPRITEDEF", ""): mm for mm in w.meshes()}
            for o in json.loads((ROOT / "work" / "zones" / zone / "objects.json").read_text()):
                mm = meshes.get(o["name"])
                if mm is None or not (x0 - 100 < o["x"] < x1 + 100 and y0 - 100 < o["y"] < y1 + 100):
                    continue
                if zr and not (zr[0] - 20 < o["z"] < zr[1] + 20):
                    continue
                a = np.radians(o["heading"] / 512 * 360)
                rot = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
                v = mm["verts"] @ rot.T * o["scale"] + [o["x"], o["y"], o["z"]]
                low = v[v[:, 2] < v[:, 2].min() + 12]
                arch = bool(re.search(ARCHITECTURE, o["name"])) or o["name"] in cfg.get("keep_objects", [])
                col = (255, 120, 60) if arch else (255, 210, 0)
                if len(low) >= 3:
                    try:
                        h = ConvexHull(low[:, :2])
                        d.polygon([P(*low[i, :2]) for i in h.vertices], outline=col)
                    except Exception:
                        pass
                q = P(o["x"], o["y"])
                d.text((q[0] + 3, q[1]), o["name"], fill=col)
    draw_line(d, t, P)
    draw_waypoints(d, cfg, P)
    im.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["route", "floors", "objects"])
    ap.add_argument("track")
    ap.add_argument("box", nargs="*", type=float, help="x0 x1 y0 y1 (floors / objects)")
    ap.add_argument("--z", nargs=2, type=float, help="only floors between these heights")
    ap.add_argument("--out")
    a = ap.parse_args()
    out = Path(a.out or ROOT / "work" / "maps" / f"{a.track}_{a.mode}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    if a.mode == "route":
        route(a.track, out)
    else:
        if len(a.box) != 4:
            sys.exit("floors / objects need x0 x1 y0 y1")
        floors_and_objects(a.track, a.box, a.z, out, a.mode == "objects")
    print(out)


if __name__ == "__main__":
    main()
