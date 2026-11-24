// Loads an exported EQ zone: visible geometry with EQ's baked vertex lighting, plus a
// collision mesh with a BVH for fast raycasts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

// per-zone look: background/fog colour and how strongly the baked light is applied
// Each zone's own header, as the server sends it to the client (tracks/zone_headers.json):
// which sky set of sky.wld it shows (0 = none: the horizon is the fog colour), its fog
// colour and the distances the fog runs between.
export const ZONE_HEADER = {
  'templeveeshan.glb': { sky: 0, fog: [60, 10, 10], fogClip: [30, 300], clip: [100, 1200] },
  'kael.glb': { sky: 0, fog: [10, 10, 50], fogClip: [20, 500], clip: [300, 600] },
  'gfaydark.glb': { sky: 0, fog: [230, 255, 200], fogClip: [10, 500], clip: [250, 750] },
  'oasis.glb': { sky: 2, fog: [250, 250, 180], fogClip: [10, 800], clip: [600, 1800] },
  'everfrost.glb': { sky: 0, fog: [90, 115, 135], fogClip: [10, 1400], clip: [300, 1800] },
  'nektulos.glb': { sky: 0, fog: [80, 90, 70], fogClip: [10, 500], clip: [200, 750] },
  'lavastorm.glb': { sky: 1, fog: [255, 50, 10], fogClip: [10, 800], clip: [600, 1400] },
  'fearplane.glb': { sky: 5, fog: [255, 50, 10], fogClip: [10, 1000], clip: [800, 1400] },
  'hateplane.glb': { sky: 0, fog: [128, 128, 128], fogClip: [30, 200], clip: [200, 200] },
  'growthplane.glb': { sky: 0, fog: [0, 50, 100], fogClip: [60, 1200], clip: [300, 1200] },
  'mischiefplane.glb': { sky: 0, fog: [210, 235, 210], fogClip: [60, 600], clip: [300, 800] },
  'unrest.glb': { sky: 1, fog: [70, 70, 90], fogClip: [10, 500], clip: [200, 800] },        // estimated: no header on record
  'veeshan.glb': { sky: 0, fog: [50, 0, 0], fogClip: [100, 1200], clip: [50, 1200] },
  'butcher.glb': { sky: 1, fog: [200, 220, 235], fogClip: [10, 900], clip: [500, 1600] },   // estimated: no header on record
  'northkarana.glb': { sky: 1, fog: [200, 220, 235], fogClip: [10, 1000], clip: [600, 1800] },   // estimated: no header on record
  'ecommons.glb': { sky: 1, fog: [210, 215, 200], fogClip: [10, 1000], clip: [600, 1800] },   // estimated: no header on record
  'erudsxing.glb': { sky: 1, fog: [190, 215, 235], fogClip: [10, 1400], clip: [600, 2000] },   // estimated: open sea, no header on record
};
// sky.wld's sets (LAYER<n>1 and LAYER<n>3): the sky layer, the cloud layer, and how many times
// each texture repeats across the dome - EverQuest projects them flat from above. Sky 0 is no
// dome at all: the zone's fog colour is the sky (Greater Faydark, Everfrost, Nektulos, Growth).
const SKY_SETS = {
  1: ['normalsky', 'normalcloud', 8.4, 9.2], 2: ['desertsky', 'desertcloud', 4.2, 4.6],
  3: ['normalsky', 'normalcloud', 4.6, 4.6], 4: ['cottonysky', 'fluffycloud', 4.2, 4.6], 5: ['redcloud', 'redcloud', 5.0, 5.0],
};
// What the header does not carry: how bright the baked light is drawn (display brightness,
// as EQ's own values are), whether the zone is under the open sky (it shows its sky set; 0
// and 1 are the default sky), and the hour a race starts at. Nektulos is played at night,
// where it stays. Plane of Mischief is a forest under a canopy: its fog colour, dimmed.
export const ZONE_LOOK = {
  'templeveeshan.glb': { ambient: 0.32, gain: 1.6 },
  'kael.glb': { ambient: 0.40, gain: 1.8 },
  'gfaydark.glb': { ambient: 0.45, gain: 1.4, open: true, hour: 9 },
  'oasis.glb': { ambient: 0.5, gain: 1.4, open: true, hour: 10 },
  'everfrost.glb': { ambient: 0.5, gain: 1.3, open: true, hour: 8 },
  'nektulos.glb': { ambient: 0.3, gain: 1.4, open: true, hour: 23, lockHour: true },
  'lavastorm.glb': { ambient: 0.45, gain: 1.5, open: true, hour: 16 },
  'fearplane.glb': { ambient: 0.45, gain: 1.5, open: true, hour: 14 },
  'hateplane.glb': { ambient: 0.4, gain: 1.6 },
  'growthplane.glb': { ambient: 0.5, gain: 1.4, open: true, hour: 11 },
  'mischiefplane.glb': { ambient: 0.3, gain: 1.5, fogDim: 0.5 },     // under the canopy: no open sky
  'unrest.glb': { ambient: 0.34, gain: 1.5, open: true, hour: 18, lockHour: true },    // a haunted estate at dusk
  'veeshan.glb': { ambient: 0.36, gain: 1.6 },
  'butcher.glb': { ambient: 0.45, gain: 1.4, open: true, hour: 10 },
  'northkarana.glb': { ambient: 0.45, gain: 1.4, open: true, hour: 12 },
  'erudsxing.glb': { ambient: 0.6, gain: 1.6, open: true, hour: 11 },   // a bright open sea: its baked light is dim
  'ecommons.glb': { ambient: 0.45, gain: 1.4, open: true, hour: 14 },
};
const FOG_MIN = 260;        // the fog's far edge at least this far: a kart covers 200 units in under 3 s
export const DAY_MINUTES = 12;   // one full day and night, in minutes of racing

function zoneLook(file) {
  const look = { ambient: 0.4, gain: 1.5, ...(ZONE_LOOK[file] || {}) };
  const h = ZONE_HEADER[file] || { sky: 0, fog: [0, 0, 0], fogClip: [10, 800] };
  look.fogRgb = h.fog.map((v) => (v / 255) * (look.fogDim ?? 1));
  look.sky = new THREE.Color().setRGB(...look.fogRgb, THREE.SRGBColorSpace).getHex();
  look.fog = [look.sky, h.fogClip[0], Math.max(FOG_MIN, h.fogClip[1])];
  look.far = Math.max(look.fog[2] + 40, h.clip?.[1] ?? 2000);   // view distance: the zone's far clip
  look.outdoor = !!look.open;
  const set = SKY_SETS[h.sky] || null;                 // (the zone's own header; 0: no dome)
  if (look.outdoor) look.dome = { set, hour: look.hour ?? 10, lockHour: !!look.lockHour, horizon: look.fogRgb };
  return look;
}

export async function loadZone(file, params) {
  const look = zoneLook(file);
  if (params.has('amb')) look.ambient = parseFloat(params.get('amb'));
  if (params.has('gain')) look.gain = parseFloat(params.get('gain'));
  const gltf = await new GLTFLoader().loadAsync(`zones/${file}`);
  const visual = new THREE.Group();
  const mats = [];
  let collider = null;
  const animated = [];                           // EQ's animated textures: fire, lava, water
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.startsWith('collision') || o.parent?.name === 'collision') {
      collider = o;
      return;
    }
    const src = o.material;
    const mat = new THREE.MeshBasicMaterial({
      map: src.map,
      vertexColors: true,
      transparent: src.transparent,
      opacity: src.opacity,
      alphaTest: src.alphaTest,
      alphaToCoverage: src.alphaTest > 0,        // leaves and railings: smooth cut-out edges (with MSAA)
      side: src.side,
      depthWrite: !src.transparent,
    });
    if (mat.map) {
      mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.map.anisotropy = 8;
    }
    // baked light: colour = ambient + vertex colour * gain (EQ's values are dim)
    const c = o.geometry.getAttribute('color');
    if (c) {
      const out = new Float32Array(c.count * 3);
      const sh = 1;
      // EQ's light values are display brightness (gamma space): convert, or 0.45 shows as 0.7
      const lin = (v) => Math.pow(Math.min(1, v), 2.2);
      for (let i = 0; i < c.count; i++) {
        out[i * 3] = lin(look.ambient + c.getX(i) * look.gain) * sh;
        out[i * 3 + 1] = lin(look.ambient + c.getY(i) * look.gain) * sh;
        out[i * 3 + 2] = lin(look.ambient + c.getZ(i) * look.gain) * sh;
      }
      o.geometry.setAttribute('color', new THREE.BufferAttribute(out, 3));
    }
    o.material = mat;
    mats.push(mat);
    if (src.userData?.eqFrames) animated.push({ mat, idx: src.userData.eqFrames, sleep: src.userData.eqSleep / 1000 });
    visual.add(o.clone());
  });
  if (!collider) throw new Error('zone has no collision mesh');
  collider.geometry.boundsTree = new MeshBVH(collider.geometry);
  collider.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  collider.visible = false;
  collider.updateMatrixWorld(true);
  for (const a of animated) {
    a.frames = await Promise.all(a.idx.map((i) => gltf.parser.getDependency('texture', i)));
    for (const t of a.frames) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    a.t = Math.random() * a.sleep * a.frames.length;
  }
  const animate = (dt) => {
    for (const a of animated) {
      a.t += dt;
      const f = a.frames[Math.floor(a.t / a.sleep) % a.frames.length];
      if (a.mat.map !== f) { a.mat.map = f; }
    }
  };
  // the time of day dims the whole zone (its light is baked): 1 = noon
  const setLight = (l) => { for (const m of mats) m.color.setScalar(Math.pow(l, 2.2)); };   // l: display brightness
  return { visual, collider, look, setLight, animate };
}

// Merge extra solid geometry (world space) into the zone collider and rebuild its BVH.
export function addToCollider(collider, extra) {
  if (!extra) return;
  const inv = collider.matrixWorld.clone().invert();
  const a = collider.geometry, b = extra.clone().applyMatrix4(inv);
  const pa = a.getAttribute('position'), pb = b.getAttribute('position');
  const pos = new Float32Array((pa.count + pb.count) * 3);
  pos.set(pa.array.subarray(0, pa.count * 3), 0);
  pos.set(pb.array.subarray(0, pb.count * 3), pa.count * 3);
  const ia = a.index ? Array.from(a.index.array) : Array.from({ length: pa.count }, (_, i) => i);
  const ib = Array.from(b.index.array, (i) => i + pa.count);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(ia.concat(ib));
  g.boundsTree = new MeshBVH(g);
  collider.geometry = g;
}

// Raycast helper against the collision mesh.
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
export function cast(collider, origin, dir, far) {
  ray.set(origin, dir);
  ray.far = far;
  const hit = ray.intersectObject(collider, false)[0];
  return hit || null;
}

// EQ's outdoor sky: the zone's sky set from sky.s3d (a sky layer and a cloud layer), with the
// sun and the moon crossing it through a day and a night. The dome follows the camera.
// `light` (0.3 at night .. 1 at noon) is what the zone, the fog and the karts are dimmed by.
export function makeSky(spec = {}) {
  const tl = new THREE.TextureLoader();
  const dome = new THREE.Group();
  // a layer: the texture projected flat from above across the dome, `tiles` times edge to edge
  // (as EverQuest's sky meshes are mapped), so the clouds shrink into the distance at the horizon
  const layer = (file, radius, tiles, opacity) => {
    const tex = tl.load(`sky/${file}.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const geo = new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) / radius) * tiles / 2, (pos.getZ(k) / radius) * tiles / 2);
    geo.scale(1, 0.28, 1);                                   // a shallow dome, as EverQuest's (its rim just below the eye)
    const m = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false,
        transparent: opacity < 1, opacity, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.renderOrder = -10;
    dome.add(m);
    return m;
  };
  const set = spec.set;                                   // null: no dome (the fog colour is the sky)
  const sky = set && layer(set[0], 5000, set[2], 1);
  const clouds = set && layer(set[1], 4800, set[3], 0.55);
  const body = (file, size) => {
    const tex = tl.load(`sky/${file}.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false,
      blending: THREE.AdditiveBlending, transparent: true }));
    sp.scale.setScalar(size);
    sp.renderOrder = -9;
    dome.add(sp);
    return sp;
  };
  const sun = body('sun', 520), moon = body('moon', 420);
  sun.visible = moon.visible = !!set;
  // an overcast over it all in rain or snow (dome.userData.overcast 0 .. 1): a grey sky, the sun hidden
  const cover = new THREE.Mesh(new THREE.SphereGeometry(4600, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.28, 1),
    new THREE.MeshBasicMaterial({ color: 0x8a8f96, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  cover.renderOrder = -8.5;
  cover.visible = false;
  dome.add(cover);
  // the fog colour rises from the horizon, as the zone's fog does over distance
  const band = new THREE.Mesh(new THREE.CylinderGeometry(4700, 4700, 1500, 32, 1, true),
    new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      uniforms: { c: { value: new THREE.Color(...(spec.horizon || [1, 1, 1])) } },
      vertexShader: 'varying float h; void main(){ h = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 c; varying float h; void main(){ gl_FragColor = vec4(c, pow(1.0 - h, 1.6) * 0.9); }' }));
  band.position.y = 600;
  band.renderOrder = -8;
  band.visible = !!set;
  dome.add(band);
  let hour = spec.hour ?? 10;
  const DAY = new THREE.Color(1, 1, 1), DUSK = new THREE.Color(1.0, 0.55, 0.38), NIGHT = new THREE.Color(0.07, 0.09, 0.2);
  const tint = new THREE.Color();
  dome.userData.light = 1;
  dome.userData.update = (cam, dt, minutesPerDay = 12) => {
    if (!spec.lockHour) hour = (hour + dt * 24 / (minutesPerDay * 60)) % 24;
    dome.userData.hour = hour;
    // sun height: -1 midnight .. 1 noon
    const s = Math.sin((hour - 6) / 24 * Math.PI * 2);
    const day = THREE.MathUtils.smoothstep(s, -0.12, 0.25);              // 0 night .. 1 day
    const dusk = Math.max(0, 1 - Math.abs(s) / 0.22);                    // near the horizon
    tint.copy(NIGHT).lerp(DAY, day).lerp(DUSK, dusk * 0.6);
    const oc = dome.userData.overcast || 0;                             // rain or snow: a grey sky
    cover.visible = !!set && oc > 0;
    cover.material.opacity = Math.min(0.92, oc);
    cover.material.color.setRGB(0.54, 0.57, 0.61).multiplyScalar(0.35 + 0.65 * day);
    if (set) {
      sky.material.color.copy(tint);
      clouds.material.color.copy(tint);
      clouds.material.opacity = 0.2 + 0.35 * day;
      clouds.material.map.offset.x += dt * 0.004;
    }
    const a = (hour - 6) / 24 * Math.PI * 2;                             // east -> overhead -> west
    sun.position.set(Math.cos(a) * 3900, Math.sin(a) * 3300 + 200, -1400);
    moon.position.set(-Math.cos(a) * 3700, -Math.sin(a) * 3100 + 200, -1700);
    sun.visible = !!set && sun.position.y > -100;
    moon.visible = !!set && moon.position.y > -100;
    const light = 0.3 + 0.7 * day;
    dome.userData.light = light;
    band.material.uniforms.c.value.setRGB(...(spec.horizon || [1, 1, 1])).multiplyScalar(light).lerp(DUSK, dusk * 0.35);
    dome.position.copy(cam.position);
  };
  return dome;
}
