"""Drivable-route planning through a 3D EQ zone.

Builds a grid of floor "nodes" from the game's collision triangles (work/zones/<zone>/
collision.npz, EQ axes): every cell can hold several floor levels (bridges, balconies,
Kelethin over the forest). A node is blocked when a wall reaches into the kart's body
height above it. Karts can climb small steps and drop off ledges, not climb them.

route(waypoints) then strings A* paths between consecutive waypoints (rough intent
picked on the floorplan) into a closed loop (or, for a point-to-point course, an open
path), preferring corridor centres.
"""
import heapq

import numpy as np
from scipy import ndimage

CELL = 4.0          # world units per grid cell
STEP_UP = 7.0       # tallest step a kart climbs (matches the game's kart tuning)
DROP = 12.0         # tallest ledge it will drive off (steep banks read as walls in game)
BODY = (2.5, 10.0)  # height band above the floor that must be free of walls
HEADROOM = 9.0      # minimum gap to the ceiling


class NavGrid:
    def __init__(self, verts, tris, bounds, cell=CELL, min_z=None, level_room=False, steep_walls=False, step_up=STEP_UP):
        """min_z: floors below this are unusable (under lava / water surfaces).
        level_room: measure corridor width over connected floor only (stairs beside a lower
        floor count as narrow), instead of in 2D.
        steep_walls: slopes too steep to drive (44-60 degrees: rock spires, dune faces) block
        like walls; without it only faces steeper than 60 degrees do.
        step_up: tallest step taken (stairs in halls: the game grades them into a ramp)."""
        self.level_room = level_room
        self.step_up = step_up
        # walls in this band above a floor block it; with taller steps allowed, a riser up to
        # the step height is a step, not a wall
        body = BODY if step_up <= STEP_UP else (step_up + 0.5, step_up + 10.0)
        self.cell = cell
        (x0, y0), (x1, y1) = bounds
        self.x0, self.y0 = x0, y0
        self.w = int(np.ceil((x1 - x0) / cell)) + 1
        self.h = int(np.ceil((y1 - y0) / cell)) + 1
        a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
        n = np.cross(b - a, c - a)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        lo, hi = np.minimum(np.minimum(a, b), c), np.maximum(np.maximum(a, b), c)
        inb = (hi[:, 0] >= x0) & (lo[:, 0] <= x1) & (hi[:, 1] >= y0) & (lo[:, 1] <= y1)
        floor = inb & (n[:, 2] < -0.72)           # up-facing (EQ winding), 44 degrees or flatter
        ceil = inb & (n[:, 2] > 0.5)
        wall = inb & ((n[:, 2] >= -0.72) & (n[:, 2] <= 0.5) if steep_walls else np.abs(n[:, 2]) <= 0.5)
        self.levels = self._sample_heights(a[floor], b[floor], c[floor])
        ceilings = self._sample_heights(a[ceil], b[ceil], c[ceil])
        wall_z = self._sample_wall(a[wall], b[wall], c[wall])
        # nodes: (cell, height); drop duplicate heights within a step
        nodes = []
        self.walled, self.roofed = {}, {}       # floor left out, and why (the road's edges need to know)
        for (cx, cy), hs in self.levels.items():
            hs = np.sort(np.array(hs))
            keep = [hs[0]]
            for z in hs[1:]:
                if z - keep[-1] > self.step_up:
                    keep.append(z)
                else:
                    keep[-1] = max(keep[-1], z)
            for z in keep:
                if min_z is not None and z < min_z:
                    continue
                ws = wall_z.get((cx, cy))
                if ws is not None and np.any((ws > z + body[0]) & (ws < z + body[1])):
                    self.walled.setdefault((cx, cy), []).append(float(z))   # a wall stands here: a post, a column
                    continue
                cs = ceilings.get((cx, cy))
                if cs is not None and np.any((cs > z) & (cs < z + HEADROOM)):
                    low = float(cs[(cs > z) & (cs < z + HEADROOM)].min())
                    self.roofed.setdefault((cx, cy), []).append((float(z), low))   # floor under something low (its height)
                    continue
                nodes.append((cx, cy, z))
        self.nodes = np.array(nodes, float)
        self.by_cell = {}
        for i, (cx, cy, z) in enumerate(nodes):
            self.by_cell.setdefault((int(cx), int(cy)), []).append(i)
        self._clearance()

    def _cells_of(self, pts):
        return (np.floor((pts[:, 0] - self.x0) / self.cell).astype(int),
                np.floor((pts[:, 1] - self.y0) / self.cell).astype(int))

    def _surface_samples(self, a, b, c, spacing):
        """Points spread over each triangle about `spacing` apart (incl. vertices/edges)."""
        out = [a, b, c, (a + b) / 2, (b + c) / 2, (a + c) / 2, (a + b + c) / 3]
        size = np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - a, axis=1))
        for k in np.unique(np.clip(np.ceil(size / spacing).astype(int), 1, 256)):   # (long ramps: no gaps)
            if k < 2:
                continue
            sel = np.ceil(size / spacing).clip(1, 256).astype(int) == k
            if not sel.any():
                continue
            i, j = np.meshgrid(np.arange(k + 1), np.arange(k + 1))
            m = (i + j) <= k
            u, v = i[m] / k, j[m] / k
            out.append((a[sel][:, None] * (1 - u - v)[None, :, None] + b[sel][:, None] * u[None, :, None]
                        + c[sel][:, None] * v[None, :, None]).reshape(-1, 3))
        return np.concatenate(out)

    def _sample_heights(self, a, b, c):
        pts = self._surface_samples(a, b, c, self.cell * 0.5)
        cx, cy = self._cells_of(pts)
        ok = (cx >= 0) & (cy >= 0) & (cx < self.w) & (cy < self.h)
        cx, cy, z = cx[ok], cy[ok], pts[ok, 2]
        key = cx * self.h + cy
        order = np.argsort(key)
        key, z = key[order], z[order]
        out = {}
        bounds = np.flatnonzero(np.diff(key)) + 1
        for ks, zs in zip(np.split(key, bounds), np.split(z, bounds)):
            if len(ks):
                zs = np.unique(np.round(zs, 0))
                out[(int(ks[0] // self.h), int(ks[0] % self.h))] = zs
        return out

    def _sample_wall(self, a, b, c):
        return self._sample_heights(a, b, c)

    def _clearance(self):
        """Distance (in cells) from each node to the nearest cell with no node at that height."""
        if self.level_room:
            return self._level_clearance()
        n = len(self.nodes)
        occ = np.zeros((self.w, self.h), bool)
        for (cx, cy) in self.by_cell:
            occ[cx, cy] = True
        # 2D approximation per height band: good enough for corridors
        dist = ndimage.distance_transform_edt(occ)
        self.clear = np.array([dist[int(cx), int(cy)] for cx, cy, _ in self.nodes]) if n else np.zeros(0)

    def _level_clearance(self):
        """Clearance along the floor itself: graph distance to the nearest edge node (a node
        missing a same-level neighbour in some direction)."""
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import dijkstra
        n = len(self.nodes)
        rows, cols, w = [], [], []
        edge = np.zeros(n, bool)
        dirs = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]
        for i, (cx, cy, z) in enumerate(self.nodes):
            for dx, dy in dirs:
                found = False
                for j in self.by_cell.get((int(cx) + dx, int(cy) + dy), ()):
                    if abs(self.nodes[j, 2] - z) <= self.step_up:
                        found = True
                        if j > i:
                            rows.append(i)
                            cols.append(j)
                            w.append(np.hypot(dx, dy))
                if not found:
                    edge[i] = True
        g = coo_matrix((w, (rows, cols)), shape=(n, n)).tocsr()
        src = np.flatnonzero(edge)
        if not len(src):
            self.clear = np.full(n, 99.0)
            return
        d = dijkstra(g, directed=False, indices=src, min_only=True)
        self.clear = np.where(np.isfinite(d), d + 1.0, 0.0)

    def _has_level(self, cell, z):
        return any(abs(self.nodes[j, 2] - z) <= self.step_up for j in self.by_cell.get(cell, ()))

    def neighbours(self, i):
        cx, cy, z = self.nodes[i]
        cx, cy = int(cx), int(cy)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                # no cutting a corner: a diagonal step needs both cells beside it open too
                if dx and dy and not (self._has_level((cx + dx, cy), z) and self._has_level((cx, cy + dy), z)):
                    continue
                for j in self.by_cell.get((cx + dx, cy + dy), ()):
                    dz = self.nodes[j, 2] - z
                    if dz <= self.step_up and dz >= -max(DROP, self.step_up):
                        yield j, np.hypot(dx, dy)

    def block(self, shapes, margin=3.0, keep_box=None):
        """Take the floor out from under solid shapes: [(polygon xy (k, 2), z_low, z_high)].
        Architecture (columns, arches' legs, statues, beds) is never driven through."""
        from matplotlib.path import Path as MPath
        drop = np.zeros(len(self.nodes), bool)
        cxy = self.world(np.arange(len(self.nodes)))
        for poly, zl, zh in shapes:
            lo, hi = poly.min(axis=0) - margin, poly.max(axis=0) + margin
            cand = np.flatnonzero((cxy[:, 0] >= lo[0]) & (cxy[:, 0] <= hi[0]) & (cxy[:, 1] >= lo[1]) & (cxy[:, 1] <= hi[1])
                                  & (cxy[:, 2] > zl - 8) & (cxy[:, 2] < zh))
            if not len(cand):
                continue
            inside = MPath(poly).contains_points(cxy[cand, :2], radius=margin * 2) | MPath(poly[::-1]).contains_points(cxy[cand, :2], radius=margin * 2)
            drop[cand[inside]] = True
        if keep_box is not None:                        # never inside this box (a causeway over lava)
            (bx0, by0), (bx1, by1) = keep_box
            drop &= ~((cxy[:, 0] >= bx0) & (cxy[:, 0] <= bx1) & (cxy[:, 1] >= by0) & (cxy[:, 1] <= by1))
        if not drop.any():
            return 0
        if not hasattr(self, "dropped"):               # the floor taken out (it is there, but not to route on)
            self.dropped = {}
        for cx, cy, z in self.nodes[drop]:
            self.dropped.setdefault((int(cx), int(cy)), []).append(float(z))
        self.nodes = self.nodes[~drop]
        self.by_cell = {}
        for i, (cx, cy, z) in enumerate(self.nodes):
            self.by_cell.setdefault((int(cx), int(cy)), []).append(i)
        if hasattr(self, "_comp"):
            del self._comp
        self._clearance()
        return int(drop.sum())

    def nearest(self, x, y, z_hint=None, mask=None):
        d = np.hypot(self.nodes[:, 0] * self.cell + self.x0 - x, self.nodes[:, 1] * self.cell + self.y0 - y)
        if z_hint is not None:
            d = d + np.abs(self.nodes[:, 2] - z_hint) * 4
        d = d - np.minimum(self.clear, 6) * 2            # prefer open floor over corners
        if mask is not None:
            d = np.where(mask, d, np.inf)
        return int(np.argmin(d))

    def components(self):
        """Label each node with its connected area (two-way drivable links: steps both ways)."""
        if hasattr(self, "_comp"):
            return self._comp
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        rows, cols = [], []
        for i, (cx, cy, z) in enumerate(self.nodes):
            for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
                for j in self.by_cell.get((int(cx) + dx, int(cy) + dy), ()):
                    if abs(self.nodes[j, 2] - z) <= self.step_up:
                        rows.append(i)
                        cols.append(j)
        n = len(self.nodes)
        g = coo_matrix((np.ones(len(rows), np.int8), (rows, cols)), shape=(n, n))
        _, self._comp = connected_components(g, directed=False)
        return self._comp

    def main_area(self, waypoints, radius=40.0):
        """The connected area most waypoints stand on (ignores tree tops, roofs, hidden planes)."""
        comp = self.components()
        sizes = np.bincount(comp)
        votes, heights = {}, {}
        for x, y in waypoints:
            d = np.hypot(self.nodes[:, 0] * self.cell + self.x0 - x, self.nodes[:, 1] * self.cell + self.y0 - y)
            near = d < radius
            for c in set(comp[near].tolist()):
                votes[c] = votes.get(c, 0) + 1
                heights.setdefault(c, []).append(float(self.nodes[near & (comp == c), 2].mean()))
        # most waypoints first; between floors every waypoint stands on (the ground and a hidden
        # plane under the zone, like Oasis's at z -262), the upper one
        best = max(votes, key=lambda c: (votes[c], np.mean(heights[c]))) if votes else int(np.argmax(sizes))
        return comp == best

    def astar(self, s, g, min_clear=1.5, contour=None):
        goal = self.nodes[g]
        pen = 6.0 / (np.minimum(self.clear, 12) + 0.5)   # walls cost extra: drive mid-corridor
        if contour:                                      # a road along a shore or a hillside: keep to one height
            pen = pen * contour.get("centre", 0.3) + contour.get("weight", 0.3) * np.abs(self.nodes[:, 2] - contour["z"]) / 10
        best = {s: 0.0}
        prev = {}
        heap = [(0.0, s)]
        while heap:
            f, i = heapq.heappop(heap)
            if i == g:
                break
            gi = best[i]
            if f - self._h(i, goal) > gi + 1e-6:
                continue
            for j, step in self.neighbours(i):
                if self.clear[j] < min_clear and j != g:
                    continue
                cost = gi + step * (1 + pen[j])
                if cost < best.get(j, np.inf):
                    best[j] = cost
                    prev[j] = i
                    heapq.heappush(heap, (cost + self._h(j, goal), j))
        if g not in prev and g != s:
            return None
        path = [g]
        while path[-1] != s:
            path.append(prev[path[-1]])
        return path[::-1]

    def _h(self, i, goal):
        return np.hypot(*(self.nodes[i, :2] - goal[:2]))

    def world(self, idx):
        p = self.nodes[idx]
        return np.stack([p[:, 0] * self.cell + self.x0 + self.cell / 2,
                         p[:, 1] * self.cell + self.y0 + self.cell / 2, p[:, 2]], axis=1)

    def route(self, waypoints, z_hints=None, closed=True, contour=None):
        """A* between consecutive waypoints; closed: back to the first one (a lap). contour: {z, weight,
        centre} - the route holds height z (a beach road just above the sea) rather than seeking the
        middle of the open floor (which on a slope is up it)."""
        area = self.main_area(waypoints)
        ids = [self.nearest(x, y, None if z_hints is None else z_hints[k], area) for k, (x, y) in enumerate(waypoints)]
        full, problems = [], []
        for k in range(len(ids) if closed else len(ids) - 1):
            a, b = ids[k], ids[(k + 1) % len(ids)]
            p = self.astar(a, b, contour=contour) or self.astar(a, b, min_clear=0.5, contour=contour)
            if p is None:
                problems.append(k)
                p = [a, b]
            full += p[:-1]
        if not closed:
            full.append(ids[-1])
        return self.world(np.array(full)), problems
