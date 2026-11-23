// EQ spells as kart items. Item gems sit in rows across the road; driving through one
// gives a spell (better ones the further back you are). E / LB casts it.
// Every spell plays its real EverQuest particle effect (eqfx.js): the cast stage on the
// caster, the projectile stage on anything that travels, the impact stage on whoever it lands on.
import * as THREE from 'three';
import { LOOKS } from './particles.js';
import { kartAnchor, pointAnchor } from './eqfx.js';

export const SPELLS = {
  wolf: { name: 'Spirit of Wolf', icon: 'wolf' },              // speed burst
  fireball: { name: 'Flame Bolt', icon: 'fireball' },          // flies ahead along the track
  whirlwind: { name: 'Whirl till you hurl', icon: 'whirlwind' }, // left behind as a trap: you spin
  snare: { name: 'Snare', icon: 'snare' },                     // slows the kart just ahead
  gate: { name: 'Gate', icon: 'gate' },                        // jump forward along the line
  invis: { name: 'Invisibility', icon: 'invis' },              // spells pass through you
  lightning: { name: 'Shock of Lightning', icon: 'lightning' }, // strikes the race leader
};

// Making each spell readable: a glowing core on what flies, a marker on what lingers (the
// whirl's funnel, the snare's ring), a bolt from the sky, and a line in the HUD feed saying
// who cast what at whom.
const glowCache = {};
function glow(color) {
  if (glowCache[color]) return glowCache[color];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.25, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return (glowCache[color] = t);
}
const sprite = (color, size, opacity = 1) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  sp.scale.setScalar(size);
  return sp;
};
function swirlTex() {
  if (glowCache.swirl) return glowCache.swirl;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  for (let k = 0; k < 6; k++) {
    g.strokeStyle = `rgba(${200 + k * 8},${230},255,${0.35 + 0.1 * (k % 2)})`;
    g.lineWidth = 6;
    g.beginPath();
    for (let x = 0; x <= 128; x += 4) g.lineTo(x, ((x * 0.5 + k * 22) % 64));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (glowCache.swirl = t);
}

// weights by race position bucket: [leaders, middle, back]
const TABLE = {
  wolf: [2, 4, 5], fireball: [5, 4, 2], whirlwind: [5, 3, 1], snare: [1, 3, 3],
  gate: [0, 2, 4], invis: [3, 2, 1], lightning: [0, 1, 3],
};

function roll(place, count) {
  const b = place <= 2 ? 0 : place <= Math.ceil(count * 0.6) ? 1 : 2;
  const entries = Object.entries(TABLE);
  let r = Math.random() * entries.reduce((s, [, w]) => s + w[b], 0);
  for (const [k, w] of entries) if ((r -= w[b]) <= 0) return k;
  return 'wolf';
}

export class ItemSystem {
  constructor(scene, track, karts, raceOrder, fx, eqfx) {
    this.scene = scene;
    this.fx = fx;                        // EQ-sprite cosmetics (gems, drift sparks)
    this.eq = eqfx;                      // EverQuest spell effects
    this.track = track;
    this.karts = karts;
    this.raceOrder = raceOrder;          // () -> karts sorted first..last
    this.boxes = [];
    this.shots = [];                     // flame bolts in flight
    this.traps = [];                     // whirls
    const gem = new THREE.OctahedronGeometry(1.6, 0);
    const gemMat = new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.9 });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffaacc, transparent: true, opacity: 0.25, depthWrite: false });
    for (const frac of track.data.itemRows || [0.18, 0.5, 0.8]) {
      const i = track.open ? Math.floor(track.start + frac * (track.finish - track.start)) : Math.floor(frac * track.n);
      const tan = track.tangent(i);
      const side = new THREE.Vector3(-tan.z, 0, tan.x);
      for (const lane of [-0.55, -0.18, 0.18, 0.55]) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(gem, gemMat));
        g.add(new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), haloMat));
        g.position.copy(track.path[i]).addScaledVector(side, lane * track.width).add(new THREE.Vector3(0, 3.2, 0));
        scene.add(g);
        this.boxes.push({ mesh: g, respawn: 0 });
      }
    }
    for (const k of karts) {
      Object.assign(k, { item: null, boost: 0, slow: 0, spin: 0, invis: 0, itemTimer: 0 });
      k.anchor = kartAnchor(k);
    }
    this.marks = [];                     // short-lived visuals: bolts, flashes, snare rings
    this.feedEl = document.getElementById('feed');
  }

  // a line in the HUD feed; lines about you are gold and always shown, others only when nothing is
  say(text, aboutYou) {
    if (!this.feedEl) return;
    if (!aboutYou && this.feedEl.children.length > 2) return;
    const d = document.createElement('div');
    d.innerHTML = text;
    if (aboutYou) d.className = 'you';
    this.feedEl.appendChild(d);
    while (this.feedEl.children.length > 4) this.feedEl.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 3200);
  }
  who(k) { return k === this.karts[0] ? 'You' : k.name; }
  whose(k) { return k === this.karts[0] ? 'Your' : `${k.name}'s`; }
  mark(obj, life, update) { this.scene.add(obj); this.marks.push({ obj, life, t: 0, update }); }
  flash(pos, color, size = 14, life = 0.45) {
    const sp = sprite(color, size);
    sp.position.copy(pos);
    this.mark(sp, life, (m, u) => { sp.material.opacity = 1 - u; sp.scale.setScalar(size * (0.6 + u)); });
  }

  // an EQ sound: at a kart / point in the world (it fades and pans), or right here when it is yours
  sound(name, k, opts = {}) {
    if (!this.sfx) return null;
    const mine = k === this.karts[0];
    return this.sfx.play(name, { ...opts, at: mine ? null : (opts.at ?? (k?.pos ? k.pos.clone() : null)), vol: (opts.vol ?? 1) * (mine ? 1 : 0.8) });
  }

  give(k) {
    if (k === this.karts[0]) this.sound('pickup', k, { vol: 0.7 });
    const order = this.raceOrder();
    k.item = roll(order.indexOf(k) + 1, order.length);
    k.itemTimer = 0.6 + Math.random() * 2.5;         // CPU reaction time
  }

  hit(k, spin = 1.3) {
    if (k.invis > 0 || k.spin > 0) return false;
    k.spin = spin;
    k.speed *= 0.3;
    return true;
  }

  // the effect's three stages: 0 cast (on the caster), 1 projectile, 2 impact (on the target)
  cast(kind, k) { this.eq.play(kind, 0, k.anchor, 1.0); }
  land(kind, target, seconds = 2.0) { this.eq.play(kind, 2, target.anchor || target, seconds); }

  use(k) {
    const kind = k.item;
    if (!kind) return;
    k.item = null;
    const t = this.track;
    const me = k === this.karts[0];
    this.cast(kind, k);
    this.sound('cast', k, { vol: 0.75, dur: 1.1 });          // the first moment of EQ's casting chant
    if (me) this.say(`You cast <b>${SPELLS[kind].name}</b>`, true);
    if (kind === 'wolf') { k.boost = 2.6; k.speed = Math.max(k.speed, 70); this.land(kind, k, 2.6); this.sound('wolf', k, { vol: 0.8 }); }
    else if (kind === 'invis') { k.invis = 5; this.land(kind, k, 2.5); this.sound('invis', k, { vol: 0.7 }); }
    else if (kind === 'gate') {
      this.sound('gate', k);
      this.flash(k.pos.clone().add(new THREE.Vector3(0, 3, 0)), '#9fd0ff', 18, 0.6);
      const i = t.idx(k.progress + 22);
      const p = t.path[i], tan = t.tangent(i);
      k.place([p.x, p.y + 2, p.z], Math.atan2(tan.x, -tan.z));
      k.speed = 40;
      if (i < k.progress && !t.open) k.lap += 1;
      k.progress = i;
      this.land(kind, k, 2.0);
      this.flash(k.pos.clone().add(new THREE.Vector3(0, 3, 0)), '#9fd0ff', 18, 0.6);
    } else if (kind === 'snare' || kind === 'lightning') {
      const order = this.raceOrder();
      const idx = order.indexOf(k);
      const target = kind === 'lightning' ? order[0] : order[idx - 1];
      if (target && target !== k) {
        const them = target === this.karts[0];
        if (kind === 'snare') {
          if (target.invis <= 0) { target.slow = 3.5; this.snareRing(target); this.sound('snare', target); }
          this.say(`${this.whose(k)} <b>Snare</b> slows ${this.who(target)}`, me || them);
        } else {
          if (this.hit(target, 1.6)) target.slow = 2;
          this.bolt(target);
          this.sfx?.play('thunder', { vol: them ? 1 : 0.55 });      // thunder carries: everyone hears it
          this.say(`${this.whose(k)} <b>Shock of Lightning</b> strikes ${them ? 'you' : target.name}${order[0] === target ? ' (the leader)' : ''}`, me || them);
        }
        this.land(kind, target, kind === 'snare' ? 3.5 : 2.0);
      }
    } else if (kind === 'fireball') {
      const shot = { pos: k.pos.clone().add(new THREE.Vector3(0, 3, 0)), dir: k.forward(), owner: k, along: k.progress + 2, life: 6 };
      shot.anchor = pointAnchor(() => shot.pos, () => shot.dir);
      shot.trail = this.eq.play(kind, 1, shot.anchor, 6);
      shot.hum = this.sfx?.play('travel', { at: () => shot.pos, loop: true, vol: 0.9 });
      // a bright core and a tail you can follow down the track
      shot.core = sprite('#ff8a20', 7);
      shot.tail = [0.75, 0.55, 0.38].map((f) => sprite('#ff5a10', 7 * f, 0.8));
      shot.hist = [];
      for (const sp of [shot.core, ...shot.tail]) { sp.position.copy(shot.pos); this.scene.add(sp); }
      this.shots.push(shot);
    } else if (kind === 'whirlwind') {
      const pos = k.pos.clone().addScaledVector(k.forward(), -7).add(new THREE.Vector3(0, 0.5, 0));
      const trap = { pos, owner: k, life: 30, armed: 0.5, pulse: 0 };
      trap.anchor = pointAnchor(() => trap.pos);
      // a spinning funnel of wind standing on the road: you can see it and steer round it
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 1.0, 10, 20, 1, true),
        new THREE.MeshBasicMaterial({ map: swirlTex(), color: 0xe8fbff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      funnel.position.copy(pos).add(new THREE.Vector3(0, 5, 0));
      this.scene.add(funnel);
      trap.funnel = funnel;
      trap.wind = this.sfx?.play('whirl', { at: () => trap.pos, loop: true, vol: 0.7 });
      this.traps.push(trap);
      if (me) this.say('A whirlwind left behind you', true);
    }
  }

  // lightning: a jagged bolt from the sky onto the kart, and a flash
  bolt(target) {
    const top = target.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 70, (Math.random() - 0.5) * 10));
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const p = top.clone().lerp(target.pos.clone().add(new THREE.Vector3(0, 2, 0)), k / 10);
      if (k > 0 && k < 10) p.add(new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5));
      pts.push(p);
    }
    // thick glowing segments (a line is one pixel wide)
    const bolt = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const halo = new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5);
      for (const [m, r] of [[mat, 0.35], [halo, 1.1]]) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5, 1, true), m);
        seg.position.copy(mid);
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        bolt.add(seg);
      }
    }
    this.mark(bolt, 0.4, (m, u) => { const o = Math.random() < 0.3 ? 0.25 : 1 - u; mat.opacity = o; halo.opacity = 0.45 * o; });
    this.flash(target.pos.clone().add(new THREE.Vector3(0, 3, 0)), '#bfe0ff', 20, 0.4);
  }

  // snare: a pulsing ring of roots round the slowed kart while it lasts
  snareRing(target) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.35, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0x7bd36a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    this.mark(ring, 3.5, (m, u) => {
      ring.position.copy(target.pos).add(new THREE.Vector3(0, 0.8, 0));
      ring.scale.setScalar(1 + 0.12 * Math.sin(m.t * 12));
      ring.material.opacity = 0.85 * (1 - u * u);
      if (target.slow <= 0) m.life = 0;
    });
  }

  // a CPU racer's moment for its spell: a bolt when someone is just ahead, a whirl when
  // someone is right behind, the wolf on a straight; the rest whenever
  wise(k) {
    const n = this.track.n;
    const gap = (o) => (this.track.open ? o.progress - k.progress : (o.lap * n + o.progress) - (k.lap * n + k.progress));
    const others = this.karts.filter((o) => o !== k);
    if (k.item === 'fireball') return others.some((o) => gap(o) > 2 && gap(o) < 30);
    if (k.item === 'whirlwind') return others.some((o) => gap(o) < -1 && gap(o) > -12);
    if (k.item === 'wolf') return this.track.bend[this.track.idx(k.progress + 6)] < 0.15;
    return true;
  }

  // before kart physics: timers and their effect on the kart
  preUpdate(dt, isCpu) {
    for (const k of this.karts) {
      k.boost = Math.max(0, k.boost - dt);
      k.slow = Math.max(0, k.slow - dt);
      k.spin = Math.max(0, k.spin - dt);
      k.invis = Math.max(0, k.invis - dt);
      k.effectScale = (k.boost > 0 ? 1.3 : 1) * (k.slow > 0 ? 0.6 : 1);
      if (k.boost > 0) k.input.throttle = 1;
      if (k.spin > 0) { k.input.throttle = 0; k.input.steer = 0; k.yaw += 11 * dt; }
      if (k.item && isCpu(k) && (k.itemTimer -= dt) <= 0 && (this.wise(k) || k.itemTimer < -6)) this.use(k);
      k.mesh.traverse((o) => {
        if (!o.material) return;
        const want = k.invis > 0 ? 0.3 : 1;
        if (o.material.opacity !== want && !o.material.userData.fixedOpacity) {
          o.material.transparent = want < 1;
          o.material.opacity = want;
        }
      });
    }
  }

  update(dt) {
    for (const b of this.boxes) {
      b.mesh.rotation.y += dt * 1.8;
      if (b.mesh.visible && Math.random() < dt * 4) LOOKS.gemSparkle(this.fx, b.mesh.position);
      b.mesh.position.y += Math.sin(performance.now() / 300 + b.mesh.position.x) * 0.01;
      if (b.respawn > 0) { b.respawn -= dt; b.mesh.visible = b.respawn <= 0; continue; }
      for (const k of this.karts) {
        if (k.pos.distanceToSquared(b.mesh.position) < 30 && !k.item) {
          this.give(k);
          LOOKS.pickup(this.fx, b.mesh.position);
          b.respawn = 3;
          b.mesh.visible = false;
          break;
        }
      }
    }
    const t = this.track;
    for (const s of this.shots) {
      s.life -= dt;
      s.along += dt * 25;                         // path points per second (~150 units/s)
      const i = t.idx(Math.floor(s.along));
      const target = t.path[i].clone().add(new THREE.Vector3(0, 3, 0));
      s.dir = target.clone().sub(s.pos).setY(0).normalize();
      s.pos.lerp(target, Math.min(1, dt * 12));
      s.hist.unshift(s.pos.clone());
      if (s.hist.length > 9) s.hist.pop();
      s.core.position.copy(s.pos);
      s.core.scale.setScalar(6.5 + Math.sin(performance.now() / 40) * 0.8);
      s.tail.forEach((sp, j) => sp.position.copy(s.hist[Math.min(s.hist.length - 1, (j + 1) * 2)]));
      for (const k of this.karts) {
        if (k === s.owner && s.life > 5.6) continue;
        if (k.pos.distanceToSquared(s.pos) < 36 && this.hit(k)) {
          s.life = 0;
          this.land('fireball', k, 1.5);
          this.flash(s.pos.clone(), '#ffb040', 16, 0.5);
          this.sound('fire', k);
          this.sound('hit', k, { vol: 0.6 });
          this.say(`${this.whose(s.owner)} <b>Flame Bolt</b> hit ${k === this.karts[0] ? 'you' : k.name}`, s.owner === this.karts[0] || k === this.karts[0]);
          break;
        }
      }
      if (s.life <= 0) { s.trail.stop(); s.hum?.stop(); for (const sp of [s.core, ...s.tail]) this.scene.remove(sp); }
    }
    for (const w of this.traps) {
      w.life -= dt;
      w.armed -= dt;
      if ((w.pulse -= dt) <= 0) { w.pulse = 1.2; this.eq.play('whirlwind', 0, w.anchor, 1.2); }   // the spell, hanging in the air
      w.funnel.rotation.y += dt * 9;
      w.funnel.material.map.offset.x += dt * 0.8;
      w.funnel.material.opacity = Math.min(1, w.life / 2);
      if (w.armed <= 0) {
        for (const k of this.karts) {
          if (k.pos.distanceToSquared(w.pos) < 30 && this.hit(k, 1.6)) {
            w.life = 0;
            this.land('whirlwind', k, 1.6);
            this.sound('whoosh', k);
            this.say(`${this.whose(w.owner)} <b>Whirlwind</b> spun ${k === this.karts[0] ? 'you' : k.name} round`, w.owner === this.karts[0] || k === this.karts[0]);
            break;
          }
        }
      }
      if (w.life <= 0) { this.scene.remove(w.funnel); w.wind?.stop(0.5); }
    }
    this.shots = this.shots.filter((s) => s.life > 0);
    this.traps = this.traps.filter((w) => w.life > 0);
    for (const m of this.marks) {
      m.t += dt;
      if (m.update) m.update(m, Math.min(1, m.t / m.life));
      if (m.t >= m.life) this.scene.remove(m.obj);
    }
    this.marks = this.marks.filter((m) => m.t < m.life);
  }
}
