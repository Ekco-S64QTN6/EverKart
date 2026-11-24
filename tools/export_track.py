"""Export a track config (tracks/<name>.json) for the 3D game.

    python3 tools/export_track.py veeshan

Writes game/public/tracks/<name>.json:
    zone      glb file in game/public/zones/
    path      racing line resampled every ~6 units, in game axes (x, height, -y), on the
              floor of the zone (following the level it is already on)
    width     half width of the road in world units (for AI spread / off-track checks)
    grid      8 start positions + heading, behind the start line
    npcs      EQ NPC models to place beside the track (from the config)
"""
import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import eq, need  # noqa: E402
from navgrid import NavGrid  # noqa: E402
import export_gltf  # noqa: E402,F401

ROOT = Path(__file__).resolve().parent.parent


def resample(loop, step, closed=True):
    """Polyline -> points about `step` apart (closed: back round to the first point)."""
    pts = []
    keep = np.r_[True, np.linalg.norm(np.diff(loop, axis=0), axis=1) > 1e-6]
    loop = loop[keep]
    ring = np.vstack([loop, loop[:1]]) if closed else loop
    for a, b in zip(ring[:-1], ring[1:]):
        n = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        pts += [a + (b - a) * i / n for i in range(n)]
    if not closed:
        pts.append(loop[-1])
    return np.array(pts)


def shift(p, k, closed=True):
    """p moved k places along the line (a lap wraps round; an open line repeats its ends)."""
    if closed:
        return np.roll(p, k, axis=0)
    idx = np.clip(np.arange(len(p)) - k, 0, len(p) - 1)
    return p[idx]


def smooth(path, passes=6, closed=True):
    """Round the polyline's corners a little so karts take arcs, not points."""
    p = path.copy()
    for _ in range(passes):
        q = 0.25 * shift(p, 1, closed) + 0.5 * p + 0.25 * shift(p, -1, closed)
        if not closed:
            q[0], q[-1] = p[0], p[-1]
        p = q
    return p


def uturn_waypoint(xy, wp):
    """Index of the waypoint nearest to where the route doubles back, or None."""
    seg = np.diff(np.vstack([xy, xy[:1]]), axis=0)
    seg /= np.linalg.norm(seg, axis=1, keepdims=True) + 1e-9
    n = len(seg)
    for i in range(n):
        if seg[i] @ seg[(i + 4) % n] < -0.7:
            p = xy[(i + 2) % n]
            k = int(np.argmin(np.linalg.norm(wp - p, axis=1)))
            return k if k != 0 else None          # never drop the start
    return None


def z_hints(grid, wp, hint):
    """Which floor level each waypoint means: None (nearest), a height, or "top" (the
    highest floor in that spot - skips hidden planes under the zone)."""
    if hint is None:
        return None
    if hint != "top":
        return [float(hint)] * len(wp)
    out = []
    for x, y in wp:
        cx, cy = int((x - grid.x0) / grid.cell), int((y - grid.y0) / grid.cell)
        zs = []
        for r in range(0, 6):                     # the waypoint's own cell first, then widen
            zs = [grid.nodes[j, 2] for dx in range(-r, r + 1) for dy in range(-r, r + 1)
                  for j in grid.by_cell.get((cx + dx, cy + dy), ())]
            if zs:
                break
        out.append(max(zs) if zs else None)
    return out


def round_corners(xy, grid, closed, rmin, passes=300):
    """Round the line's corners until no turn is tighter than rmin, so a full-width road and
    its walls never fold over on the inside of a bend; a point only moves while it stays on the
    floor (the planner's grid), clear of walls."""
    from scipy.spatial import cKDTree
    nodes = grid.world(np.arange(len(grid.nodes)))
    tree = cKDTree(nodes[:, :2])
    n = len(xy)

    def radius(p):
        # the bend's radius at every scale (one, two and three points either side): a short sharp
        # kink is as much a fold as a long tight bend
        out = np.full(len(p), np.inf)
        for k in (1, 2, 3):
            a, b, c = shift(p, k, closed), p, shift(p, -k, closed)
            ab, bc, ca = np.linalg.norm(a - b, axis=1), np.linalg.norm(b - c, axis=1), np.linalg.norm(c - a, axis=1)
            area = np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])) / 2
            r = ab * bc * ca / (4 * area + 1e-6)
            if not closed:
                r[:k] = r[-k:] = np.inf
            out = np.minimum(out, r)
        return out

    for _ in range(passes):
        tight = radius(xy) < rmin
        if not tight.any():
            break
        grow = np.convolve(tight.astype(float), np.ones(9), mode="same") > 0
        avg = 0.25 * shift(xy, 1, closed) + 0.5 * xy + 0.25 * shift(xy, -1, closed)
        cand = np.where(grow[:, None], avg, xy)
        if not closed:
            cand[0], cand[-1] = xy[0], xy[-1]
        d, k = tree.query(cand[grow])
        ok = (d < grid.cell * 1.5) & (grid.clear[k] * grid.cell >= 4)
        idx = np.flatnonzero(grow)
        xy = xy.copy()
        xy[idx[ok]] = cand[idx[ok]]
    return xy


def shared_road(xy, closed):
    """Where the course comes back along a road it already took (out to a dead end and back,
    round a roundabout): (all points on a shared road, the later pass's points - drawn once)."""
    from scipy.spatial import cKDTree
    n = len(xy)
    tan = shift(xy, -1, closed) - shift(xy, 1, closed)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True) + 1e-9
    tree = cKDTree(xy)
    shared, later = set(), set()
    for i in range(n):
        for j in tree.query_ball_point(xy[i], 10.0):
            gap = abs(i - j) if not closed else min(abs(i - j), n - abs(i - j))
            if gap > 30 and tan[i] @ tan[j] < -0.5:
                shared.add(i)
                if j < i:
                    later.add(i)
                break
    return sorted(shared), sorted(later)


def lava_floor(zone, textures):
    """The zone's (non-solid) surfaces of these textures as extra planner floor: a causeway
    over a lava pool is planned at the lava's surface, not on the pool's bed."""
    mesh = np.load(ROOT / "work" / "zones" / zone / "mesh.npz", allow_pickle=True)
    mats = json.loads((ROOT / "work" / "zones" / zone / "materials.json").read_text())
    want = np.array([str(m.get("texture")) in textures for m in mats] + [False])
    tm = np.minimum(mesh["tri_material"], len(mats))
    sel = want[tm]
    return mesh["verts"].astype(np.float32), mesh["tris"][sel].astype(np.int64)


# placed objects that are part of the zone's architecture: never cleared off a road, never
# driven through (routes go round them, between them, through the middle of their arches)
ARCHITECTURE = r"ARCH|COLL|COLUMN|PILL|FRAME|WALL|STAT|BED|THRONE|MONU|PODIUM|MURAL|GATE|DOOR|BRIDGE|TOWER|PILLAR|FOUNTAIN"


def architecture(zone, extra=()):
    """Footprints of the zone's architectural objects: [(convex hull xy, z low, z high)]."""
    import re
    from scipy.spatial import ConvexHull
    from s3d import read_archive
    from wld import Wld
    obj = eq(f"{zone}_obj.s3d")
    placed = ROOT / "work" / "zones" / zone / "objects.json"
    if not obj.exists() or not placed.exists():
        return []
    files = read_archive(obj)
    wld = Wld(next(v for k, v in files.items() if k.endswith(".wld")))
    meshes = {m["name"].replace("_DMSPRITEDEF", ""): m for m in wld.meshes()}
    pat = re.compile(ARCHITECTURE)
    out = []
    for p in json.loads(placed.read_text()):
        m = meshes.get(p["name"])
        if m is None or not (pat.search(p["name"]) or p["name"] in extra) or not np.any(m["solid"]):
            continue
        a = np.radians(p["heading"] / 512 * 360)
        rot = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        v = m["verts"] @ rot.T * p["scale"] + [p["x"], p["y"], p["z"]]
        # what stands at kart height, piece by connected piece (an arch: each leg on its own, so
        # the opening between them stays open)
        tri = m["tris"]
        lowv = v[:, 2] < v[:, 2].min() + 12
        tl = tri[lowv[tri].any(axis=1)]
        if not len(tl):
            continue
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        e = np.r_[tl[:, [0, 1]], tl[:, [1, 2]], tl[:, [0, 2]]]
        g = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(v), len(v)))
        _, lab = connected_components(g, directed=False)
        used = np.unique(tl)
        for comp in np.unique(lab[used]):
            idx = used[lab[used] == comp]
            pts = v[idx][v[idx, 2] < v[:, 2].min() + 12][:, :2]
            if not len(pts):
                continue
            if len(pts) >= 3:
                try:
                    pts = pts[ConvexHull(pts).vertices]
                except Exception:
                    pass
            if len(pts) < 3:
                pts = np.array([pts[0] + [-1, -1], pts[0] + [1, -1], pts[0] + [1, 1], pts[0] + [-1, 1]])
            out.append((pts, float(v[:, 2].min()), float(v[:, 2].min()) + 12))
    return out


class WallMap:
    """Every wall face of the zone (walls, posts, columns, tree trunks: its steep triangles) on a
    1-unit raster, with heights: hit(x, y, z) - does a wall stand at (x, y) at a kart's body
    height above floor z (a low trim or a stair riser is not a wall: the road takes it)? Exact
    where the planner's 4-unit cells are not. With steep_only=False, every face (a placed object:
    a tent's sloping canvas blocks a road as surely as a wall), in its own height band."""

    def __init__(self, grid, verts, tris, lo, hi, steep_only=True, band=(6.0, 12.0)):
        self.band = band
        a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
        n = np.cross(b - a, c - a)
        steep = (np.abs(n[:, 2]) / (np.linalg.norm(n, axis=1) + 1e-9) <= 0.5) if steep_only else np.ones(len(tris), bool)
        tlo, thi = np.minimum(np.minimum(a, b), c), np.maximum(np.maximum(a, b), c)
        inb = (thi[:, 0] >= lo[0]) & (tlo[:, 0] <= hi[0]) & (thi[:, 1] >= lo[1]) & (tlo[:, 1] <= hi[1])
        sel = steep & inb
        pts = grid._surface_samples(a[sel], b[sel], c[sel], 0.9) if sel.any() else np.zeros((0, 3))
        key = (np.floor(pts[:, 0]).astype(np.int64) + 100000) * 300000 + (np.floor(pts[:, 1]).astype(np.int64) + 100000)
        order = np.argsort(key, kind="stable")
        key, self.z = key[order], pts[order, 2]
        self.keys, self.start = np.unique(key, return_index=True)
        self.end = np.r_[self.start[1:], len(key)]

    def hit(self, x, y, zf):
        k = (int(np.floor(x)) + 100000) * 300000 + (int(np.floor(y)) + 100000)
        j = int(np.searchsorted(self.keys, k))
        if j >= len(self.keys) or self.keys[j] != k:
            return False
        zs = self.z[self.start[j]:self.end[j]]
        return bool(np.any((zs > zf + self.band[0]) & (zs < zf + self.band[1])))   # (walls: at a kart's body height - a trim or a riser is a step)


class GroundQuery:
    """The zone's own ground under a point: every surface up to 60 degrees steep (a dune's face,
    a hillside), whatever the planner made of it (with steep_walls it keeps routes off slopes
    over 44 degrees and holds no floor there - but the road's bed cuts into them all the same).
    heights(x, y) -> the heights of the ground surfaces there."""

    def __init__(self, verts, tris, bucket=64.0):
        a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
        n = np.cross(b - a, c - a)
        up = np.abs(n[:, 2]) / (np.linalg.norm(n, axis=1) + 1e-9) >= 0.5   # (either winding)
        self.a, self.b, self.c = a[up], b[up], c[up]
        self.bucket, self.cells, self.cache = bucket, {}, {}
        lo = np.minimum(np.minimum(self.a, self.b), self.c)[:, :2] // bucket
        hi = np.maximum(np.maximum(self.a, self.b), self.c)[:, :2] // bucket
        for k in range(len(self.a)):
            for bx in range(int(lo[k, 0]), int(hi[k, 0]) + 1):
                for by in range(int(lo[k, 1]), int(hi[k, 1]) + 1):
                    self.cells.setdefault((bx, by), []).append(k)

    def heights(self, x, y):
        key = (round(x), round(y))
        if key in self.cache:
            return self.cache[key]
        out = []
        for k in self.cells.get((int(x // self.bucket), int(y // self.bucket)), ()):
            a, b, c = self.a[k], self.b[k], self.c[k]
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
            l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
            if l1 >= -1e-6 and l2 >= -1e-6 and l1 + l2 <= 1 + 1e-6:
                out.append(float(l1 * a[2] + l2 * b[2] + (1 - l1 - l2) * c[2]))
        self.cache[key] = out
        return out


class Footprints:
    """The ground plans of solid things (columns, statues, beds; lava pools, the sea) as a 1-unit
    raster: hit(x, y, z) - does one stand at (x, y) at about height z?
    A large shape (a sea's triangles, thousands of units across) is not rasterised - millions of
    cells - but kept as its outline and tested where asked, found through a coarse grid of buckets;
    only shapes inside `box` (the route's surroundings) are kept at all."""

    def __init__(self, shapes, res=1.0, box=None, big=4000.0, bucket=64.0):
        from matplotlib.path import Path as MPath
        self.res, self.cells = res, {}
        self.bucket, self.big, self.bigb = bucket, [], {}
        for poly, zl, zh in shapes:
            lo, hi = poly.min(axis=0), poly.max(axis=0)
            if box is not None:
                if (hi < box[0]).any() or (lo > box[1]).any():
                    continue
                lo, hi = np.maximum(lo, box[0]), np.minimum(hi, box[1])
            if np.prod(hi - lo) > big:
                k = len(self.big)
                self.big.append((MPath(poly), MPath(poly[::-1]), zl, zh))
                for bx in range(int(lo[0] // bucket), int(hi[0] // bucket) + 1):
                    for by in range(int(lo[1] // bucket), int(hi[1] // bucket) + 1):
                        self.bigb.setdefault((bx, by), []).append(k)
                continue
            gx, gy = np.meshgrid(np.arange(np.floor(lo[0]), np.ceil(hi[0]) + res, res),
                                 np.arange(np.floor(lo[1]), np.ceil(hi[1]) + res, res))
            pts = np.stack([gx.ravel(), gy.ravel()], axis=1)
            inside = MPath(poly).contains_points(pts) | MPath(poly[::-1]).contains_points(pts)
            for px, py in pts[inside]:
                self.cells.setdefault((int(px // res), int(py // res)), []).append((zl, zh))

    def hit(self, x, y, z):
        for zl, zh in self.cells.get((int(np.floor(x / self.res)), int(np.floor(y / self.res))), ()):
            if zl - 8 < z < zh:
                return True
        for k in self.bigb.get((int(x // self.bucket), int(y // self.bucket)), ()):
            path, rpath, zl, zh = self.big[k]
            if zl - 8 < z < zh and (path.contains_point((x, y)) or rpath.contains_point((x, y))):
                return True
        return False


def main(name):
    cfg = json.loads((ROOT / "tracks" / f"{name}.json").read_text())
    zone = cfg["zone"]
    closed = not cfg.get("open")                      # an open course runs start to finish once
    # plan on the zone as it was before roads were cleared (stable), unless the track needs the
    # cleared zone (Veeshan's Peak: its corridors are only open once their doors / statues go)
    planner = ROOT / "work" / "zones" / zone / "planner.npz"
    use_cleared = cfg.get("plan_cleared") or not planner.exists()
    col = np.load(ROOT / "work" / "zones" / zone / ("collision.npz" if use_cleared else "planner.npz"))
    wp = np.array(cfg["waypoints"], float)
    # route through the real 3D zone between the hand-picked waypoints
    tris = col["tris"]
    obj = col["tri_obj"] if "tri_obj" in col else np.zeros(len(tris), bool)   # a placed object's triangles
    avoid = set(cfg.get("avoid", []))                 # lava, lake beds: never route over these
    if avoid and "tri_tex" in col:
        names = [str(n) for n in col["tex_names"]]
        bad = np.array([names[t] in avoid if t >= 0 else False for t in col["tri_tex"]])
        tris, obj = tris[~bad], obj[~bad]
        print(f"  avoiding {int(bad.sum())} triangles of {sorted(avoid)}")
    verts = col["verts"]
    over = None
    if cfg.get("plan_over"):                           # bridge these surfaces (lava): see lava_floor
        lv, lt = lava_floor(zone, set(cfg["plan_over"]))
        if cfg.get("plan_over_box"):                   # only where the causeway is meant to be
            (bx0, by0), (bx1, by1) = cfg["plan_over_box"]
            cen = lv[lt].mean(axis=1)
            lt = lt[(cen[:, 0] >= bx0) & (cen[:, 0] <= bx1) & (cen[:, 1] >= by0) & (cen[:, 1] <= by1)]
        over = (lv, lt)
        tris = np.vstack([tris, lt + len(verts)])
        verts = np.vstack([verts, lv])
        print(f"  {len(lt)} triangles of {sorted(cfg['plan_over'])} planned as causeway")
    grid = NavGrid(verts, tris, (wp.min(axis=0) - 600, wp.max(axis=0) + 600),
                   min_z=cfg.get("min_floor_z"), level_room=cfg.get("level_room", False),
                   steep_walls=cfg.get("steep_walls", False), **({"step_up": cfg["step_up"]} if cfg.get("step_up") else {}))
    shapes = architecture(zone, cfg.get("keep_objects", []))
    under = []
    if avoid:                                         # lava / water that is not solid: the floor under it is not road
        lv, lt = lava_floor(zone, avoid)
        tri = lv[lt]
        nz = np.abs(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]))
        flat = nz[:, 2] / (np.linalg.norm(nz, axis=1) + 1e-9) > 0.8      # pools, not falls down a wall
        under = [(lv[t][:, :2].astype(float), float(lv[t][:, 2].min()) - 30, float(lv[t][:, 2].max()) + 1) for t in lt[flat]]
        if under:                                     # (except where a causeway is planned over it)
            print(f"  {grid.block(under, margin=4.0, keep_box=cfg.get('plan_over_box'))} floor cells under lava / water taken out")
    if shapes:
        print(f"  {grid.block(shapes, margin=cfg.get('architecture_margin', 4.0))} floor cells under {len(shapes)} pieces of architecture taken out")
    navgrid = grid
    footprints = Footprints([*shapes, *under], box=(wp.min(axis=0) - 700, wp.max(axis=0) + 700))
    walls = WallMap(grid, verts, tris, wp.min(axis=0) - 700, wp.max(axis=0) + 700)
    ground = GroundQuery(verts, tris[:len(obj)][~obj])
    things = WallMap(grid, verts, tris[:len(obj)][obj], wp.min(axis=0) - 700, wp.max(axis=0) + 700, steep_only=False, band=(1.0, 9.0))
    # the floor in a cell: what the planner routes on, and what it left out (under the margin
    # round lava and architecture, under a wall's foot or something low) - floor all the same
    # (under a branch or an arch high enough for a kart, not under a rock slab or a low roof)
    extra = {}
    for src in (getattr(grid, "dropped", {}), getattr(grid, "walled", {})):
        for cell, zz in src.items():
            extra.setdefault(cell, []).extend(zz)
    for cell, zz in getattr(grid, "roofed", {}).items():
        extra.setdefault(cell, []).extend(z for z, low in zz if low - z >= 7)
    # route, and drop waypoints that sit in dead ends (the route has to U-turn there)
    while True:
        hints = z_hints(grid, wp, cfg.get("z_hint"))
        if cfg.get("wp_z"):                            # per-waypoint floor heights (multi-level zones)
            hints = [h if h is not None else (hints[k] if hints else None) for k, h in enumerate(cfg["wp_z"])]
        routed, problems = grid.route(wp, hints, closed=closed, contour=cfg.get("contour"))
        if os.environ.get("DEBUG_WP"):                   # where each waypoint landed on the floor
            area = grid.main_area(wp)
            for k, (x, y) in enumerate(wp):
                j = grid.nearest(x, y, None if hints is None else hints[k], area)
                q = grid.world(np.array([j]))[0]
                print(f"  w{k} ({x:.0f}, {y:.0f}) -> ({q[0]:.0f}, {q[1]:.0f}, z {q[2]:.0f}) clear {grid.clear[j] * grid.cell:.0f}")
        if problems:
            print(f"  WARNING: no drivable route after waypoints {problems}; straight line used there")
        ring = cfg.get("roundabout")

        def shape_line(r, closed_):
            """Routed points -> the line karts follow: resampled, smoothed hard where there is room
            (open forest) and gently in corridors, corners rounded so a full-width road never folds."""
            x = resample(r[:, :2], 6.0, closed_)
            nr = np.array([grid.clear[grid.nearest(a, b)] * grid.cell for a, b in x])
            st = np.clip((nr - 12) / 30, 0, 1) * cfg.get("smooth_open", 1.0)   # 0 in tight corridors .. 1 in the open
            x = smooth(x, passes=3, closed=closed_)
            for _ in range(40):
                avg = 0.25 * shift(x, 1, closed_) + 0.5 * x + 0.25 * shift(x, -1, closed_)
                if not closed_:
                    avg[0], avg[-1] = x[0], x[-1]
                x = x + (avg - x) * st[:, None]
            return round_corners(x, grid, closed_, cfg.get("min_radius", 50))

        on_ring = None
        if ring:
            # once round a ring at the end of a road (round Hoshkar's island): the road to it (from
            # `from` to `at`) is built once - the way out is the way in, reversed, so it is exactly one
            # road - and the ring is an exact ellipse, anticlockwise (keep right)
            (cx, cy), (rx, ry), rz = ring["center"], ring["radius"], ring["z"]
            sx, sy = ring["from"]
            # the junction: where the road, aimed at the island's centre, meets the ring (a clean
            # right turn on, a clean right turn off)
            u = 1 / np.hypot((sx - cx) / rx, (sy - cy) / ry)
            jx, jy = cx + (sx - cx) * u, cy + (sy - cy) * u
            # the whole out-and-back stretch (from `back_to`, where the way out leaves the way in)
            bx, by = ring.get("back_to", ring["from"])
            jr = int(np.argmin(np.hypot(routed[:, 0] - jx, routed[:, 1] - jy)))
            k2 = jr + int(np.argmin(np.hypot(routed[jr:, 0] - bx, routed[jr:, 1] - by)))
            part_a, part_b = routed[:jr + 1], routed[k2:]
            k1 = int(np.argmin(np.hypot(part_a[:, 0] - bx, part_a[:, 1] - by)))
            xa = shape_line(part_a, False)
            ka = int(np.argmin(np.hypot(xa[:, 0] - bx, xa[:, 1] - by)))
            xb = shape_line(part_b, False)
            xb[0] = xa[ka]
            t0 = np.arctan2((jy - cy) / ry, (jx - cx) / rx)
            per = np.pi * (3 * (rx + ry) - np.sqrt((3 * rx + ry) * (rx + 3 * ry)))
            th = t0 + np.linspace(0, 2 * np.pi, int(per / 6) + 1)
            loop = np.stack([cx + rx * np.cos(th), cy + ry * np.sin(th), np.full_like(th, rz)], axis=1)
            xy = np.vstack([xa, loop[1:, :2], xa[ka:-1][::-1], xb[1:]])
            on_ring = np.zeros(len(xy), bool)
            on_ring[len(xa):len(xa) + len(loop) - 1] = True
            routed = np.vstack([part_a, loop, part_a[k1:][::-1], part_b])
        else:
            xy = shape_line(routed, closed)
        if not closed:
            break                                     # an open course comes back along a road on purpose
        k = uturn_waypoint(xy, wp)
        if k is None or len(wp) <= 3 or not cfg.get("drop_dead_ends"):   # only warn, unless the track opts in
            break
        print(f"  waypoint {k} {wp[k].tolist()} is a dead end; dropped (saved to tracks/{name}.json)")
        wp = np.delete(wp, k, axis=0)
        cfg["waypoints"] = wp.round(1).tolist()
        (ROOT / "tracks" / f"{name}.json").write_text(json.dumps(cfg, indent=1))
    # heights: from the route, following it (nearest routed point)
    # (matched in order along the route, so a corridor over another one keeps its own floor)
    ra = np.r_[0, np.cumsum(np.linalg.norm(np.diff(routed[:, :2], axis=0), axis=1))]
    xa = np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
    guess = np.searchsorted(ra, xa * (ra[-1] / max(xa[-1], 1e-6))).clip(0, len(routed) - 1)
    near = np.empty(len(xy), int)
    for i, g in enumerate(guess):
        lo, hi = max(0, g - 60), min(len(routed), g + 61)
        near[i] = lo + int(np.argmin(((routed[lo:hi, :2] - xy[i]) ** 2).sum(1)))
    z = routed[near, 2]
    z = np.convolve(np.r_[z[-2:], z, z[:2]] if closed else np.r_[[z[0]] * 2, z, [z[-1]] * 2], np.ones(5) / 5, mode="valid")
    game = np.stack([xy[:, 0], z, -xy[:, 1]], axis=1)              # EQ -> game axes
    # local room on either side of the line (corridor half width), for CPU lane choice
    node_of = [grid.nearest(*routed[j, :2], routed[j, 2]) for j in range(len(routed))]
    room = np.array([grid.clear[node_of[j]] * grid.cell for j in near])
    room = np.minimum.reduce([shift(room, k, closed) for k in range(-3, 4)])   # be conservative
    # the free floor on each side of the line (the road's edges go out to it): out across the line,
    # a unit at a time, while there is floor at the line's level - no step of more than 4.5 between
    # neighbouring 4-unit cells (a ledge or a riser; a sloping floor, sampled to whole units, jumps
    # 2-3 from cell to cell) and never far above or below the floor under the line - up to the footprint of a column, a statue or the lava itself (the planner
    # keeps its routes well clear of those; the road goes right up to them, its wall there)
    pick = lambda v: int(np.argmin(np.hypot(xy[:, 0] - float(v.split(":")[0]), xy[:, 1] - float(v.split(":")[1])))) if ":" in v else int(v)
    dbg = {pick(v) for v in os.environ.get("DEBUG_ROOM", "").split(",") if v.strip()}

    def side_room(sg, reach=60.0):
        """The free floor beside the line on one side (sg 1 right, -1 left), in units: out across
        the line a unit at a time while there is floor the road can be laid on - the game shapes
        the zone's ground to the road, cutting up to 20 and filling up to 8, so rolling ground and
        hillsides are road; a ledge or a riser (a step of more than 4.5 between neighbouring
        4-unit cells), a drop, the footprint of a column, a statue or lava, a wall face at kart
        height (WallMap: 1-unit exact - a post, a tree trunk, the cavern wall), or two cells in a
        row with no floor at all end it. A single empty cell is stepped over, and so is the
        line's own cell when its floor is a step off."""
        out = np.zeros(len(xy))
        zs = grid.nodes[:, 2]
        first = 20.0    # the floor beside the line: anything the road's bed can cut or fill to (a line smoothed
                        # onto a dune's flank keeps its valley's height; on stairs it is graded across them)
        for i in range(len(xy)):
            a, b = xy[max(i - 1, 0)], xy[min(i + 1, len(xy) - 1)]
            t = b - a
            tl = np.hypot(*t)
            if tl < 1e-6:
                continue
            rx, ry = t[1] / tl * sg, -t[0] / tl * sg          # right of travel (sg 1) / left (-1), EQ x, y
            zc, z0 = z[i], None                           # z0: the floor under (or just beside) the line
            d, last, missing, good = 0.0, None, 0, 0.0
            while d < reach:
                x, y = xy[i, 0] + rx * (d + 1), xy[i, 1] + ry * (d + 1)
                if footprints.hit(x, y, z[i]) or walls.hit(x, y, zc) or things.hit(x, y, zc):
                    if i in dbg:
                        why = "footprint" if footprints.hit(x, y, z[i]) else "wall" if walls.hit(x, y, zc) else "object"
                        print("  stop", i, sg, round(d), why, round(x, 1), round(y, 1), round(zc, 1))
                    break                             # a column's or the lava's footprint; a wall face
                cell = (int(np.floor((x - grid.x0) / grid.cell)), int(np.floor((y - grid.y0) / grid.cell)))
                if cell != last:
                    last = cell
                    raw = [zs[j] for j in grid.by_cell.get(cell, ())] + extra.get(cell, [])

                    def within(cs):
                        if z0 is None:
                            return [v for v in cs if abs(v - z[i]) <= first]
                        # (a step of more than 7 between cells - steeper than 60 degrees: a ledge or a
                        # riser - ends it, unless the floor beyond is still within 5.5 of the road itself:
                        # a low dais or kerb beside the line, or the line climbing onto one; and never
                        # more than the road's bed cuts or fills (20): a hillside beside the road is cut
                        # into, the road a shelf along it; along a ridge it is an embankment)
                        return [v for v in cs if (abs(v - zc) <= 7 or abs(v - z[i]) <= 5.5)
                                and -20 <= v - z[i] <= 20]
                    cand = within(raw) or within(ground.heights(x, y))   # (else the zone's own ground)
                    if not cand:
                        missing += 1
                        if missing >= 2 or (z0 is None and d >= 8):
                            if i in dbg:
                                print("  stop", i, sg, round(d), "no floor", cell, round(zc, 1), z0)
                            break
                    else:
                        missing = 0
                        zc = min(cand, key=lambda v: abs(v - zc))
                        if z0 is None:
                            z0 = zc
                        good = d + 1
                d += 1
            out[i] = good if z0 is not None else 0.0
        return out
    room_r, room_l = side_room(1), side_room(-1)
    if os.environ.get("DEBUG_ROOM"):                  # path indices, or EQ x:y spots (the nearest point)
        for i in sorted(dbg):
            zs = grid.nodes[:, 2]
            for sg in (1, -1):
                a, b = xy[max(i - 1, 0)], xy[min(i + 1, len(xy) - 1)]
                t = (b - a) / np.hypot(*(b - a)); rx, ry = t[1] * sg, -t[0] * sg
                row = []
                for d in range(0, 40, 4):
                    x, y = xy[i, 0] + rx * (d + 2), xy[i, 1] + ry * (d + 2)
                    cell = (int(np.floor((x - grid.x0) / grid.cell)), int(np.floor((y - grid.y0) / grid.cell)))
                    row.append(sorted(round(float(zs[j]), 1) for j in grid.by_cell.get(cell, ()))
                               + [f"x{v:.0f}" for v in extra.get(cell, [])]
                               + (["FP"] if footprints.hit(x, y, z[i]) else [])
                               + (["W"] if walls.hit(x, y, z[i]) else []))
                print("  room", i, sg, round(float(z[i]), 1), row)
    # a road taken both ways (in and out of a lair) is one road, drawn once; the karts keep right
    shared, later = shared_road(xy, closed)
    ring_out = None
    if ring and on_ring is not None:                  # the ring's points, and the ring itself (drawn whole)
        idx_ring = np.flatnonzero(on_ring)
        z[on_ring] = ring["z"]
        box = cfg.get("plan_over_box")
        if box:                                       # the causeway to it at the ring's height: they meet flush
            (bx0, by0), (bx1, by1) = box
            inbox = (xy[:, 0] >= bx0) & (xy[:, 0] <= bx1) & (xy[:, 1] >= by0) & (xy[:, 1] <= by1)
            z[inbox] = np.maximum(z[inbox], ring["z"])
        game = np.stack([xy[:, 0], z, -xy[:, 1]], axis=1)
        ring_out = {"center": [cx, cy], "radius": [rx, ry], "z": ring["z"], "half_width": ring.get("half_width", 24),
                    "first": int(idx_ring[0]), "last": int(idx_ring[-1]), "start_angle": float(t0)}
        shared = [i for i in shared if not on_ring[i]]
        later = [i for i in later if not on_ring[i]]
    # causeway spans: the line runs over a planned-over surface (lava), not on the zone's floor
    deck = []
    if over is not None:
        lv, lt = over
        a, b, c = lv[lt[:, 0]], lv[lt[:, 1]], lv[lt[:, 2]]
        lo = np.minimum(np.minimum(a, b), c)[:, :2]
        hi = np.maximum(np.maximum(a, b), c)[:, :2]
        # the zone's own solid floor heights per planner cell (no causeway where there is floor)
        V0, T0 = col["verts"], col["tris"]
        fa, fb, fc = V0[T0[:, 0]], V0[T0[:, 1]], V0[T0[:, 2]]
        fn = np.cross(fb - fa, fc - fa)
        fl = fn[:, 2] / (np.linalg.norm(fn, axis=1) + 1e-9) < -0.72
        solid = grid._sample_heights(fa[fl], fb[fl], fc[fl])
        for i, (x, y) in enumerate(xy):
            cell = (int((x - grid.x0) / grid.cell), int((y - grid.y0) / grid.cell))
            hs = solid.get(cell)
            if hs is not None and np.any(np.abs(hs - z[i]) < 3):
                continue
            cand = np.flatnonzero((lo[:, 0] <= x) & (hi[:, 0] >= x) & (lo[:, 1] <= y) & (hi[:, 1] >= y))
            for t in cand:                            # inside the triangle (2D) and near its height
                v0, v1, v2 = a[t, :2], b[t, :2], c[t, :2]
                cr = lambda u, w: u[0] * w[1] - u[1] * w[0]
                q = np.array([x, y])
                d0, d1, d2 = cr(v1 - v0, q - v0), cr(v2 - v1, q - v1), cr(v0 - v2, q - v2)
                if ((d0 >= 0) == (d1 >= 0) == (d2 >= 0)) and -6 < z[i] - a[t, 2] < 14:   # the line just above the lava
                    deck.append(i)
                    break
        deck = sorted(set(j for i in deck for j in range(max(0, i - 4), min(len(xy), i + 5))))
    if ring_out:                                      # the ring is a deck over the lava: nothing shaped under it
        deck = sorted(set(deck) | set(range(ring_out["first"], ring_out["last"] + 1)))
        print(f"  causeway over {len(deck)} path points")

    # U-turns (a dead-end waypoint) are undrivable: warn
    seg = np.diff(np.vstack([xy, xy[:1]]) if closed else xy, axis=0)
    seg /= np.linalg.norm(seg, axis=1, keepdims=True) + 1e-9
    for i in range(len(seg) - (0 if closed else 4)):
        if seg[i] @ seg[(i + 4) % len(seg)] < -0.7:
            print(f"  WARNING: route doubles back near path point {i} ({xy[i][0]:.0f}, {xy[i][1]:.0f}) - move or drop a waypoint")
            break

    # start line: the widest straight stretch (open both behind, for the grid, and ahead);
    # an open course starts where it starts: the grid on the first ~100 units of the path
    start = 0
    if not closed:
        start = int(cfg.get("start_index", 20))
    elif cfg.get("auto_start", True):
        tang = np.diff(np.vstack([xy, xy[:1]]), axis=0)
        tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
        n = len(xy)
        best, best_score = 0, -1
        for i in range(n):
            win = [(i + k) % n for k in range(-30, 36)]
            straight = min(float(tang[j] @ tang[i]) for j in win)
            if straight < 0.92:
                continue
            zs = [z[j] for j in win]
            slope = max(zs) - min(zs)                    # the grid wants level ground
            side = np.array([tang[i][1], -tang[i][0]])   # ... across the road too
            tilt = 0.0
            for j in win[::6]:
                for sgn in (-1, 1):
                    q = xy[j] + side * sgn * cfg["half_width"] * 0.6
                    hs = navgrid.levels.get((int((q[0] - navgrid.x0) / navgrid.cell), int((q[1] - navgrid.y0) / navgrid.cell)))
                    if hs is not None and len(hs):
                        tilt = max(tilt, min(abs(h - z[j]) for h in hs))
            score = min(60.0, min(room[j] for j in win)) - 6 * (slope + tilt) + 1000   # flattest, then widest

            if score > best_score:
                best, best_score = i, score
        if best_score > 0:
            game = np.roll(game, -best, axis=0)
            room = np.roll(room, -best)
            room_r, room_l = np.roll(room_r, -best), np.roll(room_l, -best)
            xy = np.roll(xy, -best, axis=0)
            print(f"  start line at path point {best} (score {best_score - 1000:.0f}: room minus 6 x slope)")

    # bridges (`bridges` in the track file): where the zone's way is too narrow for a kart track - a
    # sunken aisle between raised platforms - the road leaves the floor on its own deck: a ramp up
    # from the floor, level at the deck's height over the narrow part, down again if the far end
    # is lower; its sides run down to the floor, and nothing of the zone under it is reshaped
    bridges_out = []
    for b in cfg.get("bridges", []):
        (fx, fy), (tx, ty), bz = b["from"], b["to"], float(b["z"])
        i0 = int(np.argmin(np.hypot(xy[:, 0] - fx, xy[:, 1] - fy)))
        i1 = int(np.argmin(np.hypot(xy[:, 0] - tx, xy[:, 1] - ty)))
        if i1 <= i0:
            print(f"  WARNING bridge {b['from']} -> {b['to']}: its ends are the wrong way round along the course")
            continue
        ramp = float(b.get("ramp", 140))
        seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy[i0:i1 + 1], axis=0), axis=1))]
        floor = game[i0:i1 + 1, 1].copy()
        ease = lambda u: u * u * (3 - 2 * u)
        up = ease(np.clip(seg / ramp, 0, 1))
        down = ease(np.clip((seg[-1] - seg) / ramp, 0, 1)) if floor[-1] < bz - 1 else np.ones_like(seg)
        prof = floor[0] + (bz - floor[0]) * up
        prof = np.minimum(prof, floor[-1] + (bz - floor[-1]) * down)
        h = np.maximum(floor, prof)
        game[i0:i1 + 1, 1] = h
        raised = [i0 + k for k in range(len(h)) if h[k] > floor[k] + 1.0]
        deck = sorted(set(deck) | set(raised))
        bridges_out.append({"first": i0, "last": i1, "z": bz, **({"half_width": b["half_width"]} if "half_width" in b else {})})
        print(f"  bridge at {bz:.0f}: path points {i0}..{i1}, {len(raised)} above the floor")

    # start grid: two staggered columns along the route behind the line
    fwd = game[start + 1] - game[start]
    fwd[1] = 0
    fwd /= np.linalg.norm(fwd)
    hw = cfg["half_width"]
    grid = []
    n = len(game)
    for i in range(8):
        j = (n - 2 - i * 2) % n if closed else max(1, start - 2 - i * 2)   # ~12 units per row, following the route
        t = game[(j + 1) % n] - game[j - 1]
        t[1] = 0
        t /= np.linalg.norm(t) + 1e-9
        side = np.array([-t[2], 0, t[0]])
        p = game[j] + side * (-0.3 if i % 2 == 0 else 0.3) * hw
        grid.append([round(float(c), 2) for c in p])
    heading = float(np.arctan2(fwd[0], -fwd[2]))                   # yaw about +y, 0 = -z
    # course dressing textures (road surface, kerbs, rails, posts) from the zone's own files
    course = dict(cfg.get("course", {}))
    if course:
        import io
        from export_gltf import encode
        from PIL import Image
        from s3d import open_image, read_archive
        archives = [read_archive(need(f"{zone}.s3d"))]
        if eq(f"{zone}_obj.s3d").exists():
            archives.append(read_archive(eq(f"{zone}_obj.s3d")))
        if not any("brailing1.bmp" in a for a in archives) and eq("gfaydark.s3d").exists():
            archives.append(read_archive(eq("gfaydark.s3d")))      # Kelethin's railing
        texdir = ROOT / "game" / "public" / "tex"
        texdir.mkdir(parents=True, exist_ok=True)
        # each texture at the zone's own scale: world units per repeat, as the zone maps it
        mesh = np.load(ROOT / "work" / "zones" / zone / "mesh.npz", allow_pickle=True)
        mats = json.loads((ROOT / "work" / "zones" / zone / "materials.json").read_text())
        for role in ("road", "kerb", "barrier"):
            tex = course.get(role)
            if not tex or f"{role}_tile" in course:
                continue
            sel = np.array([str(mats[m].get("texture")) == tex if m < len(mats) else False for m in mesh["tri_material"]])
            if sel.any():
                t = mesh["tris"][sel]
                v, uv = mesh["verts"], mesh["uv"]
                wl = np.linalg.norm(v[t[:, 1]] - v[t[:, 0]], axis=1)
                ul = np.linalg.norm(uv[t[:, 1]] - uv[t[:, 0]], axis=1)
                ok = ul > 1e-3
                if ok.sum() > 3:
                    course[f"{role}_tile"] = round(float(np.median(wl[ok] / ul[ok])), 1)
        for role in ("road", "kerb", "rail", "post", "barrier"):
            tex = course.get(role)
            data = next((a[tex] for a in archives if tex and tex in a), None)
            if not data:
                course.pop(role, None)
                continue
            im = open_image(data)
            png, _ = encode(im, masked=(role == "rail"))
            out = texdir / f"{zone}_{role}.png"
            out.write_bytes(png)
            course[role] = f"tex/{out.name}"
    # a training run (a monk pulling a pack down a hall): planned on the floor between its ends
    vignettes = []
    for v in cfg.get("vignettes", []):
        v = dict(v)
        if v.get("kind") == "train" and v.get("to"):
            a0 = navgrid.nearest(v["at"][0], v["at"][1], v["at"][2] if len(v["at"]) > 2 else None)
            b0 = navgrid.nearest(v["to"][0], v["to"][1], v["to"][2] if len(v["to"]) > 2 else None)
            p = navgrid.astar(a0, b0)
            if p:
                pts = navgrid.world(np.array(p))[::2]
                v["route"] = [[round(float(x), 1), round(float(z), 1), round(float(-y), 1)] for x, y, z in pts]
            else:
                print(f"  WARNING: no floor for the training run {v.get('title')}")
        vignettes.append(v)
    out = {
        "name": name, "title": cfg.get("title", name), "zone": f"{zone}.glb",
        "width": hw, "path": np.round(game, 2).tolist(), "room": np.round(room, 1).tolist(), "room_r": np.round(room_r, 1).tolist(), "room_l": np.round(room_l, 1).tolist(),
        "grid": grid, "heading": heading,
        **({"open": True, "start": start, "finish": len(game) - 1 - int(cfg.get("runout", 14))} if not closed else {}),
        **({"shared": shared, "shared_later": later} if shared else {}),
        **({"ring": ring_out} if ring_out else {}),
        **({"deck": deck} if deck else {}),
        **({"bridges": bridges_out} if bridges_out else {}),
        "npcs": cfg.get("npcs3d", []),
        "music": cfg.get("music3d"),
        "laps": cfg.get("laps", 3),
        # landmark scenes: EQ (x, y, z) -> game (x, z, -y); z None = on the ground
        "scenes": [{**sc, "pos": [sc["at"][0], sc["at"][2] if len(sc["at"]) > 2 else None, -sc["at"][1]]}
                   for sc in cfg.get("scenes", [])],
        "skirmishes": cfg.get("skirmishes", []),
        # intro vignettes: EQ (x, y[, z]) -> game (x, z or None, -y)
        "vignettes": [{**v, "pos": [v["at"][0], v["at"][2] if len(v["at"]) > 2 else None, -v["at"][1]]} if "at" in v else v
                      for v in vignettes],
        "course": course,
    }
    dest = ROOT / "game" / "public" / "tracks"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"{name}.json").write_text(json.dumps(out))
    print(f"{name}: {len(game)} path points, {'lap' if closed else 'start to finish'} {np.linalg.norm(np.diff(game, axis=0), axis=1).sum():.0f} units, "
          f"height {z.min():.0f}..{z.max():.0f}")


if __name__ == "__main__":
    for n in sys.argv[1:]:
        main(n)
