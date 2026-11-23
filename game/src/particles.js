// Particle effects built from EverQuest's own spell sprites (SpellEffects/*.dds from the
// client, exported to public/fx by tools/export_fx.py). Each sheet is a flipbook (2x2 or
// 4x4 frames); particles play it over their life, glowing additively like EQ's effects.
import * as THREE from 'three';

const VERT = `
  attribute float size; attribute float life; attribute float frame; attribute vec3 tint;
  uniform float scale;
  varying float vLife; varying float vFrame; varying vec3 vTint;
  void main() {
    vLife = life; vFrame = frame; vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D map; uniform float grid;
  varying float vLife; varying float vFrame; varying vec3 vTint;
  void main() {
    if (vLife <= 0.0) discard;
    float cell = floor(vFrame);
    float col = mod(cell, grid), row = floor(cell / grid);
    vec2 uv = vec2((col + gl_PointCoord.x) / grid, 1.0 - (row + gl_PointCoord.y) / grid);
    vec4 c = texture2D(map, uv);
    float fade = smoothstep(0.0, 0.25, vLife) * smoothstep(1.0, 0.9, vLife);   // quick fade in, fade out
    gl_FragColor = vec4(c.rgb * vTint * c.a * fade, 1.0);
  }`;

const MAX = 600;

class Batch {
  constructor(scene, name, grid, tex) {
    this.grid = grid;
    this.frames = grid * grid;
    this.n = 0;
    this.p = [];                                   // live particles
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.frame = new Float32Array(MAX);
    this.tint = new Float32Array(MAX * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('frame', new THREE.BufferAttribute(this.frame, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, grid: { value: grid }, scale: { value: 400 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  add(o) {
    if (this.p.length >= MAX) this.p.shift();
    this.p.push(o);
  }

  update(dt, scale) {
    this.mat.uniforms.scale.value = scale;
    const keep = [];
    for (const q of this.p) {
      q.age += dt;
      if (q.age >= q.life) continue;
      q.vel.y -= q.gravity * dt;
      q.vel.multiplyScalar(Math.exp(-q.drag * dt));
      q.pos.addScaledVector(q.vel, dt);
      if (q.orbit) {                                // swirl around a moving centre
        q.angle += q.orbit.speed * dt;
        const c = q.orbit.centre();
        q.pos.set(c.x + Math.cos(q.angle) * q.orbit.r, q.pos.y, c.z + Math.sin(q.angle) * q.orbit.r);
      }
      keep.push(q);
    }
    this.p = keep;
    let i = 0;
    for (const q of keep) {
      const t = q.age / q.life;
      this.pos.set([q.pos.x, q.pos.y, q.pos.z], i * 3);
      this.size[i] = q.size * (1 + (q.grow || 0) * t);
      this.life[i] = 1 - t;
      this.frame[i] = q.loop ? Math.floor((q.age * q.fps) % this.frames) : Math.min(this.frames - 1, t * this.frames);
      this.tint.set(q.tint, i * 3);
      i++;
    }
    this.life.fill(0, i);
    const g = this.points.geometry;
    g.setDrawRange(0, i);
    for (const a of ['position', 'size', 'life', 'frame', 'tint']) g.attributes[a].needsUpdate = true;
  }
}

export class Fx {
  constructor(scene, renderer, camera) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.batches = {};
    this.meta = {};
    this.loader = new THREE.TextureLoader();
  }

  async load() {
    this.meta = await (await fetch('fx/fx.json')).json();
  }

  batch(name) {
    if (!this.batches[name]) {
      const tex = this.loader.load(`fx/${name}.png`);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.batches[name] = new Batch(this.scene, name, this.meta[name]?.grid || 1, tex);
    }
    return this.batches[name];
  }

  // emit `count` particles of sprite `name` around `pos`
  emit(name, pos, {
    count = 1, spread = 0, vel = null, speed = 0, up = 0, life = 0.8, size = 3, gravity = 0, drag = 0,
    tint = [1, 1, 1], grow = 0, loop = false, fps = 12, orbit = null,
  } = {}) {
    const b = this.batch(name);
    for (let k = 0; k < count; k++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const p = pos.clone().addScaledVector(dir, spread * Math.random());
      const v = (vel ? vel.clone() : new THREE.Vector3()).addScaledVector(dir, speed).add(new THREE.Vector3(0, up, 0));
      b.add({
        pos: p, vel: v, age: 0, life: life * (0.8 + Math.random() * 0.4), size: size * (0.8 + Math.random() * 0.4),
        gravity, drag, tint, grow, loop, fps,
        orbit: orbit ? { ...orbit, r: orbit.r * (0.7 + Math.random() * 0.6) } : null,
        angle: Math.random() * Math.PI * 2,
      });
    }
  }

  update(dt) {
    const h = this.renderer.domElement.height;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const b of Object.values(this.batches)) b.update(dt, scale);
  }
}

// ready-made EQ spell looks
export const LOOKS = {
  fireballTrail: (fx, p) => {
    fx.emit('Firesp501', p, { count: 2, spread: 0.8, up: 2, life: 0.45, size: 5, grow: 0.6 });
    fx.emit('flamesp501', p, { count: 1, spread: 0.5, life: 0.35, size: 3.5 });
  },
  fireballCore: (fx, p) => fx.emit('flare_whsp501', p, { life: 0.08, size: 7, tint: [1, 0.7, 0.3] }),
  explosion: (fx, p) => {
    fx.emit('ExplosionA', p, { count: 6, spread: 2, speed: 6, up: 4, life: 0.7, size: 9, grow: 0.8 });
    fx.emit('redburstsp501', p, { life: 0.4, size: 16, grow: 1 });
    fx.emit('SmokeC', p, { count: 4, spread: 2, up: 5, life: 1.2, size: 7, grow: 1, tint: [0.5, 0.45, 0.4] });
  },
  wolf: (fx, p) => {
    fx.emit('BlueStarsp501', p, { count: 4, spread: 3.5, up: 3, life: 0.8, size: 3.6, loop: true });
    fx.emit('glittersp501', p, { count: 2, spread: 3.5, up: 1.5, life: 0.7, size: 2.6, tint: [0.6, 0.8, 1] });
  },
  whirlwind: (fx, p, t) => {
    fx.emit('Dustsp502', p.clone().add(new THREE.Vector3(0, Math.random() * 7, 0)), {
      life: 0.9, size: 4 + Math.random() * 3, loop: true, tint: [0.85, 0.8, 0.7],
      orbit: { r: 1.5 + Math.random() * 1.5, speed: 7, centre: () => p },
    });
    if (Math.random() < 0.3) fx.emit('cloudsp501', p, { spread: 1.5, up: 4, life: 0.9, size: 6, grow: 1, tint: [0.6, 0.6, 0.6] });
  },
  roots: (fx, p) => {
    fx.emit('Root3', p, { count: 10, spread: 3.5, up: 1.5, life: 1.6, size: 7.5, tint: [1.3, 1.4, 1.1] });
    fx.emit('vinesp501', p, { count: 6, spread: 3.5, up: 0.8, life: 1.8, size: 6, tint: [1.3, 1.4, 1.1] });
  },
  gate: (fx, p) => {
    fx.emit('runecircle00', p.clone().add(new THREE.Vector3(0, 0.6, 0)), { life: 0.9, size: 14, grow: 0.4, tint: [0.6, 0.8, 1] });
    fx.emit('blueringa', p, { count: 5, spread: 1, up: 9, life: 0.8, size: 8, loop: true });
    fx.emit('glyphsp501', p, { count: 8, spread: 4, up: 5, life: 1, size: 2.5, loop: true, tint: [0.7, 0.85, 1] });
  },
  invis: (fx, p) => fx.emit('Ether2', p, { count: 2, spread: 3.5, up: 1, life: 0.8, size: 4.5, loop: true, tint: [0.9, 1.1, 1.3] }),
  lightning: (fx, p) => {
    for (let k = 0; k < 8; k++) fx.emit('lightningsp601', p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 3 + k * 5, 0)), { life: 0.5, size: 15, loop: true, fps: 24, tint: [1.4, 1.4, 1.8] });
    fx.emit('ElectricA', p, { count: 14, spread: 3, speed: 10, life: 0.6, size: 6, tint: [1.3, 1.3, 1.6] });
    fx.emit('flare_whsp501', p, { life: 0.3, size: 30, tint: [0.8, 0.9, 1.2] });
  },
  snareHit: (fx, p) => fx.emit('vinesp501', p, { count: 3, spread: 2, life: 0.6, size: 3.5 }),
  dizzy: (fx, p) => fx.emit('StarA', p, { spread: 1.5, up: 1, life: 0.5, size: 1.6, loop: true }),
  gemSparkle: (fx, p) => fx.emit('glittersp502', p, { spread: 2.2, up: 1, life: 0.6, size: 1.6, tint: [1, 0.7, 0.8] }),
  pickup: (fx, p) => fx.emit('8starsp501', p, { count: 8, spread: 1, speed: 9, life: 0.5, size: 2.5, tint: [1, 0.6, 0.7] }),
  driftSpark: (fx, p, colour) => fx.emit('8starsp501', p, { spread: 0.4, speed: 3, up: 2, life: 0.25, size: 1.4, tint: colour }),
  turbo: (fx, p) => fx.emit('flamesp501', p, { spread: 0.4, up: 1, life: 0.25, size: 2.6, tint: [0.6, 0.8, 1] }),
};
