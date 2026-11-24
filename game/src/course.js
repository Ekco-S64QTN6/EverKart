// Makes the course readable without painting over the zone: the road is the zone's own
// ground, graded smooth (the bed computed here, the ground shaped to it in roadbed.js); a
// wooden fence where the road crosses open ground (it also stops karts), chevron boards on
// the outside of sharp turns, start / finish arches, and the data for the minimap.
import * as THREE from 'three';
import { roadQuery } from './roadbed.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const tl = new THREE.TextureLoader();

function tex(url, repeat = true) {
  const t = tl.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ground height under (x, z), searching down from just above the line height
function ground(collider, cast, x, y, z) {
  const hit = cast(collider, new THREE.Vector3(x, y + 10, z), DOWN, 40);
  return hit ? hit.point.y : y;
}

export const KERB = 2.5;          // flat ground kept beyond the road's half width on each side
const BH = 2.6, BT = 1.4;         // the walls along the road: height, thickness
export const SHOULDER = 5;        // then this much blends from the bed to the zone's ground
const FENCE_OPEN = 14;            // a side is fenced where its free room exceeds the road by this

export function buildCourse(scene, track, collider, cast, visual = null) {
  const c = track.data.course || {};
  const H = track.width;                         // road half width
  const n = track.n;
  const idx = (i) => track.idx(i);
  const segs = track.open ? n - 1 : n;           // segments i -> i + 1 (an open course does not close)
  const group = new THREE.Group();
  scene.add(group);
  // the road's cross-sections, square to the line's heading smoothed over a few points either
  // side: a wide road's edges turn gradually through an S-bend in the racing line (square to the
  // line's own heading, the far edge of a 40-wide road swings back on itself where the line's
  // turn flips from one side to the other)
  const sides = track.path.map((_, i) => {
    const t = new THREE.Vector3();
    for (let k = -4; k <= 4; k++) t.addScaledVector(track.tangent(track.idx(i + k)), Math.exp(-(k * k) / 8));
    t.setY(0).normalize();
    return new THREE.Vector3(-t.z, 0, t.x);      // points to the right of travel
  });
  // path points apart along the course (open courses do not wrap)
  const apart = (i, j) => (track.open ? Math.abs(i - j) : Math.min(Math.abs(i - j), n - Math.abs(i - j)));

  // road half width per point: the full width the zone gives the road (the route planner's room
  // to the nearest wall or drop, less the kerb and wall), up to a cap in open ground; narrower
  // only where a bend is too tight for it (a road never folds over on the inside of a bend)
  const room0 = track.data.room;
  // a side goes out to the zone's wall when there is one in reach (up to WMAX), in open ground
  // with no wall near only so far (WOPEN): a track, not a field
  const WMAX = c.max_width ?? 46, WOPEN = c.open_width ?? 36, WMIN = 10;
  const hidden = new Set(track.data.shared_later || []);   // the later pass of a road taken both ways
  const sharedLater = new Set(hidden);
  // a roundabout (the ring round Hoshkar's island): drawn whole below, as its own raised deck; the
  // line's own strips skip it, and the road to it stops at the ring's outer edge
  const ring = track.data.ring;
  const ringSet = new Set();
  if (ring) {
    for (let i = ring.first; i <= ring.last; i++) { ringSet.add(i); hidden.add(i); }
    // the road to the ring stops at the ring's outer edge (its last stretch, where the line turns
    // onto the ring, is the ring's); below, its last cross-section runs on straight into the ring's
    // band, under the ring's road - one paved merge, nothing between the two
    const [cx, cy] = ring.center, [rx, ry] = ring.radius, R = ring.half_width + KERB + 1.5;
    for (let i = 0; i < n; i++) {
      const ex = (track.path[i].x - cx) / (rx + R), ey = (-track.path[i].z - cy) / (ry + R);
      if (ex * ex + ey * ey < 1) hidden.add(i);
    }
  }
  track.sharedSet = new Set(track.data.shared || []);
  const P = track.path;
  // the bend at each point, at every scale (1 to 4 points either side: a short sharp kink folds a
  // wide road as surely as a long tight bend): its radius, and which side its inside is (+1 right)
  const turnR = new Float32Array(n).fill(Infinity), turnS = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 1; k <= 4; k++) {
      const a = P[idx(i - k)], b = P[i], cc = P[idx(i + k)];
      const ab = Math.hypot(a.x - b.x, a.z - b.z), bc = Math.hypot(b.x - cc.x, b.z - cc.z), ca = Math.hypot(cc.x - a.x, cc.z - a.z);
      const cr = (b.x - a.x) * (cc.z - b.z) - (b.z - a.z) * (cc.x - b.x);
      const r = Math.abs(cr) < 1e-3 ? Infinity : (ab * bc * ca) / (2 * Math.abs(cr));
      if (r < turnR[i]) { turnR[i] = r; turnS[i] = Math.sign(cr); }
    }
  }
  // the road's half width on each side of the line (wr right, wl left): each edge goes out to its
  // own wall (the walls at kart height; a step along the road is graded into a ramp, so it does
  // not count), in open ground with no wall in reach to the planner's room (it knows the
  // drop-offs), up to a cap; narrower only on the inside of a bend too tight for it (a road never
  // folds over itself)
  // (the planner's free floor on that side - it sees ledges, steps and drops under kart height -
  // and the walls at kart height, whichever is nearer)
  const floorRoom = { 1: track.data.room_r, [-1]: track.data.room_l };
  const half = (sg) => Float32Array.from({ length: n }, (_, i) => {
    const room = sg > 0 ? (track.roomR0 ?? track.roomR) : (track.roomL0 ?? track.roomL);
    const ray = Math.min(...[-1, 0, 1].map((k) => room[idx(i + k)]));
    const far = track.rayFar ?? track.width * 2;
    let r;
    // (the floor beside the line: the middle of three neighbouring samples - one stray sample
    // must not narrow a stretch)
    const med3 = (f) => [-1, 0, 1].map((k) => f[idx(i + k)] ?? WMAX).sort((a, b) => a - b)[1];
    if (floorRoom[sg]) r = Math.min(ray, med3(floorRoom[sg]));
    else {
      const plan = room0 ? Math.min(...[-3, -2, -1, 0, 1, 2, 3].map((k) => room0[idx(i + k)] ?? WMAX)) : H;
      r = ray >= far - 1 ? Math.min(plan, ray) : ray;
    }
    const cap = ray < far - 1 ? WMAX : WOPEN;               // a wall in reach: out to it; open ground: so far
    const bend = Math.min(...[-4, -2, 0, 2, 4].map((k) => (turnS[idx(i + k)] === sg ? turnR[idx(i + k)] : Infinity))) * 0.9 - KERB - 1.5;
    return THREE.MathUtils.clamp(Math.min(r - KERB - 1.5, bend), 2, cap);
  });
  const wr = half(1), wl = half(-1);
  track.widthStages = track.widthStages || {}; track.widthStages.limits = [Float32Array.from(wl), Float32Array.from(wr)];
  const sideW = (sg) => (sg > 0 ? wr : wl);
  // a fork: where a road taken both ways splits (the trunk and both branches near either end of
  // the later pass) it is one paved junction - the branches do not squeeze each other
  const fork = new Uint8Array(n);
  {
    const later = [...sharedLater].sort((x, y) => x - y);
    const ends = [];
    for (let k = 0; k < later.length; k++) {
      if (k === 0 || later[k - 1] !== later[k] - 1) ends.push(later[k]);
      if (k === later.length - 1 || later[k + 1] !== later[k] + 1) ends.push(later[k]);
    }
    for (const e of ends) {
      let best = -1, bd = 14;                                 // the drawn road it lies on
      for (let j = 0; j < n; j++) {
        if (hidden.has(j) || apart(e, j) < 12) continue;
        const d = Math.hypot(P[e].x - P[j].x, P[e].z - P[j].z);
        if (d < bd && Math.abs(P[e].y - P[j].y) < 12) { bd = d; best = j; }
      }
      for (const c0 of best < 0 ? [e] : [e, best]) for (let k = -22; k <= 22; k++) fork[idx(c0 + k)] = 1;
    }
  }
  // where another part of the course passes alongside (a switchback, a hairpin) at about the
  // same height, the two roads share the space between them, a wall between them back to back
  // (never a sliver of floor between two kerbs); each side on its own: the other edge still goes
  // out to its wall
  {
    // (the road's own bend is not a neighbour - the bend limit keeps it from folding: another
    // stretch is one much further away along the course than across)
    const along = [0];
    for (let i = 1; i < n; i++) along.push(along[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const total = along[n - 1] + (track.open ? 0 : Math.hypot(P[0].x - P[n - 1].x, P[0].z - P[n - 1].z));
    const courseD = (i, j) => { const d = Math.abs(along[i] - along[j]); return track.open ? d : Math.min(d, total - d); };
    const nearR = new Float32Array(n).fill(Infinity), nearL = new Float32Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (apart(i, j) < 12) continue;
        if (Math.abs(P[i].y - P[j].y) > 22) continue;            // well above / below: a bridge, not a neighbour
        const dx = P[j].x - P[i].x, dz = P[j].z - P[i].z, d = Math.hypot(dx, dz);
        if (d > 2 * WMAX + 12 || d > 0.45 * courseD(i, j)) continue;
        if (track.sharedSet.has(i) && track.sharedSet.has(j)) continue;   // the same road, the other way
        if (d < 12 && (track.sharedSet.has(i) || track.sharedSet.has(j))) continue;
        if (fork[i] && fork[j]) continue;                        // one junction
        if (dx * sides[i].x + dz * sides[i].z >= 0) nearR[i] = Math.min(nearR[i], d);
        else nearL[i] = Math.min(nearL[i], d);
      }
    }
    for (let i = 0; i < n; i++) {
      wr[i] = Math.min(wr[i], Math.max(2, nearR[i] / 2 - KERB - BT - 0.2));
      wl[i] = Math.min(wl[i], Math.max(2, nearL[i] / 2 - KERB - BT - 0.2));
    }
    track.nearSelf = Float32Array.from(nearR, (v, i) => Math.min(v, nearL[i]));
  }
  track.widthStages = track.widthStages || {}; track.widthStages.neighbours = [Float32Array.from(wl), Float32Array.from(wr)];

  // a causeway is our own deck: as wide as the walls round it allow (the planner's room stops at
  // the lava's edge), and so is the road leading onto it
  const deckSet = new Set(track.data.deck || []);
  if (deckSet.size) {
    const nearDeck = new Uint8Array(n);
    for (const i of deckSet) for (let k = -12; k <= 12; k++) nearDeck[idx(i + k)] = 1;
    for (let i = 0; i < n; i++) {
      if (!nearDeck[i]) continue;
      wr[i] = THREE.MathUtils.clamp(track.roomR[i] - KERB - 1.5, wr[i], WMAX);
      wl[i] = THREE.MathUtils.clamp(track.roomL[i] - KERB - 1.5, wl[i], WMAX);
    }
  }
  for (const b of track.data.bridges || []) {        // a bridge: as wide as asked, at most
    if (!b.half_width) continue;
    for (let i = b.first; i <= b.last; i++) { wr[i] = Math.min(wr[i], b.half_width); wl[i] = Math.min(wl[i], b.half_width); }
  }
  if (ring) {
    // the road to the ring keeps its full width right into the mouth (the line's corner onto the
    // ring lies inside the ring: no bend to narrow for)
    const J = P[ring.first];
    for (let i = 0; i < n; i++) {
      if (ringSet.has(i) || Math.hypot(P[i].x - J.x, P[i].z - J.z) > 80) continue;
      const r = room0 ? Math.min(...[-3, -2, -1, 0, 1, 2, 3].map((k) => room0[idx(i + k)] ?? WMAX)) : H;
      wr[i] = wl[i] = THREE.MathUtils.clamp(r - KERB - 1.5, WMIN, WMAX);
    }
  }
  track.widthStages = track.widthStages || {}; track.widthStages.decks = [Float32Array.from(wl), Float32Array.from(wr)];
  const capR = Float32Array.from(wr), capL = Float32Array.from(wl);   // the most each side can have here
  // each edge smoothed - which only ever narrows it
  for (const w of [wr, wl]) {
    // each edge runs smooth: no wobble from the zone's walls (the narrowest nearby counts, then
    // eased along); it curves in round something on its side (a tree, a post) and straight back
    // out - at most 2 per path point (~4.5 units), so one tree does not narrow a long stretch
    const w0 = Float32Array.from(w);
    for (let i = 0; i < n; i++) {
      if (ringSet.has(i)) continue;
      for (let k = -24; k <= 24; k++) {
        const j = idx(i + k);
        if (!ringSet.has(j)) w[i] = Math.min(w[i], w0[j] + Math.max(0, Math.abs(k) - 2) * 2.0);
      }
    }
    const w1 = Float32Array.from(w);
    for (let i = 0; i < n; i++) {
      if (ringSet.has(i)) continue;
      let sum = 0, wt = 0;
      for (let k = -6; k <= 6; k++) { const j = idx(i + k), g = Math.exp(-(k * k) / 8); sum += w1[j] * g; wt += g; }
      w[i] = Math.min(w0[i] + 0.6, sum / wt);
    }
  }
  track.widthStages = track.widthStages || {}; track.widthStages.eased = [Float32Array.from(wl), Float32Array.from(wr)];
  // never narrower than MIN_TOTAL across (several karts) where the floor allows it: a side the
  // easing cut back for a narrow spot nearby gets its room back, and a side with room makes up
  // for a side without; eased in and out at 2 per path point. (Where both sides are tight - a
  // real gap - the route is what changes: narrow.mjs lists them.)
  {
    const MINT = c.min_width ?? 20;
    const needR = new Float32Array(n), needL = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (ringSet.has(i)) continue;
      const short = MINT - wl[i] - wr[i];
      if (short <= 0) continue;
      const rr = Math.max(0, capR[i] - wr[i]), rl = Math.max(0, capL[i] - wl[i]);
      let gr = Math.min(rr, short / 2), gl = Math.min(rl, short / 2);
      gr += Math.min(rr - gr, short - gr - gl);
      gl += Math.min(rl - gl, short - gr - gl);
      needR[i] = wr[i] + gr; needL[i] = wl[i] + gl;
    }
    for (const [w, need, cap] of [[wr, needR, capR], [wl, needL, capL]]) {
      const w0 = Float32Array.from(w);
      for (let i = 0; i < n; i++) {
        if (ringSet.has(i)) continue;
        let m = w0[i];
        for (let k = -12; k <= 12; k++) { const j = idx(i + k); if (need[j] > 0) m = Math.max(m, need[j] - Math.abs(k) * 2); }
        w[i] = Math.min(m, cap[i]);
      }
    }
  }
  track.widthStages.minimum = [Float32Array.from(wl), Float32Array.from(wr)];
  const floorW = { 1: Float32Array.from(wr), [-1]: Float32Array.from(wl) };   // the smoothing keeps this much
  // each edge as a line in the world: smoothed there (a kink in the racing line must not jog a
  // wide road's edge sideways), never wider than its limits, and never folding back on itself -
  // where it would, it is pulled in a little and smoothed again round the spot (a curve, no notch)
  {
    const open = track.open;
    for (const sg of [1, -1]) {
      const w = sideW(sg), lim = Float32Array.from(w);
      const ex = new Float32Array(n), ez = new Float32Array(n);
      const smoothWorld = (iters, only = null) => {
        for (let it = 0; it < iters; it++) {
          for (let i = 0; i < n; i++) { ex[i] = P[i].x + sides[i].x * sg * w[i]; ez[i] = P[i].z + sides[i].z * sg * w[i]; }
          for (let i = 0; i < n; i++) {
            if (ringSet.has(i) || (open && (i === 0 || i === n - 1)) || (only && !only[i])) continue;
            const a = idx(i - 1), b = idx(i + 1);
            const d = sg * (((ex[a] + ex[b]) / 2 - P[i].x) * sides[i].x + ((ez[a] + ez[b]) / 2 - P[i].z) * sides[i].z);
            w[i] = THREE.MathUtils.clamp(w[i] + 0.5 * (d - w[i]), Math.min(lim[i], floorW[sg][i]), lim[i]);
          }
        }
      };
      smoothWorld(12);
      for (let pass = 0; pass < 40; pass++) {
        const near = new Uint8Array(n);
        let folds = 0;
        for (let i = 0; i < segs; i++) {
          const j = idx(i + 1);
          if (ringSet.has(i) || ringSet.has(j)) continue;
          const t = track.tangent(i), stepL = Math.hypot(P[j].x - P[i].x, P[j].z - P[i].z);
          const ax = P[i].x + sides[i].x * sg * w[i], az = P[i].z + sides[i].z * sg * w[i];
          const bx = P[j].x + sides[j].x * sg * w[j], bz = P[j].z + sides[j].z * sg * w[j];
          if ((bx - ax) * t.x + (bz - az) * t.z < 0.3 * stepL) {          // folds back here
            folds++;
            lim[i] = w[i] = Math.max(2, w[i] * 0.9);
            lim[j] = w[j] = Math.max(2, w[j] * 0.9);
            for (let k = -8; k <= 8; k++) near[idx(i + k)] = 1;
          }
        }
        if (!folds) break;
        smoothWorld(6, near);
      }
    }
  }
  track.widthStages = track.widthStages || {}; track.widthStages.folds = [Float32Array.from(wl), Float32Array.from(wr)];
  if (ring) for (const i of ringSet) wr[i] = wl[i] = ring.half_width;
  track.roadWR = wr;
  track.roadWL = wl;
  // is (x, z) on the road (with its kerbs and a margin) of a stretch drawn - other than the
  // stretch at `self` (within 12 points of it along the course)? Tested against each segment's
  // outline, edge to edge.
  const px = Float32Array.from(P, (p, j) => p.x + sides[j].x * (wr[j] - wl[j]) / 2);   // the road's middle
  const pz = Float32Array.from(P, (p, j) => p.z + sides[j].z * (wr[j] - wl[j]) / 2);
  const edgePt = (j, d) => [P[j].x + sides[j].x * d, P[j].z + sides[j].z * d];
  // (the ring's band counts as road: no kerb or wall of the road to it is drawn across it)
  const onRing = (x, z, y, ext) => {
    if (!ring || Math.abs(y - ring.z) > 12) return false;
    const [cx, cy] = ring.center, [rx, ry] = ring.radius, R = ring.half_width + ext;
    const u = x - cx, v = -z - cy;
    return Math.hypot(u / (rx + R), v / (ry + R)) < 1 && Math.hypot(u / (rx - R), v / (ry - R)) > 1;
  };
  const onRoad = (x, z, y, margin = 0.8, self = -1, kerbs = true) => {
    const ext = (kerbs ? KERB : 0) + margin;
    if (onRing(x, z, y, ext)) return true;
    for (let j = 0; j < segs; j++) {
      const j1 = idx(j + 1);
      if ((hidden.has(j) && hidden.has(j1)) || (self >= 0 && apart(self, j) < 12)) continue;
      if (Math.abs(P[j].y - y) >= 12) continue;
      const reach = Math.max(wl[j], wr[j]) + ext + 8;
      if ((P[j].x - x) ** 2 + (P[j].z - z) ** 2 > reach * reach) continue;
      const q = [edgePt(j, -wl[j] - ext), edgePt(j, wr[j] + ext), edgePt(j1, wr[j1] + ext), edgePt(j1, -wl[j1] - ext)];
      let inside = false;
      for (let a = 0, b = 3; a < 4; b = a++) {
        const [xa, za] = q[a], [xb, zb] = q[b];
        if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };

  // --- the road bed: across, a straight line (a little banking where the ground leans, never
  // a copy of its bumps); along, the ground's height smoothed over tens of metres. roadbed.js
  // shapes the zone's own ground to it (cut where it rises above, filled where it dips), so the
  // karts drive on the zone's floor, in its own textures, and nothing is painted over it.
  const U = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];       // across the road
  const RAMP = c.ramp ?? 14;                     // ground further than this from the line is not the road's
  const BANK = c.bank ?? 0.12;                   // steepest banking (rise per unit across)
  const SMOOTH = c.smooth ?? 16;                 // along-track smoothing of the height (units, sigma)
  // lateral offsets per point: shoulder edge, kerb edge, road columns, kerb edge, shoulder edge
  const ucol = (k, u) => (u < 0 ? u * wl[k] : u * wr[k]);          // a road column's offset (0: the line)
  const offs = (k) => [-wl[k] - KERB - SHOULDER, -wl[k] - KERB, ...U.map((u) => ucol(k, u)), wr[k] + KERB, wr[k] + KERB + SHOULDER];
  const C = U.length + 4;
  const X = [], Z = [], G = [], Hh = [];
  const deck = new Set(track.data.deck || []);   // causeway spans (over lava): no ground of the zone's
  track.deck = deck;
  for (let i = 0; i < n; i++) {
    const p = track.path[i], o = offs(i);
    X.push(o.map((d) => p.x + sides[i].x * d));
    Z.push(o.map((d) => p.z + sides[i].z * d));
    // the ground; null where there is none near the line (a gap, stairs down beside a ramp)
    G.push(o.map((d, j) => {
      if (deck.has(i)) return null;
      const hit = cast(collider, new THREE.Vector3(X[i][j], p.y + 10, Z[i][j]), DOWN, 40);
      return hit && Math.abs(hit.point.y - p.y) <= RAMP ? hit.point.y : null;
    }));
  }
  // 1. each cross-section: a straight line through the ground under the road and kerbs,
  // fitted so a tree root, a rock or a wall top under one column does not count
  const mid0 = new Float32Array(n), tilt0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = offs(i);
    let pts = [];
    for (let j = 1; j < C - 1; j++) if (G[i][j] !== null) pts.push([o[j], G[i][j]]);
    mid0[i] = track.path[i].y;
    if (pts.length < 3) continue;
    for (let pass = 0; pass < 3; pass++) {
      const m = pts.length, sx = pts.reduce((s, q) => s + q[0], 0) / m, sy = pts.reduce((s, q) => s + q[1], 0) / m;
      const sxx = pts.reduce((s, q) => s + (q[0] - sx) ** 2, 0), sxy = pts.reduce((s, q) => s + (q[0] - sx) * (q[1] - sy), 0);
      const b = sxx > 1e-6 ? sxy / sxx : 0;
      mid0[i] = sy - b * sx;
      tilt0[i] = b;
      const res = pts.map((q) => Math.abs(q[1] - (mid0[i] + b * q[0])));
      const mad = [...res].sort((a, b2) => a - b2)[Math.floor(m / 2)];
      const keep = pts.filter((_, k) => res[k] <= Math.max(1, 2.5 * mad));
      if (keep.length < 3 || keep.length === m) break;
      pts = keep;
    }
  }
  // 2. along the track: drop lone spikes (median of 7), then a gaussian over distance
  const step = (j) => track.path[j].distanceTo(track.path[idx(j + 1)]);
  const median = (a, r) => Float32Array.from(a, (_, i) => {
    const win = [];
    for (let k = -r; k <= r; k++) win.push(a[idx(i + k)]);
    return win.sort((x, y) => x - y)[r];
  });
  const gauss = (a, sigma) => Float32Array.from(a, (_, i) => {
    let s = 0, ws = 0;
    for (const dir of [1, -1]) {
      let d = dir > 0 ? 0 : step(idx(i - 1)), j = dir > 0 ? i : idx(i - 1);
      for (let k = 0; d < 3 * sigma && k < n / 2; k++) {
        const wt = Math.exp(-(d * d) / (2 * sigma * sigma));
        s += a[j] * wt; ws += wt;
        const nj = idx(j + dir);
        if (nj === j) break;                      // the end of an open course
        d += step(dir > 0 ? j : nj);
        j = nj;
      }
    }
    return s / ws;
  });
  const mid = gauss(gauss(median(mid0, 3), SMOOTH), SMOOTH * 0.5);
  const tilt = gauss(Float32Array.from(median(tilt0, 3), (b) => THREE.MathUtils.clamp(b, -BANK, BANK)), 24);
  // 3. shoulders: from the kerb's outer edge down (or up) to the ground beside the road
  const shoulder = (j, sg) => {
    const edge = (i) => mid[i] + tilt[i] * sg * (sideW(sg)[i] + KERB);
    const raw = Float32Array.from({ length: n }, (_, i) => {
      const g = G[i][j], e = edge(i);
      return g === null ? e : THREE.MathUtils.clamp(g, e - 8, e + 6);
    });
    const drop = gauss(Float32Array.from(raw, (v, i) => v - edge(i)), 10);
    return Float32Array.from(drop, (v, i) => edge(i) + v);
  };
  const shL = shoulder(0, -1), shR = shoulder(C - 1, 1);
  for (let i = 0; i < n; i++) {
    Hh.push(offs(i).map((d, j) => (j === 0 ? shL[i] : j === C - 1 ? shR[i] : mid[i] + tilt[i] * d)));
  }
  const rows = Hh.map((h, i) => ({ off: offs(i), h }));
  track.roadRows = rows;
  const surface = (i, d) => {
    const { off, h } = rows[i];
    if (d <= off[0]) return h[0];
    if (d >= off[C - 1]) return h[C - 1];
    let k = 0;
    while (off[k + 1] < d) k++;
    return h[k] + (h[k + 1] - h[k]) * (d - off[k]) / (off[k + 1] - off[k]);
  };
  const midCol = 2 + (U.length - 1) / 2;
  track.startY = Hh[track.start][midCol];

  // --- the track itself: a road laid along the line in one of the zone's own floor textures
  // (at the zone's own texture scale, lit by the zone's baked light where it runs), banded kerbs
  // in the zone's trim, and a continuous low wall along both edges except where the zone's own
  // wall is the edge. The zone's ground is shaped to sit just under it (roadbed.js); the karts
  // drive on the road.
  const LIFT = 0.3, KERB_UP = 0.35;
  const roadTile = c.road_tile ?? 24, kerbTile = c.kerb_tile ?? 6, wallTile = c.barrier_tile ?? 10;
  const dist = [0];
  for (let i = 1; i < n; i++) dist.push(dist[i - 1] + step(i - 1));
  // the zone's light under each point of the line (its baked vertex light)
  const light = new Float32Array(n * 3).fill(0.35);
  if (visual) {
    const meshes = [];
    visual.traverse((o) => { if (o.isMesh && o.geometry.getAttribute('color') && !o.material.transparent && !o.material.alphaTest) meshes.push(o); });
    const rc = new THREE.Raycaster();
    rc.far = 40;
    let last = null;
    for (let i = 0; i < n; i++) {
      if (i % 3 && i !== n - 1 && last) { light.set(last, i * 3); continue; }
      rc.set(new THREE.Vector3(track.path[i].x, track.path[i].y + 12, track.path[i].z), DOWN);
      const hit = rc.intersectObjects(meshes, false)[0];
      if (hit?.face) {
        const col = hit.object.geometry.getAttribute('color');
        const f = hit.face;
        last = [0, 1, 2].map((ch) => (col.array[f.a * 3 + ch] + col.array[f.b * 3 + ch] + col.array[f.c * 3 + ch]) / 3);
      }
      if (last) light.set(last, i * 3);
    }
    for (let ch = 0; ch < 3; ch++) {
      const sm = gauss(Float32Array.from({ length: n }, (_, i) => light[i * 3 + ch]), 20);
      for (let i = 0; i < n; i++) light[i * 3 + ch] = sm[i];
    }
  }
  const bright = c.road_bright ?? 1;
  const lit = (i, k = 1) => [light[i * 3] * bright * k, light[i * 3 + 1] * bright * k, light[i * 3 + 2] * bright * k, 1];
  const xz = (i, d) => [track.path[i].x + sides[i].x * d, track.path[i].z + sides[i].z * d];

  // strips of quads along the line (own vertices per segment: flat colour bands), for runs of points
  function strip(runs, cols, colour, uvOf) {
    const pos = [], uv = [], col = [], index = [];
    for (const [a, b] of runs) {
      for (let i = a; i < b; i++) {
        const v0 = pos.length / 3;
        for (const ii of [i, i + 1]) {
          for (const [d, h] of cols(ii)) {
            const [x, z] = xz(ii, d);
            pos.push(x, h, z);
            uv.push(...uvOf(ii, d, h));
            col.push(...colour(i, ii, d));
          }
        }
        const m = cols(i).length;
        for (let k = 0; k + 1 < m; k++) index.push(v0 + k, v0 + m + k, v0 + k + 1, v0 + k + 1, v0 + m + k, v0 + m + k + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(index);
    return g;
  }
  const roadMat = new THREE.MeshBasicMaterial({ map: c.road ? tex(c.road) : null, vertexColors: true, side: THREE.DoubleSide });
  const kerbMat = new THREE.MeshBasicMaterial({ map: c.kerb ? tex(c.kerb) : null, vertexColors: true, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshBasicMaterial({ map: (c.barrier || c.kerb) ? tex(c.barrier || c.kerb) : null, vertexColors: true, side: THREE.DoubleSide });
  const roadCols = (i) => U.map((u, c) => [ucol(i, u), Hh[i][2 + c] + LIFT]);
  // the stretches drawn: everything but the later pass of a road taken both ways (drawn once)
  const shown = [];
  for (let i = 0; i < n - 1; i++) {
    if (hidden.has(i) && hidden.has(i + 1)) continue;
    let j = i;
    while (j + 1 < n && !(hidden.has(j) && hidden.has(j + 1))) j++;
    if (j > i) shown.push([i, j]);
    i = j;
  }
  // the road's texture is laid in the zone's own coordinates (as EverQuest lays its floors): where
  // two stretches meet or overlap (a fork, a junction) their stones line up - no seam
  const worldUV = (ii, d) => { const [x, z] = xz(ii, d); return [x / roadTile, z / roadTile]; };
  const roadGeo = strip(shown, roadCols, (i, ii) => lit(ii), worldUV);
  // kerbs: not where they would lie on another stretch's road (at a fork or junction the roads
  // run together, no kerb across the way)
  const kerbRuns = (sg) => {
    const ok = Uint8Array.from({ length: n }, (_, i) => {
      const [x, z] = xz(i, (sideW(sg)[i] + KERB * 0.5) * sg);
      return !onRoad(x, z, P[i].y, -0.5, i, false);
    });
    const out = [];
    for (const [a, b] of shown) {
      let i = a;
      while (i < b) {
        while (i < b && !(ok[i] && ok[i + 1])) i++;
        let j = i;
        while (j < b && ok[j] && ok[j + 1]) j++;
        if (j > i) out.push([i, j]);
        i = j;
      }
    }
    return out;
  };
  const kerbCols = (sg) => (i) => {
    const ws = sideW(sg)[i];
    const e0 = ws * sg, e1 = (ws + KERB) * sg, h0 = surface(i, e0) + LIFT, h1 = surface(i, e1) + LIFT + KERB_UP;
    return sg > 0 ? [[e0, h0], [e0, h0 + KERB_UP], [e1, h1]] : [[e1, h1], [e0, h0 + KERB_UP], [e0, h0]];
  };
  const band = (i, ii) => lit(ii, Math.floor(dist[i] / 6) % 2 ? 1.25 : 0.6);
  const kerbGeo = [1, -1].map((sg) => strip(kerbRuns(sg), kerbCols(sg), band, (ii, d, h) => [Math.abs(d) / kerbTile + h / kerbTile, dist[ii] / kerbTile]));
  group.add(new THREE.Mesh(roadGeo, roadMat));
  for (const g of kerbGeo) group.add(new THREE.Mesh(g, kerbMat));
  if (!track.open) {                                         // close the lap: the segment from the last point to the first
    const P0 = track.path, last = n - 1;
    const close = new THREE.BufferGeometry();
    const pos = [], col = [], uv = [], index = [];
    for (const ii of [last, 0]) for (const u of U) {
      const d = ucol(ii, u), [x, z] = xz(ii, d);
      pos.push(x, Hh[ii][2 + U.indexOf(u)] + LIFT, z); col.push(...lit(ii)); uv.push(x / roadTile, z / roadTile);
    }
    for (let k = 0; k + 1 < U.length; k++) index.push(k, U.length + k, k + 1, k + 1, U.length + k, U.length + k + 1);
    close.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    close.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    close.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    close.setIndex(index);
    group.add(new THREE.Mesh(close, roadMat));
    roadGeo.userData.close = close;
  }
  const merge = (list) => {
    const pos = [], index = [];
    for (const g of list) {
      const base = pos.length / 3, pa = g.getAttribute('position').array, ia = g.index.array;
      for (let k = 0; k < pa.length; k++) pos.push(pa[k]);
      for (let k = 0; k < ia.length; k++) index.push(ia[k] + base);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    return g;
  };
  group.userData.roadParts = [roadGeo, ...kerbGeo, ...(roadGeo.userData.close ? [roadGeo.userData.close] : [])];
  // a deck (a causeway over lava, a bridge): its sides run down to whatever is below - into the
  // lava, or down to the floor under a bridge
  if (deck.size) {
    const runs = [];
    for (let i = 0; i < n; i++) if (deck.has(i) && !hidden.has(i) && (i === 0 || !deck.has(i - 1) || hidden.has(i - 1))) { let j = i; while (deck.has(j + 1) && !hidden.has(j + 1)) j++; if (j > i) runs.push([i, j]); }
    for (const sg of [1, -1]) {
      const cols = (i) => {
        const e = (sideW(sg)[i] + KERB) * sg, h = surface(i, e) + LIFT + KERB_UP;
        const [x, z] = xz(i, e);
        const below = cast(collider, new THREE.Vector3(x, h - 0.5, z), DOWN, 80);
        const depth = THREE.MathUtils.clamp(below ? h - below.point.y + 0.5 : 7, 7, 80);
        return [[e, h], [e, h - depth]];
      };
      group.add(new THREE.Mesh(strip(runs, cols, (i, ii) => lit(ii, 0.7), (ii, d, h) => [dist[ii] / wallTile, h / wallTile]), wallMat));
    }
  }
  // --- the roundabout's ring: road, kerbs and walls on both edges, flat on its deck over the
  // lava, the deck's sides running down into it; the outer kerb and wall open only where the road
  // to it joins
  if (ring) {
    const [cx, cy] = ring.center, [rx, ry] = ring.radius, RW = ring.half_width;
    const h = ring.z + LIFT, N = 360;
    const stem = [];
    for (let i = Math.max(0, ring.first - 60); i < Math.min(n, ring.last + 60); i++) if (!ringSet.has(i)) stem.push(i);
    const P = (th, d) => {                                     // game (x, z) of the point d out from the centreline
      const ex = cx + rx * Math.cos(th), ey = cy + ry * Math.sin(th);
      const nx = ry * Math.cos(th), ny = rx * Math.sin(th), nl = Math.hypot(nx, ny);
      return [ex + (nx / nl) * d, -(ey + (ny / nl) * d)];
    };
    const open = (th) => {                                      // the road to the ring joins here
      const [x, z] = P(th, RW + KERB * 0.5);
      return stem.some((i) => Math.hypot(track.path[i].x - x, track.path[i].z - z) < Math.max(wl[i], wr[i]) + KERB + 1);
    };
    const th0 = ring.start_angle, ths = Array.from({ length: N + 1 }, (_, k) => th0 + (k / N) * Math.PI * 2);
    const arc = [0];
    for (let k = 1; k <= N; k++) { const [a1, b1] = P(ths[k - 1], 0), [a2, b2] = P(ths[k], 0); arc.push(arc[k - 1] + Math.hypot(a2 - a1, b2 - b1)); }
    const col = lit(Math.max(0, ring.first - 5));
    const shade = (k) => col.map((v, j) => (j < 3 ? v * k : v));
    const pos = [], uv = [], cols = [], index = [];
    const mesh = (mat, profile, skip, colour, uvOf) => {      // profile: [[d, dh], ...] across, swept round the ring
      const m = profile.length;
      for (let k = 0; k < N; k++) {
        if (skip && (skip(ths[k]) || skip(ths[k + 1]))) continue;
        const v0 = pos.length / 3;
        for (const kk of [k, k + 1]) {
          for (const [d, dh] of profile) {
            const [x, z] = P(ths[kk], d);
            pos.push(x, h + dh, z);
            uv.push(...uvOf(d, dh, arc[kk], x, z));
            cols.push(...colour(k));
          }
        }
        for (let j = 0; j + 1 < m; j++) index.push(v0 + j, v0 + m + j, v0 + j + 1, v0 + j + 1, v0 + m + j, v0 + m + j + 1);
      }
    };
    const build = (mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos.splice(0), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.splice(0), 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols.splice(0), 4));
      g.setIndex(index.splice(0));
      group.add(new THREE.Mesh(g, mat));
      return g;
    };
    // road (drawn over the end of the road that joins it, where the two meet)
    const over = (m) => { const c2 = m.clone(); c2.polygonOffset = true; c2.polygonOffsetFactor = -1; c2.polygonOffsetUnits = -2; return c2; };
    const ringRoadMat = over(roadMat), ringKerbMat = over(kerbMat);
    mesh(ringRoadMat, U.map((u) => [u * RW, 0]), null, () => shade(1), (d, dh, a, x, z) => [x / roadTile, z / roadTile]);
    const ringRoad = build(ringRoadMat);
    // kerbs: the inner one all round, the outer one open where the road joins
    const kband = (k) => shade(Math.floor(arc[k] / 6) % 2 ? 1.25 : 0.6);
    mesh(kerbMat, [[-RW - KERB, KERB_UP], [-RW, KERB_UP], [-RW, 0]], null, kband, (d, dh, a) => [Math.abs(d) / kerbTile + dh / kerbTile, a / kerbTile]);
    mesh(kerbMat, [[RW, 0], [RW, KERB_UP], [RW + KERB, KERB_UP]], open, kband, (d, dh, a) => [Math.abs(d) / kerbTile + dh / kerbTile, a / kerbTile]);
    const ringKerbs = build(ringKerbMat);
    // the mouth, where the road joins: paved out to meet it (no lava between the two)
    mesh(ringRoadMat, [[RW, 0], [RW + KERB + BT + 3, 0]], (th) => !open(th), () => shade(1), (d, dh, a, x, z) => [x / roadTile, z / roadTile]);
    const mouth = build(ringRoadMat);
    // walls: inner all round; outer open where the road joins; both run down into the lava
    const e = RW + KERB, low = -9;
    mesh(wallMat, [[-e - BT, low], [-e - BT, KERB_UP + BH], [-e, KERB_UP + BH], [-e, KERB_UP]], null, () => shade(1), (d, dh, a) => [a / wallTile, (dh + Math.abs(d)) / wallTile]);
    mesh(wallMat, [[e, KERB_UP], [e, KERB_UP + BH], [e + BT, KERB_UP + BH], [e + BT, low]], open, () => shade(1), (d, dh, a) => [a / wallTile, (dh + Math.abs(d)) / wallTile]);
    build(wallMat);
    // wall ends at the mouth
    for (let k = 0; k < N; k++) {
      if (open(ths[k]) === open(ths[k + 1])) continue;
      const th = open(ths[k]) ? ths[k + 1] : ths[k];
      const [x1, z1] = P(th, e), [x2, z2] = P(th, e + BT);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([x1, h + low, z1, x2, h + low, z2, x2, h + KERB_UP + BH, z2, x1, h + KERB_UP + BH, z1], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, BT / wallTile, 0, BT / wallTile, BH / wallTile, 0, BH / wallTile], 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute([...col, ...col, ...col, ...col], 4));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      group.add(new THREE.Mesh(g, wallMat));
    }
    // the road to the ring, run on straight from its last cross-section into the ring's band (to the
    // ring's middle): under the ring's road, it closes any gap between the two, whatever the angle
    let ext = null;
    {
      let last = -1;
      for (let i = ring.first - 1; i >= Math.max(0, ring.first - 80); i--) if (!hidden.has(i)) { last = i; break; }
      if (last >= 0) {
        const p = track.path[last], tg = track.tangent(last), sd = sides[last];
        const reach = RW * 2 + KERB * 2 + 6;
        const hy = surface(last, 0) + LIFT - 0.05;
        const cols = [-wl[last], 0, wr[last]];
        const pos = [], uvA = [], colA = [], index = [];
        for (const along of [0, reach]) {
          for (const d of cols) {
            const x = p.x + sd.x * d + tg.x * along, z = p.z + sd.z * d + tg.z * along;
            pos.push(x, hy, z); uvA.push(x / roadTile, z / roadTile); colA.push(...lit(last));
          }
        }
        for (let k = 0; k < 2; k++) index.push(k, 3 + k, k + 1, k + 1, 3 + k, 4 + k);
        ext = new THREE.BufferGeometry();
        ext.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        ext.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
        ext.setAttribute('color', new THREE.Float32BufferAttribute(colA, 4));
        ext.setIndex(index);
        group.add(new THREE.Mesh(ext, roadMat));
      }
    }
    group.userData.ringGeometry = merge([ringRoad, ringKerbs, mouth, ...(ext ? [ext] : [])]);
    track.ringOpen = open;
  }
  group.userData.roadGeometry = merge([...group.userData.roadParts, ...(group.userData.ringGeometry ? [group.userData.ringGeometry] : [])]);
  track.surfaceLift = LIFT;
  group.userData.roadDebug = { G, H: Hh, C, X, Z };     // tools/road_check.mjs


  // --- barriers: a low wall along each edge, the whole way - never a break except where the
  // track itself joins or crosses another stretch of the track (a junction). Short gaps are
  // closed and short stubs dropped: walls run in long clean lengths.
  const railR = new Float32Array(n).fill(Infinity);
  const railL = new Float32Array(n).fill(Infinity);
  const wallAt = (i, sgn) => sideW(sgn)[i] + KERB;
  // Barriers default to both sides. A course may open one edge (for example, the sea side of
  // an island road) without removing its landward wall. A side setting is relative to the
  // direction of travel; an omitted side remains walled. An open side has no keep-inside rail.
  const barrierSideEnabled = (sgn) => !c.barriers || typeof c.barriers !== 'object'
    || c.barriers[sgn > 0 ? 'right' : 'left'] !== false;
  if (c.barriers !== false) {
    for (const [rail, sgn] of [[railR, 1], [railL, -1]]) {
      if (!barrierSideEnabled(sgn)) continue;
      for (let i = 0; i < n; i++) {
        if (hidden.has(i)) continue;                         // (drawn by the first pass of a shared road)
        const e = wallAt(i, sgn);
        const [bx, bz] = xz(i, (e + BT * 0.5) * sgn);
        if (onRoad(bx, bz, track.path[i].y, 0.5, i)) continue;   // another stretch of the track is there
        rail[i] = e;
      }
      // folds back on itself (inside of a tight turn): no wall there
      for (let i = 0; i + 1 < n; i++) {
        if (rail[i] === Infinity || rail[i + 1] === Infinity) continue;
        const [ax, az] = xz(i, rail[i] * sgn), [bx2, bz2] = xz(i + 1, rail[i + 1] * sgn);
        const t = track.tangent(i);
        if ((bx2 - ax) * t.x + (bz2 - az) * t.z < 0.3 * step(i)) rail[i] = Infinity;
      }
      for (let i = 0; i < n; i++) {                          // close gaps shorter than ~60 units
        if (rail[i] !== Infinity) continue;
        let j = i;
        while (j < n && rail[j] === Infinity) j++;
        if (i > 0 && j < n && j - i < 10) {
          let clear = true;
          for (let k = i; k < j && clear; k++) {
            const [bx, bz] = xz(k, (wallAt(k, sgn) + BT * 0.5) * sgn);
            if (onRoad(bx, bz, track.path[k].y, 0.5, k)) clear = false;
          }
          if (clear) for (let k = i; k < j; k++) rail[k] = wallAt(k, sgn);
        }
        i = j;
      }
      for (let i = 0; i < n; i++) {                          // drop stubs shorter than ~90 units
        if (rail[i] === Infinity) continue;
        let j = i;
        while (j < n && rail[j] !== Infinity) j++;
        if (j - i < 15) for (let k = i; k < j; k++) rail[k] = Infinity;
        i = j;
      }
    }
  }
  // the walls: inner face from the kerb up, a flat top, the outer face down to the ground
  const decor = [];
  for (const [rail, sgn] of [[railR, 1], [railL, -1]]) {
    const runs = [];
    for (let i = 0; i < n; i++) {
      if (rail[i] === Infinity) continue;
      let j = i;
      while (j + 1 < n && rail[j + 1] !== Infinity) j++;
      if (j > i) runs.push([i, j]);
      i = j;
    }
    if (!runs.length) continue;
    const cols = (i) => {
      const e = rail[i] * sgn, e2 = (rail[i] + BT) * sgn, base = surface(i, e) + LIFT + KERB_UP, top = base + BH;
      const out = Math.min(surface(i, e2), base) - 3;
      return sgn > 0 ? [[e, base], [e, top], [e2, top], [e2, out]] : [[e2, out], [e2, top], [e, top], [e, base]];
    };
    group.add(new THREE.Mesh(strip(runs, cols, (i, ii, d) => lit(ii, 1.0),
      (ii, d, h) => [dist[ii] / wallTile, (h + Math.abs(d)) / wallTile]), wallMat));
    for (const [a, b] of runs) {                             // end caps
      for (const i of [a, b]) {
        const e = rail[i] * sgn, e2 = (rail[i] + BT) * sgn, base = surface(i, e) + LIFT + KERB_UP;
        const [x1, z1] = xz(i, e), [x2, z2] = xz(i, e2);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([x1, base, z1, x2, base - 3, z2, x2, base + BH, z2, x1, base + BH, z1], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, BT / wallTile, 0, BT / wallTile, BH / wallTile, 0, BH / wallTile], 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute([...lit(i), ...lit(i), ...lit(i), ...lit(i)], 4));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        group.add(new THREE.Mesh(g, wallMat));
      }
    }
  }
  const postMat = new THREE.MeshBasicMaterial({ map: (c.barrier || c.kerb) ? tex(c.barrier || c.kerb) : null, color: 0xbbbbbb });

  // --- chevrons on the outside of sharp turns
  const chevTex = (dir) => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#2b1a0c'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#a8853f'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
    g.fillStyle = '#ffcf4a';
    for (let k = 0; k < 3; k++) {
      const x0 = 40 + k * 64;
      g.beginPath();
      if (dir > 0) { g.moveTo(x0, 24); g.lineTo(x0 + 36, 64); g.lineTo(x0, 104); g.lineTo(x0 + 18, 104); g.lineTo(x0 + 54, 64); g.lineTo(x0 + 18, 24); }
      else { g.moveTo(x0 + 54, 24); g.lineTo(x0 + 18, 64); g.lineTo(x0 + 54, 104); g.lineTo(x0 + 36, 104); g.lineTo(x0, 64); g.lineTo(x0 + 36, 24); }
      g.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const chevMat = { 1: new THREE.MeshBasicMaterial({ map: chevTex(1) }), [-1]: new THREE.MeshBasicMaterial({ map: chevTex(-1) }) };
  const board = new THREE.PlaneGeometry(9, 4.5);
  let lastChev = -999;
  for (let i = 0; i < n; i++) {
    if (track.bend[i] < 0.4 || i - lastChev < 25 || (track.open && i + 8 >= n) || hidden.has(i) || hidden.has(idx(i + 6))) continue;
    const a = track.tangent(i), b = track.tangent(idx(i + 8));
    const turn = Math.sign(a.x * b.z - a.z * b.x);               // + = turning right
    const k = idx(i + 6);                                         // at the corner, on the outside
    const outside = -turn;
    const room = outside > 0 ? Math.min(railR[k], track.roomR[k] - 1) : Math.min(railL[k], track.roomL[k] - 1);
    const wk = sideW(outside)[k];
    const off = Math.max(wk + KERB + 1.5, Math.min(room, wk + KERB + 4)) * outside;
    const p = track.path[k];
    const x = p.x + sides[k].x * off, z = p.z + sides[k].z * off;
    if (room < wk + KERB + 1.5 || onRoad(x, z, p.y, 0.5, k)) continue;   // no room beside the road: no board
    const y = surface(k, off);
    const m = new THREE.Mesh(board, chevMat[turn]);
    m.position.set(x, y + 4.5, z);
    const back = track.tangent(i).negate();                      // face the drivers coming in
    m.rotation.y = Math.atan2(back.x, back.z);
    group.add(m);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 6), postMat);
    pole.position.set(x, y + 1.6, z);
    group.add(pole);
    decor.push({ kind: 'chevron', x, y, z });
    lastChev = i;
  }

  // --- start / finish arches (one arch where a lap starts and ends; two on an open course)
  const arch = (i) => {
    const p = track.path[i], s = sides[i];
    const reach = (sg) => Math.min(sideW(sg)[i] + KERB, (sg > 0 ? track.roomR[i] : track.roomL[i]) - 1);
    for (const sg of [-1, 1]) {
      const x = p.x + s.x * reach(sg) * sg, z = p.z + s.z * reach(sg) * sg;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 16, 8), postMat);
      post.position.set(x, surface(i, reach(sg) * sg) + 8, z);
      group.add(post);
    }
    const wa = (reach(-1) + reach(1)) / 2, mo = (reach(1) - reach(-1)) / 2;   // half the span, its middle
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 64;
    const g = cv.getContext('2d');
    for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#eee';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const y0 = Hh[i][midCol];
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(wa * 2, 3), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    banner.position.set(p.x + s.x * mo, y0 + 14.5, p.z + s.z * mo);
    banner.rotation.y = Math.atan2(s.x, s.z) + Math.PI / 2;
    group.add(banner);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(wa * 2, 2.5), new THREE.MeshBasicMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    line.rotation.order = 'YXZ';                                 // turn to face along the road, then lay flat
    line.rotation.y = Math.atan2(s.x, s.z) + Math.PI / 2;
    line.rotation.x = -Math.PI / 2;
    line.position.set(p.x + s.x * mo, surface(i, mo) + LIFT + 0.08, p.z + s.z * mo);
    group.add(line);
  };
  arch(track.start);
  if (track.open) arch(track.finish);

  // the ring: walls on both sides; the outside (on the right, going round anticlockwise) open
  // where the road to it joins
  if (ring) {
    const [cx, cy] = ring.center, [rx, ry] = ring.radius;
    for (const i of ringSet) {
      railL[i] = ring.half_width + KERB;
      const th = Math.atan2((-track.path[i].z - cy) / ry, (track.path[i].x - cx) / rx);
      railR[i] = track.ringOpen?.(th) ? Infinity : ring.half_width + KERB;
    }
  }
  // the later pass of a road taken both ways has the first pass's walls (left and right swapped)
  if (sharedLater.size) {
    for (const i of sharedLater) {
      let best = -1, bd = 12;
      for (let j = 0; j < n; j++) {
        if (hidden.has(j)) continue;
        const d = Math.hypot(track.path[i].x - track.path[j].x, track.path[i].z - track.path[j].z);
        if (d < bd && Math.abs(track.path[i].y - track.path[j].y) < 12) { bd = d; best = j; }
      }
      if (best < 0) continue;
      railR[i] = railL[best];
      railL[i] = railR[best];
      wr[i] = wl[best];
      wl[i] = wr[best];
    }
  }
  // CPU drivers keep their lanes inside the fences
  for (let i = 0; i < n; i++) {
    track.roomR[i] = Math.min(track.roomR[i], railR[i]);
    track.roomL[i] = Math.min(track.roomL[i], railL[i]);
  }
  // nothing may stand on the drivable surface: checked on every load (tools/check_decor.mjs)
  group.userData.decorOnRoad = decor.filter((d) => {
    for (let j = 0; j < n; j++) {
      const dx = px[j] - d.x, dz = pz[j] - d.z, r = (wl[j] + wr[j]) / 2 - 0.5;
      if (dx * dx + dz * dz < r * r && Math.abs(track.path[j].y - d.y) < 12) return true;
    }
    return false;
  });
  if (group.userData.decorOnRoad.length) console.error('decor on the road:', JSON.stringify(group.userData.decorOnRoad.slice(0, 5)));
  group.userData.roadQuery = roadQuery(track, rows, sides, segs);
  track.railR = railR;
  track.railL = railL;
  track.sides = sides;
  return group;
}

// keep a kart inside the fences: push it back and take the sideways speed out
export function keepInside(k, track) {
  if (!track.railR) return;
  const i = k.progress;
  const s = track.sides[i];
  const p = track.path[i];
  const lat = (k.pos.x - p.x) * s.x + (k.pos.z - p.z) * s.z;
  const r = track.railR[i] - 2.4, l = track.railL[i] - 2.4;
  let push = 0;
  if (lat > r) push = r - lat;
  else if (lat < -l) push = -l - lat;
  if (!push) return;
  k.pos.x += s.x * push;
  k.pos.z += s.z * push;
  const vs = k.vel.x * s.x + k.vel.z * s.z;
  if (vs * push < 0) {                         // moving into the fence: bounce off it
    k.vel.x -= s.x * vs * 1.35;
    k.vel.z -= s.z * vs * 1.35;
    if (Math.abs(vs) > 12) k.vel.multiplyScalar(0.9);  // only a real impact costs speed
  }
}

// minimap: the course drawn from above, racers as dots, the player highlighted
export function makeMinimap(track) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 220;
  cv.id = 'minimap';
  document.getElementById('hud').appendChild(cv);
  const xs = track.path.map((p) => p.x), zs = track.path.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = 196 / Math.max(maxX - minX, maxZ - minZ);
  const ox = (220 - (maxX - minX) * sc) / 2, oz = (220 - (maxZ - minZ) * sc) / 2;
  const P = (v) => [ox + (v.x - minX) * sc, oz + (v.z - minZ) * sc];
  const g = cv.getContext('2d');
  return (karts, player) => {
    g.clearRect(0, 0, 220, 220);
    g.lineJoin = 'round';
    g.beginPath();
    track.path.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    if (!track.open) g.closePath();
    g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 9; g.stroke();
    g.strokeStyle = '#e8d7a8'; g.lineWidth = 5; g.stroke();
    for (const i of track.open ? [track.start, track.finish] : [0]) {
      const [sx, sy] = P(track.path[i]);
      g.fillStyle = i === track.finish && track.open ? '#ffcf4a' : '#fff';
      g.fillRect(sx - 4, sy - 4, 8, 8);
    }
    for (const k of karts) {
      const [x, y] = P(k.pos);
      g.beginPath();
      g.arc(x, y, k === player ? 6 : 4, 0, Math.PI * 2);
      g.fillStyle = k === player ? '#ffcf4a' : '#' + k.colorHex;
      g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
    }
  };
}
