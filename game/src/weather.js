// EverQuest's weather, by zone: rain where it rains in Norrath (thin falling streaks, EverQuest's
// own splash rings on the ground, a grey sky, the fog closing in, now and then lightning and
// thunder) and snow in the north (EverQuest's own snowflake, drifting). Each race rolls its own
// weather (the Weather option: changing, always, or clear).
import * as THREE from 'three';

// which zones have which weather (desert, the planes, dungeons and Lavastorm: none)
export const ZONE_WEATHER = {
  'gfaydark.glb': 'rain', 'nektulos.glb': 'rain', 'unrest.glb': 'rain', 'butcher.glb': 'rain',
  'northkarana.glb': 'rain', 'ecommons.glb': 'rain', 'growthplane.glb': 'rain', 'everfrost.glb': 'snow',
};
const CHANCE = { rain: 0.35, snow: 0.55 };

// this race's weather: { kind, strength } or null
export function rollWeather(zoneFile, mode = 'random', force = null) {
  const kind = force || ZONE_WEATHER[zoneFile];
  if (!kind || mode === 'clear') return null;
  if (!force && mode !== 'always' && Math.random() > CHANCE[kind]) return null;
  return { kind, strength: mode === 'always' || force ? 0.9 : 0.5 + Math.random() * 0.5 };
}

const BOX = { x: 140, y: 90, z: 140 };            // the weather falls in this box round the camera

export class Weather {
  // ground(x, y, z) -> the height of the ground under a point (for the splash rings), or null
  constructor(scene, { kind, strength }, { ground, thunder } = {}) {
    this.kind = kind;
    this.strength = strength;
    this.ground = ground;
    this.thunder = thunder;
    this.light = kind === 'rain' ? 1 - 0.28 * strength : 1 - 0.1 * strength;   // how much it dims the day
    this.flash = 0;
    this.nextBolt = 6 + Math.random() * 10;
    this.group = new THREE.Group();
    this.group.renderOrder = 5;
    scene.add(this.group);
    const tl = new THREE.TextureLoader();
    if (kind === 'rain') {
      // streaks: a short line each, falling fast and a little slanted
      const n = Math.round(2600 * strength);
      this.pos = new Float32Array(n * 6);
      this.drops = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * BOX.x, y: (Math.random() - 0.5) * BOX.y,
        z: (Math.random() - 0.5) * BOX.z, v: 150 + Math.random() * 40 }));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.streaks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true,
        opacity: 0.32 + 0.2 * strength, depthWrite: false, fog: true }));
      this.streaks.frustumCulled = false;
      this.group.add(this.streaks);
      // EverQuest's splash ring, opening and fading where a drop lands near you
      const ringTex = tl.load('fx/weather_rainring.png');
      ringTex.colorSpace = THREE.SRGBColorSpace;
      this.rings = Array.from({ length: Math.round(70 * strength) }, () => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
          map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        m.visible = false;
        this.group.add(m);
        return { m, t: Math.random() * 0.5, life: 0.45 };
      });
    } else {
      // flakes: EverQuest's snowflake, drifting down and swaying
      const n = Math.round(1800 * strength);
      this.pos = new Float32Array(n * 3);
      this.drops = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * BOX.x, y: (Math.random() - 0.5) * BOX.y,
        z: (Math.random() - 0.5) * BOX.z, v: 7 + Math.random() * 6, ph: Math.random() * 6.28 }));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      const tex = tl.load('fx/weather_snowflake.png');
      tex.colorSpace = THREE.SRGBColorSpace;
      this.flakes = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size: 1.1, sizeAttenuation: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85, fog: true }));
      this.flakes.frustumCulled = false;
      this.group.add(this.flakes);
    }
  }

  // the fog and sky under this weather: greyer and closer in the rain, whiter in the snow
  dress(scene, fogBase, sky) {
    const s = this.strength;
    const grey = this.kind === 'rain' ? new THREE.Color(0.42, 0.45, 0.5) : new THREE.Color(0.85, 0.88, 0.92);
    fogBase.lerp(grey, (this.kind === 'rain' ? 0.55 : 0.4) * s);
    scene.fog.near *= 1 - 0.5 * s;
    scene.fog.far = Math.max(220, scene.fog.far * (1 - (this.kind === 'rain' ? 0.4 : 0.3) * s));
    if (sky) sky.userData.overcast = (this.kind === 'rain' ? 0.95 : 0.6) * s;
  }

  update(dt, camera) {
    const c = camera.position, d = this.drops, p = this.pos;
    const wrap = (v, size) => ((v + size / 2) % size + size) % size - size / 2;
    if (this.kind === 'rain') {
      for (let k = 0; k < d.length; k++) {
        const q = d[k];
        q.y -= q.v * dt;
        if (q.y < -BOX.y / 2) q.y += BOX.y;
        const x = c.x + wrap(q.x - c.x, BOX.x), z = c.z + wrap(q.z - c.z, BOX.z), y = c.y + q.y;
        q.x = x; q.z = z;
        p.set([x, y, z, x + 0.25, y + 3.2, z + 0.1], k * 6);
      }
      this.streaks.geometry.attributes.position.needsUpdate = true;
      for (const r of this.rings) {
        r.t += dt;
        if (r.t >= r.life) {                        // a new drop lands somewhere near
          r.t = 0;
          const a = Math.random() * Math.PI * 2, rr = 4 + Math.random() * 40;
          const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
          const y = this.ground?.(x, c.y + 20, z);
          r.m.visible = y != null;
          if (y != null) r.m.position.set(x, y + 0.15, z);
        }
        const f = r.t / r.life;
        r.m.scale.setScalar(0.4 + 1.6 * f);
        r.m.material.opacity = 0.55 * (1 - f);
      }
      // lightning in a heavy storm: the sky flashes white, the thunder follows
      if (this.strength > 0.7 && (this.nextBolt -= dt) <= 0) {
        this.nextBolt = 8 + Math.random() * 14;
        this.flash = 0.35;
        setTimeout(() => this.thunder?.(), 300 + Math.random() * 1200);
      }
    } else {
      const t = performance.now() / 1000;
      for (let k = 0; k < d.length; k++) {
        const q = d[k];
        q.y -= q.v * dt;
        if (q.y < -BOX.y / 2) q.y += BOX.y;
        const x = c.x + wrap(q.x - c.x + Math.sin(t * 0.8 + q.ph) * 0.02, BOX.x), z = c.z + wrap(q.z - c.z, BOX.z);
        q.x = x; q.z = z;
        p.set([x + Math.sin(t + q.ph) * 0.8, c.y + q.y, z + Math.cos(t * 0.7 + q.ph) * 0.8], k * 3);
      }
      this.flakes.geometry.attributes.position.needsUpdate = true;
    }
    this.flash = Math.max(0, this.flash - dt);
  }

  // the day's light under the weather (a lightning flash lights everything for a moment)
  get lightNow() { return this.light + (this.flash > 0.2 || (this.flash > 0 && this.flash < 0.1) ? 0.9 : 0); }
}
