// The 3D showroom behind the menus: real karts with their seated EverQuest drivers.
//
//   row     a turning row of racers on a gentle arc, the selected one front and centre on a lit
//           turntable (character select; the title screen's attract mode)
//   single  one racer on the turntable, to one side (track select, campaign)
//   podium  the top three of a cup on the podium
//   empty   just the stage and its embers (options)
//
// Only the racers near the selection are built (an LRU of karts): the list can be any length.
import * as THREE from 'three';
import { Kart, seatDriver, animateKart } from '../kart.js';

const COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd4ac0d, 0x8e44ad, 0xe67e22, 0x16a085, 0xb03a2e];
const STEP = 0.34;              // radians between racers on the arc
const RADIUS = 34;              // the arc's radius (its centre is behind the turntable)
const WINDOW = 4;               // racers shown either side of the selected one
const KEEP = 40;                // karts kept built

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#0c0710');
  grd.addColorStop(0.55, '#1d0e0b');
  grd.addColorStop(0.85, '#3a160b');
  grd.addColorStop(1, '#4d1c0b');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(256, 256, 10, 256, 256, 256);
  grd.addColorStop(0, '#3b2414');
  grd.addColorStop(0.35, '#22140c');
  grd.addColorStop(1, '#0a0605');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(232,192,106,0.10)';             // faint rings, like a worn arena floor
  for (let r = 40; r < 256; r += 34) { g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Showroom {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = gradientTexture();
    this.scene.fog = new THREE.Fog(0x1a0c09, 40, 120);
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 400);
    this.items = [];             // [{ code, armor, info }]
    this.sel = 0;                // selected index
    this.pos = 0;                // the arc's animated position (eases to sel)
    this.karts = new Map();      // `${code}_${armor}` -> { kart, ready, used }
    this.mode = 'empty';
    this.spin = 0;               // the turntable's yaw
    this.side = 0;               // single mode: where the racer stands (-1 left .. 1 right)
    this.podium = [];
    this.t = 0;
    this.build();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  build() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xffe2c0, 0x2a1408, 0.9));
    const key = new THREE.SpotLight(0xffe7c2, 900, 80, 0.5, 0.6, 1.6);   // from above the turntable
    key.position.set(4, 26, 14);
    key.target.position.set(0, 2, 0);
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xff8a3a, 1.6);               // ember light from behind
    rim.position.set(-8, 6, -20);
    s.add(rim);
    const fill = new THREE.DirectionalLight(0x8fa4ff, 0.35);              // a cool fill from the left
    fill.position.set(-20, 8, 10);
    s.add(fill);
    // floor and turntable
    const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshLambertMaterial({ map: floorTexture() }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    this.table = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0x2c1d14 });
    const gold = new THREE.MeshBasicMaterial({ color: 0xe8c06a });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.6, 0.6, 64), stone);
    disc.position.y = 0.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.25, 0.12, 8, 96), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.62;
    const glow = new THREE.Mesh(new THREE.RingGeometry(7.4, 9.5, 96), new THREE.MeshBasicMaterial({
      color: 0xff9d3c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    this.table.add(disc, ring, glow);
    s.add(this.table);
    // embers rising through the stage
    const N = 260, pos = new Float32Array(N * 3);
    this.emberSpeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 40;
      pos[i * 3 + 2] = -Math.random() * 60 + 10;
      this.emberSpeed[i] = 1 + Math.random() * 3;
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xffa040, size: 0.35, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.add(this.embers);
    this.rowGroup = new THREE.Group();
    s.add(this.rowGroup);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // --- the racers -------------------------------------------------------------------------------
  setItems(items, sel = 0) {
    this.items = items;
    this.sel = this.pos = THREE.MathUtils.clamp(sel, 0, Math.max(0, items.length - 1));
  }

  select(i, snap = false) {
    this.sel = i;
    if (snap) this.pos = i;
  }

  // the kart for a racer (built once, kept while near the selection)
  kartFor(item, colorIndex) {
    const key = `${item.code}_${item.armor}`;
    let e = this.karts.get(key);
    if (!e) {
      const kart = new Kart(COLORS[colorIndex % COLORS.length], item.code);
      e = { kart, ready: false, used: this.t };
      this.karts.set(key, e);
      seatDriver(kart, { code: item.code, armor: item.armor }, item.info).then(() => { e.ready = true; }).catch(() => { e.ready = true; });
      if (this.karts.size > KEEP) {                       // forget the longest unused (never one still loading or just seen)
        const old = [...this.karts.entries()].filter(([, v]) => v.ready && this.t - v.used > 1 && !v.kart.mesh.parent)
          .sort((a, b) => a[1].used - b[1].used)[0];
        if (old) this.karts.delete(old[0]);
      }
    }
    e.used = this.t;
    return e;
  }

  // the item at a position of the row (the row wraps round: positions run on past the ends)
  at(i) {
    const n = this.items.length;
    return n ? this.items[((Math.round(i) % n) + n) % n] : null;
  }

  // the driver's height in the kart (lifts the camera for ogres, trolls ...)
  heightOf(item) { return (item?.info?.height || 6) / 6; }

  setMode(mode, opts = {}) {
    this.mode = mode;
    this.side = opts.side ?? 0;
    if (mode === 'podium') this.podium = opts.items || [];
  }

  // --- each frame ---------------------------------------------------------------------------------
  update(dt) {
    this.t += dt;
    this.spin += dt * 0.55;
    this.pos += (this.sel - this.pos) * Math.min(1, dt * 9);
    if (Math.abs(this.sel - this.pos) < 0.001) this.pos = this.sel;
    // embers
    const p = this.embers.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + this.emberSpeed[i] * dt;
      if (y > 40) y = 0;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(this.t * 0.7 + i) * dt * 0.4);
    }
    p.needsUpdate = true;
    // place the racers for the mode
    for (const c of [...this.rowGroup.children]) this.rowGroup.remove(c);
    const show = (item, idx, x, z, yaw, scale = 1, onTable = false) => {
      let e = this.kartFor(item, idx);
      if (!e.ready) {                       // still loading: the racer in an armor already built (never an empty kart)
        for (const [key, v] of this.karts) if (v.ready && key.startsWith(`${item.code}_`) && !v.kart.mesh.parent) { e = v; break; }
      }
      if (onTable) for (const a of item.info?.armors || []) this.kartFor({ ...item, armor: a.id }, idx);   // its other armors, ready to switch
      const m = e.kart.mesh;
      m.position.set(x, onTable ? 0.6 : 0, z);
      m.rotation.set(0, yaw, 0);
      m.scale.setScalar(scale);
      m.visible = true;
      this.rowGroup.add(m);
      e.kart.speed = 0;
      animateKart(e.kart, dt, this.t);
      return e;
    };
    let focusH = 1;
    if (this.mode === 'row' && this.items.length) {
      const lo = Math.floor(this.pos) - WINDOW, hi = Math.ceil(this.pos) + WINDOW;
      for (let i = lo; i <= hi; i++) {
        const n = this.items.length;
        const idx = ((i % n) + n) % n;
        if (n < 2 * WINDOW + 1 && i !== idx && (i < 0 || i >= n)) continue;   // a short list does not repeat
        const k = i - this.pos;
        const a = k * STEP;
        const x = Math.sin(a) * RADIUS, z = -(1 - Math.cos(a)) * RADIUS;
        const near = Math.max(0, 1 - Math.abs(k));
        const yaw = near > 0.5 ? this.spin : -a * 0.6 + Math.PI * 0.85 - near * 0.2;
        show(this.items[idx], idx, x, z, yaw, 0.82 + 0.18 * near, Math.abs(k) < 0.5);
      }
      focusH = this.heightOf(this.at(this.sel));
      this.table.position.set(0, 0, 0);
      this.table.visible = true;
    } else if (this.mode === 'single' && this.items.length) {
      const x = this.side * 9;
      const n = this.items.length, idx = ((Math.round(this.sel) % n) + n) % n;
      show(this.items[idx], idx, x, 0, this.spin, 1, true);
      this.table.position.set(x, 0, 0);
      this.table.visible = true;
      focusH = this.heightOf(this.items[idx]);
    } else if (this.mode === 'podium') {
      this.table.visible = false;
      const spots = [[0, 2.4], [-11, 1.6], [11, 0.9]];   // 1st centre, 2nd left, 3rd right
      this.podium.slice(0, 3).forEach((it, i) => {
        const e = show(it, i, spots[i][0], -2, Math.PI + 0.25 * Math.sin(this.t * 0.6 + i), 1);
        e.kart.mesh.position.y = spots[i][1];
      });
      this.ensurePodium();
    } else {
      this.table.visible = false;        // behind the card screens: just the stage and its embers
    }
    if (this.podiumBlocks) this.podiumBlocks.visible = this.mode === 'podium';
    // the camera: a slow drift, a product shot of the turntable
    const sway = Math.sin(this.t * 0.25) * 1.2;
    const lift = 6.2 + (focusH - 1) * 3;
    if (this.mode === 'podium') {
      this.camera.position.set(sway, 9, 30);
      this.camera.lookAt(0, 4, -2);
    } else {
      const tx = this.mode === 'single' ? this.side * 9 : 0;
      this.camera.position.set(tx * 0.55 + sway, lift + 1.2, 25 + (focusH - 1) * 5);
      this.camera.lookAt(tx * 0.55, 1.4 + (focusH - 1) * 1.6, 0);
    }
  }

  ensurePodium() {
    if (this.podiumBlocks) return;
    const g = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0x1b110b });
    const gold = new THREE.MeshBasicMaterial({ color: 0xe8c06a });
    for (const [x, h] of [[0, 2.4], [-11, 1.6], [11, 0.9]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(10, h, 9), stone);
      b.position.set(x, h / 2, -2);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.15, 9.2), gold);
      trim.position.set(x, h, -2);
      g.add(b, trim);
    }
    this.podiumBlocks = g;
    this.scene.add(g);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
