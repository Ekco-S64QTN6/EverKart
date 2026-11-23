// The road is the zone's own ground, graded: under the road and its kerbs the ground is set
// to the smooth road bed (course.js) - cut where it rises above it (a hump, a rock, a step),
// filled where it dips; over the shoulders it blends to the natural ground, and beyond them a
// bank at 1:1 at most meets it. The karts drive on the zone's floor in its own textures, with
// nothing painted over it.
//
// Only the ground moves. A point is shaped when it belongs to an upward-facing surface, and
// beside the road (or more than a little above the bed) only when it is the zone's ground:
// nothing beneath it (so a hut's roof, a platform, an arch or a cliff top stays
// as it is), and nothing above it when it would be raised (the ground under a bridge stays).
// (Anything at all beneath a point means it is not the zone's ground: terrain is one sheet.)
// Walls follow only the ground points they share, so a cliff's foot moves with the road.
//
// Triangles near the road are first split on a fixed world grid (GRID units in x and z).
// Two triangles that share an edge split it at the same points, so moving vertices by a
// function of their position cannot open cracks between them.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const GRID = 6;          // split size near the road
const CELL = 12;         // spatial hash cell for the road lookup
const BAND = 18;         // the bank reaches this far beyond the shoulders
const BANK = 1.0;        // its slope (rise per unit out)
const CUT = 20;          // ground up to this above the bed is cut to it; up to twice this, less and less
const FILL = 20;         // ground up to this below the bed is raised to it (an embankment along a ridge or a hillside); a little more, less and less
const LOW = 8;           // under the road, anything up to this high is cut without asking what it is
const UPWARD = 0.3;      // a triangle faces up when its normal's y exceeds this
const SINK = 0.7;        // under the road and its kerbs the ground sits this far below the road bed

// Road lookup. rows[i] = { off: lateral offsets of the profile columns (left to right),
// h: heights of those columns } for each path point; sides[i] = unit vector to the right.
// segs: the number of segments (n on a lap, n - 1 on an open course).
export function roadQuery(track, rows, sides, segs = track.n) {
  const n = track.n, P = track.path;
  const hash = new Map();
  const key = (cx, cz) => (cx + 1e5) * 1e6 + (cz + 1e5);    // exact for any zone size
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const reach = Math.max(-rows[i].off[0], rows[i].off.at(-1), -rows[j].off[0], rows[j].off.at(-1)) + BAND;
    const x0 = Math.min(P[i].x, P[j].x) - reach, x1 = Math.max(P[i].x, P[j].x) + reach;
    const z0 = Math.min(P[i].z, P[j].z) - reach, z1 = Math.max(P[i].z, P[j].z) + reach;
    const bx = P[j].x - P[i].x, bz = P[j].z - P[i].z, len2 = bx * bx + bz * bz || 1;
    const R = reach + CELL * 0.75;                  // the cell's centre is within reach of the segment
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const qx = (cx + 0.5) * CELL - P[i].x, qz = (cz + 0.5) * CELL - P[i].z;
        const t = THREE.MathUtils.clamp((qx * bx + qz * bz) / len2, 0, 1);
        if ((qx - bx * t) ** 2 + (qz - bz * t) ** 2 > R * R) continue;
        const k = key(cx, cz);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push(i);
      }
    }
  }
  // height of a row's profile at lateral offset d, clamped to the shoulders' outer edges
  const profile = (r, d) => {
    const { off, h } = r, last = off.length - 1;
    if (d <= off[0]) return h[0];
    if (d >= off[last]) return h[last];
    let k = 0;
    while (off[k + 1] < d) k++;
    const u = (d - off[k]) / (off[k + 1] - off[k]);
    return h[k] + (h[k + 1] - h[k]) * u;
  };
  // the road bed under (x, z) for something at height y: { h, d, i, beyond, inner } or null.
  // h: the bed (or the shoulder's outer edge), beyond: how far past the shoulders,
  // inner: under the road or its kerbs
  function at(x, y, z, withDecks = false) {
    const list = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let best = null;
    for (const i of list) {
      const j = (i + 1) % n;
      const ax = P[i].x, az = P[i].z, bx = P[j].x - ax, bz = P[j].z - az;
      const len2 = bx * bx + bz * bz || 1;
      const t = THREE.MathUtils.clamp(((x - ax) * bx + (z - az) * bz) / len2, 0, 1);
      const px = ax + bx * t, pz = az + bz * t;
      const sx = sides[i].x + (sides[j].x - sides[i].x) * t, sz = sides[i].z + (sides[j].z - sides[i].z) * t;
      const sl = Math.hypot(sx, sz) || 1;
      const d = ((x - px) * sx + (z - pz) * sz) / sl;
      const along = Math.abs((x - px) * sz - (z - pz) * sx) / sl;   // off the end of the segment
      if (along > 3) continue;
      const ri = rows[i], rj = rows[j];
      const lo = Math.min(ri.off[0], rj.off[0]), hi = Math.max(ri.off.at(-1), rj.off.at(-1));
      if (d < lo - BAND || d > hi + BAND) continue;
      const h = profile(ri, d) * (1 - t) + profile(rj, d) * t;
      if (y < h - FILL - 10 || y > h + 60) continue;            // another level of the zone
      if (!withDecks && (track.deck?.has(i) || track.deck?.has(j))) continue;   // a causeway: the ground under it stays
      const beyond = Math.max(0, lo - d, d - hi);
      const inner = d >= Math.max(ri.off[1], rj.off[1]) && d <= Math.min(ri.off.at(-2), rj.off.at(-2));
      // prefer the segment the point is most squarely beside (the nearest line)
      const score = Math.abs(d) + along * 4;
      if (!best || score < best.score) best = { h, d, i, beyond, inner, score };
    }
    return best;
  }
  // per cell: the heights ground can be moved between (outside them nothing is touched)
  const span = new Map();
  for (const [k, list] of hash) {
    let lo = Infinity, hi = -Infinity;
    for (const i of list) for (const v of rows[i].h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    span.set(k, [lo - FILL - 11, hi + BAND * BANK + 2 * CUT]);
  }
  return { at, hash, key, span };
}

// Sutherland-Hodgman: keep the part of a convex polygon (vertices = flat arrays) where
// v[axis] is between lo and hi
function clipSlab(poly, axis, lo, hi) {
  const cut = (pts, keep, edge) => {
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const ia = keep(a[axis]), ib = keep(b[axis]);
      if (ia) out.push(a);
      if (ia !== ib) {
        const u = (edge - a[axis]) / (b[axis] - a[axis]);
        const v = a.map((x, m) => x + (b[m] - x) * u);
        v[axis] = edge;                       // exactly on the line: both neighbours agree
        out.push(v);
      }
    }
    return out;
  };
  let p = cut(poly, (x) => x >= lo, lo);
  if (p.length >= 3) p = cut(p, (x) => x <= hi, hi);
  return p;
}

// cut a convex polygon into the cells of a grid; calls emit(cellPolygon, cx, cz)
function eachCell(poly, size, emit) {
  const xs = poly.map((v) => v[0]);
  for (let cx = Math.floor(Math.min(...xs) / size); cx * size < Math.max(...xs); cx++) {
    const slab = clipSlab(poly, 0, cx * size, (cx + 1) * size);
    if (slab.length < 3) continue;
    const sz = slab.map((v) => v[2]);
    for (let cz = Math.floor(Math.min(...sz) / size); cz * size < Math.max(...sz); cz++) {
      const cell = clipSlab(slab, 2, cz * size, (cz + 1) * size);
      if (cell.length >= 3) emit(cell, cx, cz);
    }
  }
}

// Split on the coarse grid (the road lookup's cells), and again finely only in the cells
// the road reaches: nothing on the edge of those cells can move, so the coarse pieces
// next to them need no matching points.
function splitOnGrid(tri, span) {
  const out = [];
  const fan = (poly) => { for (let k = 1; k + 1 < poly.length; k++) out.push([poly[0], poly[k], poly[k + 1]]); };
  eachCell(tri, CELL, (piece, cx, cz) => {
    const sp = span(cx, cz);
    const ys = piece.map((v) => v[1]);
    if (!sp || Math.max(...ys) < sp[0] || Math.min(...ys) > sp[1]) return fan(piece);
    eachCell(piece, GRID, fan);
  });
  return out;
}

const keyOf = (v) => `${Math.round(v[0] * 50)},${Math.round(v[1] * 50)},${Math.round(v[2] * 50)}`;

// Split one indexed geometry (world space) near the road; the positions of upward-facing
// pieces go into `ground` (key -> position), the candidates for shaping.
function splitGeometry(geo, road, near, ground) {
  const pos = geo.getAttribute('position');
  const names = Object.keys(geo.attributes).filter((a) => a !== 'position');
  const attrs = names.map((a) => geo.getAttribute(a));
  const width = 3 + attrs.reduce((s, a) => s + a.itemSize, 0);
  const idx = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const vert = (i) => {
    const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (const a of attrs) for (let c = 0; c < a.itemSize; c++) v.push(a.array[i * a.itemSize + c]);
    return v;
  };
  // each triangle with its pieces (null: far from the road, kept whole)
  const groups = [];
  let split = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [vert(idx[t]), vert(idx[t + 1]), vert(idx[t + 2])];
    if (!near(tri)) { groups.push([tri, null]); continue; }
    e1.set(tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]);
    e2.set(tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]);
    const nrm = e1.cross(e2);
    const up = nrm.y > UPWARD * nrm.length();
    split++;
    const pieces = splitOnGrid(tri, (cx, cz) => road.span.get(road.key(cx, cz)));
    groups.push([tri, pieces]);
    if (up) for (const s of pieces) for (const v of s) ground.set(keyOf(v), v);
  }
  return { groups, width, names, attrs, split, before: idx.length / 3 };
}

// Where each candidate ground point goes (key -> new height). `probe(origin, dir, far)`
// raycasts the zone as it was (returns the hit or null).
function shape(ground, road, probe) {
  const moves = new Map();
  const DOWNV = new THREE.Vector3(0, -1, 0), UPV = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3();
  let kept = 0;
  for (const [k, v] of ground) {
    const r = road.at(v[0], v[1], v[2]);
    if (!r) continue;
    const y = v[1];
    const target = r.beyond > 0 ? THREE.MathUtils.clamp(y, r.h - r.beyond * BANK, r.h + r.beyond * BANK) : r.inner ? r.h - SINK : r.h;
    const delta = target - y;
    if (Math.abs(delta) < 0.01) continue;
    if (delta < 0) {                                         // above the bed: cut
      const e = -delta;
      if (e > 2 * CUT) continue;
      if (!(r.inner && e <= LOW)) {                          // is it the ground, or something standing on it?
        if (probe(o.set(v[0], y - 0.25, v[2]), DOWNV, e + 1)) { kept++; continue; }   // a roof, a platform, a rock
      }
      moves.set(k, e <= CUT ? target : target + 2 * (e - CUT));
    } else {                                                 // below the bed: fill
      const f = delta;
      if (f > FILL + 8) continue;
      if (probe(o.set(v[0], y + 0.25, v[2]), UPV, f + 6)) { kept++; continue; }   // under a bridge, a ledge
      moves.set(k, f <= FILL ? target : target - 2 * (f - FILL));
    }
  }
  return { moves, kept };
}

function build(res, moves) {
  const { groups, width, names, attrs } = res;
  // a triangle stays in pieces only where one of its pieces moved; otherwise it is kept whole
  // (most triangles near the road are walls and ceilings that do not move: 5x fewer triangles)
  const tris = [];
  for (const [tri, pieces] of groups) {
    if (pieces && pieces.some((pc) => pc.some((v) => moves.has(keyOf(v))))) tris.push(...pieces);
    else tris.push(tri);
  }
  res.tris = tris;
  const arr = new Float32Array(tris.length * 3 * width);
  let o = 0, moved = 0;
  for (const tr of tris) {
    for (let k = 0; k < 3; k++) {
      const v = tr[k];
      const m = moves.get(keyOf(v));
      for (let c = 0; c < width; c++) arr[o + c] = v[c];
      if (m !== undefined) { arr[o + 1] = m; moved++; }
      o += width;
    }
  }
  const g = new THREE.BufferGeometry();
  const count = tris.length * 3;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos.set(arr.subarray(i * width, i * width + 3), i * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  let off = 3;
  names.forEach((name, a) => {
    const size = attrs[a].itemSize;
    const data = new Float32Array(count * size);
    for (let i = 0; i < count; i++) data.set(arr.subarray(i * width + off, i * width + off + size), i * size);
    g.setAttribute(name, new THREE.BufferAttribute(data, size, attrs[a].normalized));
    off += size;
  });
  return { g, moved };
}

// Shape the zone (its visible meshes and its collider) to the road bed.
// probe(origin, dir, far): a raycast against the zone's collider as loaded.
export function carveZone(visual, collider, road, probe) {
  const t0 = performance.now();
  // a triangle is worked on when its box touches a cell the road (and its bank) reaches
  const near = (tri) => {
    const xs = tri.map((v) => v[0]), zs = tri.map((v) => v[2]);
    for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
        if (road.hash.has(road.key(cx, cz))) return true;
      }
    }
    return false;
  };
  const meshes = [];
  // leaves, branches, railings (masked) and water / glass (blended) are not ground: left whole
  visual.traverse((o) => { if (o.isMesh && !o.material.alphaTest && !o.material.transparent) meshes.push(o); });
  for (const m of [...meshes, collider]) {
    m.updateMatrixWorld(true);
    if (!m.matrixWorld.equals(new THREE.Matrix4())) console.warn('carve: zone mesh is not in world space', m.name);
  }
  const ground = new Map();
  const results = [...meshes, collider].map((m) => splitGeometry(m.geometry, road, near, ground));
  const { moves, kept } = shape(ground, road, probe);         // (the collider is still as loaded)
  let tris = 0, moved = 0, before = 0, split = 0;
  [...meshes, collider].forEach((m, k) => {
    const { g, moved: mv } = build(results[k], moves);
    tris += results[k].tris.length;
    before += results[k].before;
    split += results[k].split;
    moved += mv;
    if (m === collider) g.boundsTree = new MeshBVH(g);
    m.geometry = g;
  });
  console.log(`roadbed: ${moves.size} ground points shaped (${kept} left: not ground), ${moved} vertices moved, ${before} -> ${tris} triangles (${split} split), ${Math.round(performance.now() - t0)} ms`);
}
