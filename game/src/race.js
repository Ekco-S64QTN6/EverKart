// Racing line, lap/progress tracking, CPU driving.
import * as THREE from 'three';

export class Track {
  constructor(data) {
    this.data = data;
    this.path = data.path.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.n = this.path.length;
    this.width = data.width;
    this.room = data.room || this.path.map(() => data.width);   // corridor half width per point
    let len = 0;                                  // the line's average spacing (units per path point)
    for (let i = 1; i < this.n; i++) len += this.path[i].distanceTo(this.path[i - 1]);
    this.step = len / Math.max(1, this.n - 1);
    // an open course (point to point) runs from the back of the grid to the finish once; a
    // closed one is a lap that wraps round
    this.open = !!data.open;
    this.start = data.start ?? 0;                 // path index of the start line (open courses)
    this.finish = data.finish ?? this.n - 1;      // ... and of the finish line
    // how sharply the line turns over the next ~60 units, per point (0 straight .. 2 U-turn)
    this.bend = this.path.map((_, i) => {
      const a = this.tangent(i);
      let worst = 0;
      for (let k = 3; k <= 12; k++) worst = Math.max(worst, 1 - a.dot(this.tangent(this.idx(i + k))));
      return worst;
    });
  }

  // a path index k steps on from i: wraps round a lap, stops at the ends of an open course
  idx(i) {
    const n = this.n;
    return this.open ? Math.min(n - 1, Math.max(0, i)) : ((i % n) + n) % n;
  }

  // Move the line to the middle of the corridor it runs through (the 2D picks and the
  // smoothing clip corners), then smooth again. Heights stay as exported.
  centre(collider, cast) {
    const out = this.path.map((p) => p.clone());
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.n; i++) {
        const p = out[i];
        const tan = new THREE.Vector3().subVectors(out[(i + 1) % this.n], out[(i - 1 + this.n) % this.n]).setY(0).normalize();
        const side = new THREE.Vector3(-tan.z, 0, tan.x);
        const o = p.clone().add(new THREE.Vector3(0, 8, 0));
        const far = this.width * 2.5;
        const l = cast(collider, o, side.clone().negate(), far);
        const r = cast(collider, o, side, far);
        const dl = l ? l.distance : far, dr = r ? r.distance : far;
        if (dl < far || dr < far) p.addScaledVector(side, THREE.MathUtils.clamp((dr - dl) / 2, -8, 8) * 0.5);
      }
      for (let k = 0; k < 2; k++) {
        const prev = out.map((p) => p.clone());
        for (let i = 0; i < this.n; i++) {
          const a = prev[(i - 1 + this.n) % this.n], b = prev[(i + 1) % this.n];
          out[i].x = 0.25 * a.x + 0.5 * prev[i].x + 0.25 * b.x;
          out[i].z = 0.25 * a.z + 0.5 * prev[i].z + 0.25 * b.z;
        }
      }
    }
    this.path = out;
  }

  // free space left and right of each line point (raycasts at kart height)
  measure(collider, cast) {
    this.roomL = [];
    this.roomR = [];
    const roomL0 = [], roomR0 = [];
    for (let i = 0; i < this.n; i++) {
      const tan = this.tangent(i);
      const side = new THREE.Vector3(-tan.z, 0, tan.x);
      const o = this.path[i].clone().add(new THREE.Vector3(0, 6, 0));
      const far = Math.max(60, this.width * 2.5);     // (a cavern's far wall too: the road reaches it)
      const r = cast(collider, o, side, far);
      const l = cast(collider, o, side.clone().negate(), far);
      this.roomR.push(r ? r.distance : far);
      this.roomL.push(l ? l.distance : far);
      // the wall beside the point, for the road's edges: a wall face (steeper than 60 degrees) or an
      // overhang - not a hillside rising beside the road: the road's bed is cut into that (the
      // exporter's floor measure knows how far)
      const wall = (h) => (h && !(h.face && h.face.normal.y >= 0.5) ? h.distance : far);
      roomR0.push(wall(r));
      roomL0.push(wall(l));
    }
    this.rayFar = Math.max(60, this.width * 2.5);
    this.roomL0 = roomL0;
    this.roomR0 = roomR0;
    // the tightest spot nearby counts (karts take the whole corner)
    const tight = (a) => a.map((_, i) => Math.min(...[-4, -2, 0, 2, 4, 6, 8].map((k) => a[this.idx(i + k)])));
    this.roomL = tight(this.roomL);
    this.roomR = tight(this.roomR);
  }

  // nearest path index, searched around the previous one
  nearest(pos, hint) {
    let best = hint, bestD = Infinity;
    for (let k = -25; k <= 40; k++) {
      const i = this.idx(hint + k);
      const d = this.path[i].distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  tangent(i, out = new THREE.Vector3()) {
    if (this.open && i >= this.n - 1) return out.subVectors(this.path[this.n - 1], this.path[this.n - 2]).setY(0).normalize();
    return out.subVectors(this.path[(i + 1) % this.n], this.path[i]).setY(0).normalize();
  }
}

// progress + laps; lap counts when the index wraps past the start
export function updateProgress(kart, track) {
  const { index, dist } = track.nearest(kart.pos, kart.progress);
  const n = track.n;
  if (track.open) {                              // point to point: past the finish line ends the race
    if (index >= track.finish) kart.lap = Math.max(kart.lap, 1);
  } else if (kart.progress > n * 0.8 && index < n * 0.2) kart.lap += 1;
  else if (kart.progress < n * 0.2 && index > n * 0.8) kart.lap -= 1;
  kart.progress = index;
  kart.offTrack = dist;
  kart.lastGood = kart.lastGood ?? index;
  if (kart.onGround && dist < track.width * 1.2) kart.lastGood = index;
}

export function raceDistance(kart, track) {
  return track.open ? kart.progress : kart.lap * track.n + kart.progress;
}

// CPU driver: chase a point a little ahead on the line, in its own lane
export class Driver {
  constructor(kart, track, lane, skill) {
    this.kart = kart;
    this.track = track;
    this.lane = lane;
    this.skill = skill;
    this.stuck = 0;
    this.drifter = Math.random() < 0.65;          // some racers drift the long bends for mini-turbos
  }

  update(dt) {
    const k = this.kart, t = this.track;
    if (t.open && k.finished) {                   // past the finish of an open course: roll to a stop
      k.input.throttle = k.speed > 12 ? -0.5 : 0;
      k.input.drift = false;
      const to = t.path[t.idx(k.progress + 4)].clone().sub(k.pos).setY(0);
      let diff = Math.atan2(to.x, -to.z) - k.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      k.input.steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
      return;
    }
    const ahead = Math.round(3 + Math.abs(k.speed) / 14);
    const i = t.idx(k.progress + ahead);
    const tan = t.tangent(i);
    const side = new THREE.Vector3(-tan.z, 0, tan.x);
    // own lane on the straights; in a bend, the inside of it (the apex), kept inside the free space
    const a = t.tangent(i), b = t.tangent(t.idx(i + 8));
    const inside = Math.sign(a.x * b.z - a.z * b.x);              // + = the bend turns right
    const bendK = Math.min(1, t.bend[i] / 0.5);
    // (the road's middle may be off the line: each edge goes out to its own wall)
    const wR = t.roadWR?.[i] ?? t.width, wL = t.roadWL?.[i] ?? t.width, mid = (wR - wL) / 2, hw = (wR + wL) / 2;
    let want0 = mid + this.lane * Math.min(hw, t.width) * 0.3 * (1 - bendK) + inside * hw * 0.45 * bendK;
    if (t.sharedSet?.has(i)) want0 = mid + hw * 0.45;               // a road taken both ways: keep right
    const lane = t.roomL ? THREE.MathUtils.clamp(want0, -Math.max(0, t.roomL[i] - 8), Math.max(0, t.roomR[i] - 8)) : want0;
    const target = t.path[i].clone().addScaledVector(side, lane);
    const to = target.sub(k.pos).setY(0);
    const want = Math.atan2(to.x, -to.z);
    let diff = want - k.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    k.input.steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);   // positive = turn right
    // brake for the sharpest bend coming up within braking distance
    let bend = 0;
    const look = Math.round(4 + Math.max(0, k.speed) / 6);
    for (let j = 1; j <= look; j += 2) bend = Math.max(bend, t.bend[t.idx(k.progress + j)]);
    // (a racer catching up carries more speed through the bends too: rubber banding below)
    const corner = (82 - 30 * Math.min(1, bend / 0.9)) * (1 + Math.max(0, (this.band ?? 1) - 1) * 0.85);   // ~52 units/s for a right angle
    k.input.throttle = k.speed > corner ? (k.speed > corner + 8 ? -0.6 : 0) : 1;
    // drift a sustained bend with room either side; let go as it straightens (the mini-turbo)
    if (this.drifter) {
      let long = 0;
      for (let j = 2; j <= 14; j += 2) long += t.bend[t.idx(k.progress + j)] > 0.22 ? 1 : 0;
      const room = Math.min(t.roomL?.[i] ?? 99, t.roomR?.[i] ?? 99);
      const turn = Math.sign(a.x * b.z - a.z * b.x);
      if (!k.drifting) k.input.drift = long >= 5 && room > 12 && k.speed > 45 && Math.sign(k.input.steer) === turn;
      else k.input.drift = long >= 2 && Math.abs(diff) < 0.9;
      if (k.drifting) k.input.throttle = 1;
    }
    if (Math.abs(diff) > 1.2 && k.speed > 25) k.input.throttle = -0.4;          // way off line: slow
    // rubber banding, as every kart racer does it: the pack stays on you. Behind you, a CPU finds
    // more top speed, quicker acceleration and faster cornering the further back it is (up to
    // +30% at 300 units; the rivals' difficulty scales it), so a lead has to be defended all
    // race; ahead of you it eases off (less on the last lap, so a lead you let slip is still a
    // lead). Within ~25 units of you it races at its own pace.
    let band = 1;
    if (this.rival && this.rival !== k) {
      const gap = (raceDistance(this.rival, t) - raceDistance(k, t)) * (t.step || 5);   // units; + = you are ahead of it
      const last = t.laps && k.lap >= t.laps - 1 ? 0.6 : 1;
      if (gap > 25) band = 1 + 0.3 * THREE.MathUtils.smoothstep(gap, 25, 300);
      else if (gap < -40) band = 1 - 0.12 * last * THREE.MathUtils.smoothstep(-gap, 40, 300);
    }
    band = 1 + (band - 1) * (this.bandScale ?? 1);                // the difficulty: how hard the pack pushes
    this.band = this.band ?? band;
    this.band += (band - this.band) * Math.min(1, dt * 1.5);       // eased: no sudden surges
    k.maxSpeedScale = this.skill * this.band;
    k.accelScale = Math.max(1, this.band);
    // unstick: reverse briefly when not moving
    if (Math.abs(k.speed) < 3) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 1.2) {
      k.input.throttle = -1;
      k.input.steer = -k.input.steer;
      if (this.stuck > 2.2) this.stuck = 0;
    }
  }
}
