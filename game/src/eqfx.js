// EverQuest spell particle effects, driven by the client's own data (spellsnew.eff /
// spellsnew.edd via tools/export_spellfx.py). Each spell has three stages - cast,
// projectile, impact - and each stage up to four emitters. Emitters are simulated from
// their EDD fields: shape, emission ticks, lifetime, fades, grow/shrink, axial /
// transverse / radial / orbital velocity, gravity, colour ramp and flipbook.
// Field meanings follow OpenEQ's notes (reverse-engineered from EQGraphicsDX9.dll).
import * as THREE from 'three';

const VERT = `
  attribute float size; attribute float alpha; attribute float frame; attribute vec3 tint; attribute vec2 grid;
  uniform float scale;
  varying float vAlpha; varying float vFrame; varying vec3 vTint; varying vec2 vGrid;
  void main() {
    vAlpha = alpha; vFrame = frame; vTint = tint; vGrid = grid;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D map; uniform float additive;
  varying float vAlpha; varying float vFrame; varying vec3 vTint; varying vec2 vGrid;
  void main() {
    if (vAlpha <= 0.0) discard;
    float col = mod(vFrame, vGrid.x), row = floor(vFrame / vGrid.x);
    vec2 uv = vec2((col + gl_PointCoord.x) / vGrid.x, 1.0 - (row + gl_PointCoord.y) / vGrid.y);
    vec4 c = texture2D(map, uv);
    if (additive > 0.5) gl_FragColor = vec4(c.rgb * vTint * c.a * vAlpha, 1.0);
    else gl_FragColor = vec4(c.rgb * vTint, c.a * vAlpha);
  }`;

const MAX = 1500;
const TWO_PI = Math.PI * 2;
const rnd = (a, b) => a + (b - a) * Math.random();

class Batch {
  constructor(scene, tex, additive) {
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.a = {
      position: new Float32Array(MAX * 3), size: new Float32Array(MAX), alpha: new Float32Array(MAX),
      frame: new Float32Array(MAX), tint: new Float32Array(MAX * 3), grid: new Float32Array(MAX * 2),
    };
    for (const [k, arr] of Object.entries(this.a)) g.setAttribute(k, new THREE.BufferAttribute(arr, arr.length / MAX));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 400 }, additive: { value: additive ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  draw(scale) {
    this.mat.uniforms.scale.value = scale;
    const n = Math.min(this.p.length, MAX);
    const A = this.a;
    for (let i = 0; i < n; i++) {
      const q = this.p[i];
      A.position.set([q.world.x, q.world.y, q.world.z], i * 3);
      A.size[i] = q.drawSize;
      A.alpha[i] = q.drawAlpha;
      A.frame[i] = q.drawFrame;
      A.tint.set(q.drawTint, i * 3);
      A.grid.set(q.grid, i * 2);
    }
    A.alpha.fill(0, n);
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const k of Object.keys(A)) g.attributes[k].needsUpdate = true;
  }
}

// spawn position in the emitter basis: [axial (up), transverse1, transverse2]
function spawnLocal(e) {
  const [d0, d1raw, d2raw] = e.dims;
  const d1 = d1raw || d0, d2 = d2raw || d0;
  switch (e.shape) {
    case 1: case 9: {                       // ring (1 evenly spaced is close enough to random)
      const t = Math.random() * TWO_PI;
      return [0, Math.cos(t) * d0, Math.sin(t) * d1];
    }
    case 2: case 5: {                       // sphere / ellipsoid surface
      const z = rnd(-1, 1), t = Math.random() * TWO_PI, r = Math.sqrt(1 - z * z);
      return [z * d2, r * Math.cos(t) * d0, r * Math.sin(t) * d1];
    }
    case 3: {                               // cylinder side
      const t = Math.random() * TWO_PI;
      return [(Math.random() - 0.5) * (e.dims[2] || d0), Math.cos(t) * d0, Math.sin(t) * d1];
    }
    case 4: {                               // disk interior
      let x, y;
      do { x = rnd(-1, 1); y = rnd(-1, 1); } while (x * x + y * y > 1);
      return [0, x * d0, y * d1];
    }
    case 6: {                               // box surface
      const p = [rnd(-1, 1) * d2, rnd(-1, 1) * d0, rnd(-1, 1) * d1];
      const face = Math.floor(Math.random() * 3);
      p[face] = (Math.random() < 0.5 ? -1 : 1) * [d2, d0, d1][face];
      return p;
    }
    case 7: {                               // cone side
      const s = Math.random(), t = Math.random() * TWO_PI;
      return [s * (e.dims[2] || d0), Math.cos(t) * d0 * s, Math.sin(t) * d1 * s];
    }
    case 8: {                               // torus
      const a = Math.random() * TWO_PI, b = Math.random() * TWO_PI, R = d0, r = e.dims[2] || d0 * 0.25;
      return [Math.sin(b) * r, Math.cos(a) * (R + Math.cos(b) * r), Math.sin(a) * (R + Math.cos(b) * r)];
    }
    default:
      return [0, 0, 0];
  }
}

class Emitter {
  constructor(sys, e, anchor, attach, duration) {
    this.sys = sys;
    this.e = e;
    this.anchor = anchor;
    this.attach = attach;
    this.dur = e.duration < 0 ? -e.duration : duration;   // negative = the emitter's own duration
    this.age = -Math.max(0, e.delay);
    this.tick = 0;
    this.started = false;
    this.batch = sys.batch(e.texture, e.additive);
  }

  get done() { return this.age > this.dur; }

  spawn(count) {
    const e = this.e;
    const origin = this.anchor.point(this.attach);
    const B = this.anchor.basis();
    for (let k = 0; k < count; k++) {
      const loc = spawnLocal(e);
      loc[0] += e.offset[0]; loc[1] += e.offset[1]; loc[2] += e.offset[2];
      const len = Math.hypot(loc[0], loc[1], loc[2]);
      const dir = len > 1e-4 ? loc.map((v) => v / len) : [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      const w = rnd(e.width[0], e.width[1]);
      const life = e.life > 0 ? e.life : Math.max(0.2, this.dur);
      this.batch.p.push({
        e, life, age: 0, follow: e.follow === 1, anchor: this.anchor, attach: this.attach,
        origin: origin.clone(), B,
        loc, dir,
        va: rnd(e.axial[0], e.axial[1]), v1: rnd(e.trans1[0], e.trans1[1]), v2: rnd(e.trans2[0], e.trans2[1]),
        vr: rnd(e.radial[0], e.radial[1]),
        om: THREE.MathUtils.clamp(rnd(e.orbit[0], e.orbit[1]) / 512 * TWO_PI, -40, 40),
        fall: 0, size: w, grid: e.grid, frame0: e.frames > 1 ? Math.floor(Math.random() * e.frames) * 0 : 0,
        world: origin.clone(),
      });
    }
  }

  update(dt) {
    const e = this.e;
    this.age += dt;
    if (this.age < 0) return;
    if (!this.started) {
      this.started = true;
      this.spawn(e.initial);
    }
    if (this.age > this.dur || e.rate <= 0 || e.perTick <= 0) return;
    this.tick += dt;
    const every = 1 / e.rate;
    while (this.tick >= every) {
      this.tick -= every;
      this.spawn(e.perTick);
    }
  }
}

function stepParticle(q, dt) {
  const e = q.e;
  q.age += dt;
  // velocities (each with its own acceleration) in the emitter basis
  q.loc[0] += q.va * dt; q.va += e.axial[2] * dt;
  q.loc[1] += q.v1 * dt; q.v1 += e.trans1[2] * dt;
  q.loc[2] += q.v2 * dt; q.v2 += e.trans2[2] * dt;
  q.loc[0] += q.dir[0] * q.vr * dt; q.loc[1] += q.dir[1] * q.vr * dt; q.loc[2] += q.dir[2] * q.vr * dt;
  q.vr += e.radial[2] * dt;
  if (q.om) {                                   // orbit about the axial axis
    const c = Math.cos(q.om * dt), s = Math.sin(q.om * dt);
    const t1 = q.loc[1], t2 = q.loc[2];
    q.loc[1] = t1 * c - t2 * s;
    q.loc[2] = t1 * s + t2 * c;
    q.om += (e.orbit[2] / 512) * TWO_PI * dt;
  }
  q.fall += e.gravity * q.age * dt;            // world-down acceleration
  const base = q.follow ? q.anchor.point(q.attach) : q.origin;
  const B = q.follow ? q.anchor.basis() : q.B;
  q.world.copy(base)
    .addScaledVector(B.up, q.loc[0]).addScaledVector(B.fwd, q.loc[1]).addScaledVector(B.right, q.loc[2]);
  q.world.y -= q.fall;
  // opacity: min(fade-in * fade-out, opacity cap); negative ramps are disabled
  const L = q.life, a = q.age;
  const fi = e.fadeIn > 0 ? Math.min(1, a / e.fadeIn) : 1;
  const fo = e.fadeOut > 0 ? Math.min(1, Math.max(0, L - a) / e.fadeOut) : 1;
  q.drawAlpha = Math.min(fi * fo, e.opacity);
  const gi = e.growIn > 0 ? Math.min(1, a / e.growIn) : 1;
  const so = e.shrinkOut > 0 ? Math.min(1, Math.max(0, L - a) / e.shrinkOut) : 1;
  q.drawSize = q.size * gi * so;
  const t = Math.min(1, a / L);
  q.drawTint = [0, 1, 2].map((k) => (e.color0[k] + (e.color1[k] - e.color0[k]) * t) / 255);
  q.drawFrame = e.frames > 1 ? Math.floor(a * Math.abs(e.fps || 1)) % e.frames : 0;
  return a < L;
}

export class EqFx {
  constructor(scene, renderer, camera) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.batches = {};
    this.emitters = [];
    this.spells = {};
    this.loader = new THREE.TextureLoader();
  }

  async load() {
    this.spells = await (await fetch('spellfx/spells.json')).json();
  }

  batch(texture, additive) {
    const key = `${texture}|${additive}`;
    if (!this.batches[key]) {
      const tex = this.loader.load(`spellfx/tex/${texture}.png`);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.batches[key] = new Batch(this.scene, tex, additive);
    }
    return this.batches[key];
  }

  // play stage 0 (cast), 1 (projectile) or 2 (impact) of an item's spell on an anchor
  play(item, stage, anchor, duration = 1.5) {
    const spell = this.spells[item];
    if (!spell) return { stop() {} };
    const mine = [];
    for (const slot of spell.stages[stage] || []) {
      const em = new Emitter(this, slot.emitter, anchor, slot.attach, duration);
      this.emitters.push(em);
      mine.push(em);
    }
    return { stop: () => mine.forEach((m) => { m.dur = Math.min(m.dur, m.age); }) };
  }

  update(dt) {
    for (const em of this.emitters) em.update(dt);
    this.emitters = this.emitters.filter((em) => !em.done);
    const h = this.renderer.domElement.height;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const b of Object.values(this.batches)) {
      b.p = b.p.filter((q) => stepParticle(q, dt));
      if (b.p.length > MAX) b.p.splice(0, b.p.length - MAX);
      b.draw(scale);
    }
  }
}

// Attachment points on a kart + driver. EQ ids: 0 origin, 1 chest, 2 head, 3 feet,
// 4 / 5 the two hands (cast emitters pair them).
export function kartAnchor(kart) {
  const up = new THREE.Vector3(0, 1, 0);
  return {
    basis() {
      const fwd = kart.forward();
      return { up, fwd, right: new THREE.Vector3(-fwd.z, 0, fwd.x) };
    },
    point(id) {
      const fwd = kart.forward(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const p = kart.pos.clone();
      if (id === 1) return p.add(new THREE.Vector3(0, 4, 0));
      if (id === 2) return p.add(new THREE.Vector3(0, 5.6, 0));
      if (id === 3) return p.add(new THREE.Vector3(0, 0.4, 0));
      if (id === 4 || id === 5) return p.addScaledVector(right, id === 4 ? -1.4 : 1.4).add(new THREE.Vector3(0, 3.6, 0)).addScaledVector(fwd, 0.8);
      return p.add(new THREE.Vector3(0, 2.6, 0));
    },
  };
}

// a fixed or moving point (projectiles, traps)
export function pointAnchor(getPos, getFwd = () => new THREE.Vector3(0, 0, -1)) {
  const up = new THREE.Vector3(0, 1, 0);
  return {
    basis() { const fwd = getFwd(); return { up, fwd, right: new THREE.Vector3(-fwd.z, 0, fwd.x) }; },
    point() { return getPos().clone(); },
  };
}
