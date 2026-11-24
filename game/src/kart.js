// Arcade kart: heading + sliding velocity, drift with mini-turbo, ground following with
// step-up, wall bounce, gravity.
import * as THREE from 'three';
import { cast } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export const TUNING = {
  accel: 72, maxSpeed: 80, reverseMax: 24, brake: 120, coast: 16,
  turnRate: 2.2, steerResponse: 10, grip: 9, driftGrip: 2.4,
  driftTurnOut: 1.15, driftTurnIn: 2.8, hop: 16, turboScale: 1.28,
  turbo1: [0.9, 0.7], turbo2: [2.0, 1.3],          // [charge needed, boost seconds]
  gravity: 150, stepUp: 7, snapDown: 9, radius: 3.2, height: 7.5,  // walls checked above step height
  speedClass: 1,                                    // the race's engine class (settings.js SPEED_CLASSES)
};

// Convention: yaw 0 faces -z; increasing yaw turns RIGHT (towards +x when facing -z).
export class Kart {
  constructor(color, name) {
    this.name = name;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();   // horizontal velocity; the kart can slide sideways
    this.yaw = 0;
    this.vy = 0;
    this.onGround = false;
    this.maxSpeedScale = 1;
    this.input = { throttle: 0, steer: 0, drift: false };
    this.steerS = 0;                   // smoothed steering
    this.drifting = false;
    this.driftDir = 0;
    this.charge = 0;
    this.turbo = 0;
    this.groundNormal = UP.clone();
    this.mesh = makeKartMesh(color);
    this.sparks = makeSparks();
    this.mesh.add(this.sparks);
    this.progress = 0;                 // path index
    this.lap = 0;
    this.finished = false;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  // forward speed (used by AI, items, HUD); setting it keeps a little of any sideways slide
  get speed() { return this.vel.dot(this.forward()); }
  set speed(v) {
    const f = this.forward();
    const lat = this.vel.clone().addScaledVector(f, -this.vel.dot(f));
    this.vel.copy(f).multiplyScalar(v).addScaledVector(lat, 0.5);
  }

  update(dt, collider) {
    const T = TUNING;
    const { throttle, steer, drift } = this.input;
    this.steerS += (steer - this.steerS) * Math.min(1, T.steerResponse * dt);
    let along = this.speed;

    // drift: hop in while steering at speed, release for a mini-turbo. The press is remembered
    // for a moment (and while held), so pressing just before steering, or over a crest, still works.
    if (drift && !this.driftHeld) this.driftBuffer = 0.35;
    this.driftBuffer = Math.max(0, (this.driftBuffer || 0) - dt);
    if (drift && !this.drifting && (this.driftBuffer > 0 || this.driftWanted) && this.onGround && along > 30 && Math.abs(steer) > 0.2) {
      this.drifting = true;
      this.driftDir = Math.sign(steer);
      this.charge = 0;
      this.vy = T.hop;
      this.onGround = false;
    }
    this.driftHeld = drift;
    this.driftWanted = drift && !this.drifting && !this.driftDone;   // held, not drifted yet this press
    if (this.drifting) this.driftDone = true;
    if (!drift) this.driftDone = false;
    if (this.drifting && (!drift || along < 20)) {
      if (this.charge >= T.turbo2[0]) this.turbo = T.turbo2[1];
      else if (this.charge >= T.turbo1[0]) this.turbo = T.turbo1[1];
      this.drifting = false;
    }

    // turning
    let rate;
    if (this.drifting) {
      const inward = this.steerS * this.driftDir;                     // -1 steer out .. 1 steer in
      rate = this.driftDir * THREE.MathUtils.lerp(T.driftTurnOut, T.driftTurnIn, (inward + 1) / 2);
      this.charge += dt * (0.7 + 0.7 * Math.max(0, inward));
    } else {
      // turning needs a little speed - or the gas pressed, so you can always steer away from a wall
      const low = THREE.MathUtils.clamp(Math.max(Math.abs(along), Math.abs(throttle) * 14) / 22, 0, 1);
      const high = 1 - 0.25 * THREE.MathUtils.clamp((Math.abs(along) - 45) / 35, 0, 1);
      rate = this.steerS * T.turnRate * low * high * (along < -1 || (Math.abs(along) <= 1 && throttle < 0) ? -1 : 1);
    }
    this.yaw += rate * dt;

    // engine, brakes, turbo - along the new heading; sideways slide decays with grip
    const f = this.forward();
    along = this.vel.dot(f);
    const lat = this.vel.clone().addScaledVector(f, -along);
    // off the track the ground slows you (a boost carries you over it)
    const rough = this.offRoad && !(this.turbo > 0 || this.boost > 0) ? 0.6 : 1;
    const max = T.maxSpeed * T.speedClass * this.maxSpeedScale * (this.effectScale ?? 1) * (this.turbo > 0 ? T.turboScale : 1) * rough;
    if (this.turbo > 0) { this.turbo -= dt; along = Math.max(along, max * 0.97); }
    if (throttle > 0) along += T.accel * T.speedClass * (this.accelScale ?? 1) * throttle * dt * Math.max(0, 1 - Math.max(0, along) / max) ** 0.6;
    else if (throttle < 0) along -= (along > 0 ? T.brake : T.accel * 0.6) * -throttle * dt;
    else along -= Math.sign(along) * Math.min(Math.abs(along), T.coast * dt);
    if (along > max) along -= (along - max) * Math.min(1, 2 * dt);
    along = Math.max(along, -T.reverseMax);
    lat.multiplyScalar(Math.exp(-(this.drifting ? T.driftGrip : T.grip) * dt));
    this.vel.copy(f).multiplyScalar(along).add(lat);

    // horizontal move: slide along walls with a small bounce
    const move = this.vel.clone().multiplyScalar(dt);
    for (let pass = 0; pass < 2 && move.lengthSq() > 1e-8; pass++) {
      const len = move.length();
      const dir = move.clone().divideScalar(len);
      const origin = this.pos.clone().addScaledVector(UP, T.height);
      const hit = cast(collider, origin, dir, len + T.radius);
      if (!hit) break;
      const n = hit.face.normal.clone().transformDirection(collider.matrixWorld);
      if (Math.abs(n.y) > 0.65) break;                       // a slope (<= ~50 deg), not a wall
      n.y = 0;
      n.normalize();
      if (n.dot(dir) > 0) n.negate();
      const into = move.dot(n);
      if (into >= 0) break;
      move.addScaledVector(n, -into);
      const vin = this.vel.dot(n);
      this.vel.addScaledVector(n, -vin * 1.3);               // bounce a little off the wall
      this.vel.multiplyScalar(1 - 0.35 * Math.min(1, -into / len));
      if (this.drifting && -into / len > 0.5) this.drifting = false;
    }
    this.pos.add(move);
    this.pushOutOfWalls(collider);

    // vertical: snap to ground or fall
    const top = this.pos.clone().addScaledVector(UP, T.stepUp);
    let g = cast(collider, top, DOWN, T.stepUp + T.snapDown + Math.max(0, -this.vy * dt));
    if (g) {                                   // too steep to stand on: slide off it instead
      const gn = g.face.normal.clone().transformDirection(collider.matrixWorld);
      if (Math.abs(gn.y) < 0.65) g = null;
    }
    if (g && this.vy <= 0 && g.point.y >= this.pos.y - (this.onGround ? T.snapDown : -this.vy * dt + 0.5)) {
      this.pos.y = g.point.y;
      this.vy = 0;
      this.onGround = true;
      this.groundNormal.copy(g.face.normal).transformDirection(collider.matrixWorld);
      if (this.groundNormal.y < 0) this.groundNormal.negate();
    } else {
      this.onGround = false;
      this.vy -= T.gravity * dt;
      this.pos.y += this.vy * dt;
      this.groundNormal.lerp(UP, 0.1);
    }
    this.syncMesh();
  }

  pushOutOfWalls(collider) {
    const T = TUNING;
    const origin = this.pos.clone().addScaledVector(UP, T.height);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const hit = cast(collider, origin, dir, T.radius);
      if (!hit) continue;
      const n = hit.face.normal.clone().transformDirection(collider.matrixWorld);
      if (Math.abs(n.y) > 0.65) continue;
      this.pos.addScaledVector(dir, -(T.radius - hit.distance));
    }
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    // three.js rotates counter-clockwise for positive angles, our yaw turns clockwise
    const bodyYaw = this.yaw + (this.drifting ? this.driftDir * 0.38 : 0);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, -bodyYaw);
    const tilt = new THREE.Quaternion().setFromUnitVectors(UP, this.groundNormal);
    this.mesh.quaternion.copy(tilt.multiply(q));
    this.sparks.visible = false;                        // drift sparks are EQ particles now (main.js)
    if (this.sparks.visible) {
      const c = this.charge >= TUNING.turbo2[0] ? 0xff8a20 : this.charge >= TUNING.turbo1[0] ? 0x4aa8ff : 0xfff2c0;
      for (const s of this.sparks.children) {
        s.material.color.setHex(c);
        s.scale.setScalar(0.6 + Math.random() * 0.8);
      }
    }
  }

  place(p, yaw) {
    this.pos.set(p[0], p[1], p[2]);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.drifting = false;
    this.turbo = 0;
    this.syncMesh();
  }
}

function makeSparks() {
  const g = new THREE.Group();
  for (const x of [-2.2, 2.2]) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0),
      new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.9 }));
    s.material.userData.fixedOpacity = true;
    s.position.set(x, 0.6, 3.2);
    g.add(s);
  }
  g.visible = false;
  return g;
}

// shared kart materials (EQ textures from the zones, see tools/export_drivers.py)
const KTL = new THREE.TextureLoader();
const kartTex = (name, rx = 1, ry = 1) => {
  const t = KTL.load(`kart/${name}.jpg`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
};
let KM = null;
function kartMaterials() {
  KM ??= {
    wood: new THREE.MeshLambertMaterial({ map: kartTex('wood', 1, 2) }),
    woodDark: new THREE.MeshLambertMaterial({ map: kartTex('wood', 1, 1), color: 0x8a6a50 }),
    metal: new THREE.MeshLambertMaterial({ map: kartTex('metal'), color: 0x9a9aa6 }),
    gold: new THREE.MeshLambertMaterial({ color: 0xc8a040, emissive: 0x2a1c00 }),
    leather: new THREE.MeshLambertMaterial({ color: 0x3a2416 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    banners: [0, 1, 2, 3, 4].map((i) => new THREE.MeshLambertMaterial({ map: kartTex(`banner${i}`), side: THREE.DoubleSide })),
  };
  return KM;
}

let kartCount = 0;
function makeKartMesh(color) {
  // original design: a low war-cart. Plank hull, iron bands and ram, gold trim, spoked
  // iron-rimmed wheels, a lantern, and an EQ banner on a pole at the back.
  const M = kartMaterials();
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };
  // hull: tapered tub (lathe of a trapezoid would be overkill; a scaled box + prow does it)
  const hull = new THREE.BoxGeometry(3.8, 1.3, 6.6, 1, 1, 3);
  const pos = hull.attributes.position;
  for (let i = 0; i < pos.count; i++) {              // narrow the front, flare the top
    const z = pos.getZ(i), y = pos.getY(i);
    const front = THREE.MathUtils.clamp((-z - 1) / 2.3, 0, 1);
    pos.setX(i, pos.getX(i) * (1 - 0.35 * front) * (y > 0 ? 1.08 : 0.92));
  }
  hull.computeVertexNormals();
  add(hull, M.wood, 0, 1.45, 0.2);
  add(new THREE.BoxGeometry(3.2, 0.35, 6.2), M.woodDark, 0, 0.75, 0.2);                 // floor
  for (const z of [-1.9, 0.6, 2.9]) add(new THREE.BoxGeometry(4.15, 0.28, 0.32), M.metal, 0, 1.95, z);   // iron bands
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.18, 0.22, 5.2), M.gold, sx * 2.08, 2.12, 0.6);          // gold rail trim
    const stripe = new THREE.MeshLambertMaterial({ color });
    add(new THREE.BoxGeometry(0.12, 0.55, 3.6), stripe, sx * 2.06, 1.45, 0.9);          // racer colours
  }
  // prow + ram
  add(new THREE.ConeGeometry(1.25, 2.4, 4, 1), M.wood, 0, 1.4, -3.6, -Math.PI / 2, Math.PI / 4, 0);
  add(new THREE.ConeGeometry(0.55, 1.6, 6, 1), M.metal, 0, 1.05, -4.7, -Math.PI / 2, 0, 0);
  add(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color }), 0, 2.3, -3.2);   // gem
  add(new THREE.BoxGeometry(2.6, 1.0, 0.25), M.woodDark, 0, 2.2, 3.4);                   // back board
  add(new THREE.BoxGeometry(2.4, 0.35, 1.7), M.leather, 0, 1.3, 1.3);                    // seat, low in the tub
  add(new THREE.BoxGeometry(2.4, 1.4, 0.35), M.leather, 0, 2.0, 2.2, -0.2);              // backrest
  // steering wheel on a column from the floor: seatDriver moves it to the driver's hands
  const steer = new THREE.Group();
  const rimGeo = new THREE.TorusGeometry(0.55, 0.075, 8, 24);
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(rimGeo, M.woodDark));
  for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.07, 1.0, 0.06), M.metal, 0, 0, 0, 0, 0, (k * Math.PI) / 3, wheel);
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 10).rotateX(Math.PI / 2), M.gold));
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1, 8), M.metal);
  steer.add(wheel, column);
  g.add(steer);
  g.userData.steer = { wheel, column };
  placeWheel(g.userData.steer, new THREE.Vector3(0, 2.75, -0.4));
  // lantern on a crook at the front
  add(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), M.metal, 1.5, 3.0, -2.6);
  add(new THREE.BoxGeometry(0.55, 0.65, 0.55), M.glow, 1.5, 4.1, -2.6);
  add(new THREE.ConeGeometry(0.45, 0.35, 4), M.metal, 1.5, 4.6, -2.6, 0, Math.PI / 4, 0);
  // banner pole + banner (one of the zones' real banners)
  add(new THREE.CylinderGeometry(0.09, 0.09, 6.4, 6), M.metal, -1.4, 4.6, 3.2);
  add(new THREE.SphereGeometry(0.22, 8, 6), M.gold, -1.4, 7.85, 3.2);
  const flagGeo = new THREE.PlaneGeometry(2.2, 2.8, 8, 4);
  const flag = add(flagGeo, M.banners[kartCount++ % M.banners.length], -1.4 - 0, 6.35, 4.3, 0, Math.PI / 2, 0);
  flag.userData.base = flagGeo.attributes.position.array.slice();
  g.userData.flag = flag;
  // wheels: iron rim, wooden spokes, gold hub; they spin with the kart's speed
  const rim = new THREE.TorusGeometry(1.05, 0.24, 8, 18);
  const spoke = new THREE.BoxGeometry(0.16, 1.9, 0.16);
  const hub = new THREE.CylinderGeometry(0.3, 0.3, 0.55, 10).rotateX(Math.PI / 2);
  g.userData.wheels = [];
  for (const [x, z, r] of [[-2.35, -2.2, 0.95], [2.35, -2.2, 0.95], [-2.45, 2.4, 1.1], [2.45, 2.4, 1.1]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(rim, M.metal));
    for (let k = 0; k < 4; k++) add(spoke, M.wood, 0, 0, 0, 0, 0, (k * Math.PI) / 4, w);
    w.add(new THREE.Mesh(hub, M.gold));
    w.scale.setScalar(r);
    w.position.set(x, 1.05 * r, z);
    w.rotation.y = Math.PI / 2;
    g.add(w);
    g.userData.wheels.push(w);
  }
  return g;
}

// per-frame cosmetics: wheel spin and banner ripple
export function animateKart(kart, dt, time) {
  const u = kart.mesh.userData;
  for (const w of u.wheels) w.rotation.x -= (kart.speed * dt) / 1.05;
  const f = u.flag;
  if (!f) return;
  const p = f.geometry.attributes.position, b = f.userData.base;
  const amp = 0.15 + Math.min(1, Math.abs(kart.speed) / 60) * 0.35;
  for (let i = 0; i < p.count; i++) {
    const x = b[i * 3];                                        // 0 at the pole, grows outward
    const d = (x + 1.1) / 2.2;
    p.setZ(i, Math.sin(time * 9 + x * 2.6) * amp * d);
  }
  p.needsUpdate = true;
}

// the steering wheel at `at` (kart space), its column down to the floor ahead, the rim facing the driver
function placeWheel({ wheel, column }, at) {
  const base = new THREE.Vector3(0, 0.95, Math.min(at.z - 1.1, -0.9));
  const dir = at.clone().sub(base);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  column.quaternion.copy(q);
  column.position.copy(base).addScaledVector(dir, len / 2);
  column.scale.set(1, len, 1);
  wheel.position.copy(at);
  wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);   // the rim square to its column
}

// EQ player races, seated, in their armor (exported from the client's classic global_chr.s3d)
const driverCache = {};
export async function seatDriver(kart, racer, info) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const file = `drivers/${racer.code}_${racer.armor}.glb`;
  driverCache[file] ??= new GLTFLoader().loadAsync(file);
  const gltf = await driverCache[file];
  const d = gltf.scene.clone(true);
  let seated = 3, hip = null, hands = null;
  d.traverse((o) => {
    if (o.userData?.height) { seated = o.userData.height; hip = o.userData.hip || null; hands = o.userData.hands || null; }
    if (!o.isMesh) return;
    const m = o.material;
    o.material = new THREE.MeshLambertMaterial({ map: m.map, alphaTest: m.alphaTest, side: THREE.DoubleSide });
    if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
  });
  if (hip) {
    // seated by the hips: on the seat, at its back; sized by the body above the hips (a human's
    // ~3.4 units). EverQuest's heights scale it, eased as kart racers do (an ogre still towers and
    // a gnome peers over the rim, but both fit the kart)
    const s = (3.4 * Math.pow((info?.height || 6) / 6, 0.6)) / Math.max(0.5, seated - hip[1]);
    d.scale.setScalar(s);
    d.position.set(-hip[0] * s, 1.5 - hip[1] * s, 1.7 - hip[2] * s);    // the hips on the low seat
    if (hands && kart.mesh.userData.steer) {          // the wheel in the driver's hands
      placeWheel(kart.mesh.userData.steer, new THREE.Vector3(hands[0], hands[1], hands[2]).multiplyScalar(s).add(d.position));
    }
  } else {                                           // (an older export without its hips)
    d.scale.setScalar((4.3 * (info?.height || 6) / 6) / seated);
    d.position.set(0, 2.0, 1.25);
  }
  kart.mesh.add(d);
  kart.racer = { ...racer, info };
}
