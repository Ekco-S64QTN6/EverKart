// EverQuest life beside the track. Everything is the zone's own skinned models playing
// their own EQ animations (stand P01, fidget O01, walk L01 / run L02, attacks C01 / C02):
//   - creatures spread along the road, the small ones patrolling, giants wandering
//   - skirmishes: player characters fighting the zone's monsters, casting real spell effects
//   - fixed landmark scenes from the track file (the spectres on Oasis's tower ...)
//   - dragons that breathe fire at passing karts
// Scenery only - karts pass through.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cast } from './world.js';
import { pointAnchor } from './eqfx.js';

const loader = new GLTFLoader();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const cache = {};

// what each player character carries and how it fights (EQ items from gequip.s3d)
const LOADOUT = {
  pc_HUM: { main: 'IT5', shield: 'IT203', style: 'melee' }, pc_BAM: { main: '2HNSWORD', style: 'two' },
  pc_OGM: { main: 'IT25', style: 'two' }, pc_DWM: { main: 'IT18', shield: 'IT201', style: 'melee' },
  pc_ERM: { main: 'WIZSTAFF', style: 'caster' }, pc_ELF: { main: 'IT16', style: 'caster' },
  pc_HIF: { main: 'WIZSTAFF', style: 'caster' }, pc_DAF: { main: 'IT26', style: 'melee' },
  pc_HOM: { main: 'IT1', off: 'IT1', style: 'dual' }, pc_GNF: { main: 'WIZSTAFF', style: 'caster' },
  pc_DWM_pl: { main: 'IT18', shield: 'IT207', style: 'melee' }, pc_DAF_pl: { main: '2HNSWORD', style: 'two' },
  pc_ERM_pl: { main: 'IT13', shield: 'IT203', style: 'melee' }, pc_HIF_pl: { main: 'IT2', shield: 'IT200', style: 'melee' },
  pc_ELF_ch: { main: 'IT2', off: 'IT1', style: 'dual' }, pc_HUM_mnk: { style: 'monk' },
  pc_HUM_lo: { main: 'IT1', style: 'melee' }, pc_ELF_lo: { main: 'IT16', style: 'caster' }, pc_DWM_lo: { main: 'IT18', style: 'melee' },
  pc_BAM_lo: { main: 'IT3', style: 'melee' }, pc_GNF_lo: { main: 'WIZSTAFF', style: 'caster' }, pc_HIF_lo: { main: 'IT1', style: 'melee' },
};
// EQ's animation codes for each way of fighting (a monster uses whichever attacks it has)
const STYLE_CLIPS = {
  melee: ['C02', 'C07'], two: ['C03', 'C04'], dual: ['C02', 'C06'], caster: ['T04', 'T05', 'T06'],
  monk: ['C08', 'T08', 'T09', 'C11'], monster: ['C02', 'C05', 'C10', 'C01', 'C03', 'C04', 'C08', 'C11'],
};
const itemCache = {};
function loadItem(name) {
  itemCache[name] ??= loader.loadAsync(`items/${name}.glb`).then((gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      o.material = new THREE.MeshLambertMaterial({ map: m.map, alphaTest: m.alphaTest, side: THREE.DoubleSide });
      if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    });
    return gltf.scene;
  }).catch(() => null);
  return itemCache[name];
}

function loadModel(file) {
  cache[file] ??= loader.loadAsync(`npcs/${file}.glb`).then((gltf) => {
    const root = gltf.scene;
    let height = 1;
    root.traverse((o) => {
      if (o.userData?.height) height = o.userData.height;
      if (!o.isMesh) return;
      const m = o.material;
      o.material = new THREE.MeshLambertMaterial({ map: m.map, alphaTest: m.alphaTest, side: THREE.DoubleSide });
      if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
      o.frustumCulled = false;                       // skinned bounds do not follow the animation
    });
    return { root, height, clips: gltf.animations, file };
  }).catch(() => null);
  return cache[file];
}

const ground = (collider, p, from = 30) => {
  const hit = cast(collider, p.clone().add(new THREE.Vector3(0, from, 0)), DOWN, from + 90);
  return hit ? hit.point.y : null;
};
const faceYaw = (dir) => Math.atan2(-dir.x, -dir.z);       // models face -z

export async function placeNpcs(scene, track, collider, zoneFile) {
  const zone = zoneFile.replace('.glb', '');
  const placed = [];
  const fights = [];
  let feature = null;
  const data = track.data;
  const tooClose = (p, r) => placed.some((s) => s.npc.position.distanceTo(p) < r + s.radius + 6);
  const named = [];                                  // named NPCs (Hoshkar, Phara Dar ...): the intro can show them

  // the items each loadout uses, loaded once
  const items = {};
  for (const name of new Set(Object.values(LOADOUT).flatMap((l) => [l.main, l.off, l.shield]).filter(Boolean))) items[name] = await loadItem(name);

  function spawn(model, height, pos, yaw, opts = {}) {
    const npc = cloneSkinned(model.root);
    const gear = !opts.unarmed && LOADOUT[model.file];
    if (gear) {                                        // weapons in hand, shield on the arm
      const bone = (tail) => { let b = null; npc.traverse((o) => { if (!b && o.name.endsWith(tail)) b = o; }); return b; };
      const hold = (item, tail) => { const b = item && items[item] && bone(tail); if (b) b.add(items[item].clone()); };
      hold(gear.main, 'R_POINT_TRACK');
      hold(gear.off, 'L_POINT_TRACK');
      hold(gear.shield, 'SHIELD_POINT_TRACK');
    }
    npc.scale.setScalar(height / model.height);
    npc.position.copy(pos);
    npc.rotation.y = yaw;
    scene.add(npc);
    const mixer = new THREE.AnimationMixer(npc);
    const clip = (name) => model.clips.find((c) => c.name === name);
    const act = (name) => (clip(name) ? mixer.clipAction(clip(name)) : null);
    const style = opts.style || gear?.style || (model.file.startsWith('pc_') ? 'melee' : 'monster');
    let attack = STYLE_CLIPS[style].map(act).filter(Boolean);
    if (!attack.length) attack = STYLE_CLIPS.monster.map(act).filter(Boolean);
    if (style === 'monster' && attack.length > 2) attack = attack.slice(0, 2);
    const s = { height, radius: height * 0.45, npc, mixer, idle: act('P01') || act('O01') || act('P03'), fidget: act('O01'),
      walk: act('L01') || act('L02'), run: act('L02') || act('L01'), attack, breathClip: act('T06'), style,
      next: 3 + Math.random() * 6, ...opts };
    // EQ's walk and run cycles cover about this much ground per second at this size
    s.walkSpeed = height * (act('L01') ? 1.4 : 3.2);
    s.runSpeed = height * 3.2;
    if (s.idle) { s.idle.play(); s.idle.time = Math.random() * s.idle.getClip().duration; s.idle.timeScale = 0.9 + Math.random() * 0.2; }
    placed.push(s);
    return s;
  }

  // a free spot beside the road at path point i: { spot, room, out (unit vector away from the road), tan }
  function beside(i, dist, radius, height, only = 0) {
    const p = track.path[i];
    const tan = track.tangent(i);
    const side = new THREE.Vector3(-tan.z, 0, tan.x);
    const o = p.clone().add(new THREE.Vector3(0, 6, 0));
    let best = null;
    for (const sg of only ? [only] : [1, -1]) {
      const dir = side.clone().multiplyScalar(sg);
      const hit = cast(collider, o, dir, 400);
      const room = hit ? hit.distance : 400;
      if (room < dist + radius) continue;
      const spot = o.clone().addScaledVector(dir, dist);
      const fy = ground(collider, spot);
      if (fy === null || Math.abs(fy - p.y) > 40) continue;
      const at = new THREE.Vector3(spot.x, fy, spot.z);
      if (cast(collider, at.clone().add(new THREE.Vector3(0, 1, 0)), UP, height * 1.05)) continue;
      // not on another stretch of the road
      let onRoad = false;
      for (let j = 0; j < track.n && !onRoad; j += 2) {
        const q = track.path[j];
        if ((q.x - at.x) ** 2 + (q.z - at.z) ** 2 < (track.width + radius + 3) ** 2 && Math.abs(q.y - at.y) < 20) onRoad = true;
      }
      if (onRoad || tooClose(at, radius)) continue;
      if (!best || room > best.room) best = { spot: at, room, out: dir, tan };
    }
    return best;
  }

  // --- 1. creatures along the road
  const specs = data.npcs || [];
  const total = specs.reduce((s, e) => s + e.count, 0);
  let slot = 0;
  for (const spec of specs) {
    const model = await loadModel(`${zone}_${spec.model}`);
    if (!model) { slot += spec.count; continue; }
    // several texture sets (one dragon of each colour): the c-th one wears variants[c]
    const looks = spec.variants ? (await Promise.all(spec.variants.map((v) => loadModel(`${zone}_${spec.model}_v${v}`)))).map((m) => m || model) : [model];
    const radius = spec.height * 0.45;
    for (let c = 0; c < spec.count; c++, slot++) {
      const base = Math.floor(((slot + 0.5) / total) * track.n);
      for (let tryI = 0; tryI < 40; tryI++) {
        const i = (base + tryI * 7) % track.n;
        const b = beside(i, track.width + 3.5 + radius + Math.random() * 5, radius, spec.height);
        if (!b) continue;
        const s = spawn(looks[c % looks.length], spec.height, b.spot, faceYaw(b.out.clone().negate()) + (Math.random() - 0.5) * 0.5,
          { model: spec.model, index: i, breath: spec.breath, cool: 2 + Math.random() * 3 });
        if (spec.feature && !feature) feature = { pos: b.spot.clone(), height: spec.height, lookH: spec.height * 0.7, actor: s };
        if (s.walk && (spec.height <= 10 || spec.wander)) {      // patrol along the road edge
          const reach = spec.wander ? 45 : 9;
          s.patrol = { a: b.spot.clone().addScaledVector(b.tan, -reach), b: b.spot.clone().addScaledVector(b.tan, reach),
            toB: true, speed: spec.wander ? spec.height * 0.35 : 4 + Math.random() * 2 };
          s.walk.timeScale = THREE.MathUtils.clamp(s.patrol.speed / s.walkSpeed, 0.4, 2.5);   // no sliding feet
          s.walk.play();
          if (s.idle) s.idle.stop();
        }
        break;
      }
    }
  }

  // --- 2. fixed scenes: { model, height, pos: [x, y, z], yaw } (y may be null = on the ground)
  const featPts = [];
  let featH = 0, featLook = 0;
  for (let sc of data.scenes || []) {
    // a named NPC can wear one of the model's texture sets (Hoshkar: the dragon's v4)
    const model = (sc.variant !== undefined && await loadModel(`${zone}_${sc.model}_v${sc.variant}`)) || await loadModel(`${zone}_${sc.model}`);
    if (!model) continue;
    const p = new THREE.Vector3(sc.pos[0], sc.pos[1] ?? 0, sc.pos[2]);
    if (sc.pos[1] == null) {                          // on the ground: search down from a little above the nearest road
      let near = track.path[0];
      for (const q of track.path) if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < (near.x - p.x) ** 2 + (near.z - p.z) ** 2) near = q;
      p.y = ground(collider, p.clone().setY(near.y), 60) ?? near.y;
    }
    if (sc.pos[1] == null) {                          // never on the road: step out past its edge
      let j = 0;
      for (let q = 1; q < track.n; q++) if ((track.path[q].x - p.x) ** 2 + (track.path[q].z - p.z) ** 2 < (track.path[j].x - p.x) ** 2 + (track.path[j].z - p.z) ** 2) j = q;
      const near = track.path[j], need = track.width + 8 + sc.height * 0.4;
      if (Math.hypot(near.x - p.x, near.z - p.z) < need) {
        const tan = track.tangent(j), side = new THREE.Vector3(-tan.z, 0, tan.x);
        const sg = (p.x - near.x) * side.x + (p.z - near.z) * side.z >= 0 ? 1 : -1;
        p.set(near.x + side.x * need * sg, near.y, near.z + side.z * need * sg);
        p.y = ground(collider, p, 60) ?? near.y;
        sc = { ...sc, yaw: THREE.MathUtils.radToDeg(faceYaw(side.clone().multiplyScalar(-sg))) };
      }
    }
    // which way it faces: a point (`face_at`, EQ x, y), the racers coming at it (`face: "racers"`:
    // back down the course from the nearest stretch), or a fixed heading (`yaw`, degrees)
    let yaw = THREE.MathUtils.degToRad(sc.yaw || 0);
    let look = null;
    if (sc.face_at) look = new THREE.Vector3(sc.face_at[0], p.y, -sc.face_at[1]);
    else if (sc.face === 'racers') {
      let j = 0;
      for (let q = 1; q < track.n; q++) if (track.path[q].distanceToSquared(p) < track.path[j].distanceToSquared(p)) j = q;
      look = track.path[track.idx(j - 25)].clone();
    }
    if (look) { const d = look.sub(p).setY(0); if (d.lengthSq() > 1e-6) yaw = faceYaw(d.normalize()); }
    const s = spawn(model, sc.height, p, yaw, { model: sc.model, fixed: true, name: sc.name,
      breath: sc.breath, cool: 3 + Math.random() * 3 });
    if (sc.name) named.push({ name: sc.name, actor: s, pos: p.clone(), height: sc.height });
    if (sc.feature) (featPts.push(p.clone()), featH = sc.height * (sc.featureScale || 3), featLook = sc.height * 0.6);
  }
  if (featPts.length && !feature) {                  // the landmark as a whole (all four spectres)
    const mid = featPts.reduce((a, q) => a.add(q), new THREE.Vector3()).divideScalar(featPts.length);
    feature = { pos: mid, height: featH, lookH: featLook, radius: Math.max(...featPts.map((q) => q.distanceTo(mid))) };
  }

  // --- 3. skirmishes: { count, heroes: [files], heroHeight, foes: [models], foeHeight, at: 'centroid'? }
  for (const sk of data.skirmishes || []) {
    const heroes = (await Promise.all(sk.heroes.map((h) => loadModel(h.includes('_') ? h : `${zone}_${h}`)))).filter(Boolean);
    const foes = (await Promise.all(sk.foes.map((f) => loadModel(`${zone}_${f}`)))).filter(Boolean);
    if (!heroes.length || !foes.length) continue;
    const hh = sk.heroHeight || 6, fh = sk.foeHeight || 7;
    const pair = (center, along) => {
      const gap = (hh + fh) * 0.32;
      const a = center.clone().addScaledVector(along, -gap), b = center.clone().addScaledVector(along, gap);
      for (const q of [a, b]) q.y = ground(collider, q) ?? center.y;
      const hero = spawn(heroes[Math.floor(Math.random() * heroes.length)], hh * (0.9 + Math.random() * 0.2), a, faceYaw(along), { fighter: true });
      const foe = spawn(foes[Math.floor(Math.random() * foes.length)], fh * (0.9 + Math.random() * 0.2), b, faceYaw(along.clone().negate()), { fighter: true });
      for (const f of [hero, foe]) {
        if (!f.attack.length) continue;
        if (f.idle) f.idle.stop();
        f.swing = 0;
        f.attack[0].play();
        f.attack[0].time = Math.random();
      }
      fights.push({ hero, foe, cast: 2 + Math.random() * 5 });
    };
    if (sk.at === 'centroid') {
      const c = track.path.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(track.n);
      c.y = ground(collider, c, 200) ?? c.y;
      for (let k = 0; k < sk.count; k++) {
        const ang = (k / sk.count) * Math.PI * 2;
        const center = c.clone().add(new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(sk.count > 1 ? (hh + fh) * 0.9 : 0));
        pair(center, new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang)));
      }
      if (sk.feature && !feature) feature = { pos: c.clone(), height: Math.max(hh, fh) * 2.2 };
      continue;
    }
    for (let k = 0; k < sk.count; k++) {
      const base = Math.floor(((k + 0.3) / sk.count) * track.n);
      for (let tryI = 0; tryI < 30; tryI++) {
        const i = (base + tryI * 5) % track.n;
        const r = Math.max(hh, fh);
        const b = beside(i, track.width + 4 + r + Math.random() * 7, r * 1.3, r);
        if (!b) continue;
        pair(b.spot, Math.random() < 0.5 ? b.tan.clone() : b.tan.clone().negate());
        if (sk.feature && !feature) feature = { pos: b.spot.clone(), height: Math.max(hh, fh) * 1.6 };
        break;
      }
    }
  }

  // --- 5. vignettes: what the zone is known for, each one a shot in the race intro.
  // { kind: 'fight', at, title, heroes: [files], foes: [models], pairs, heroHeight, foeHeight, radius }
  // { kind: 'kite',  at, title, hero: file, foe: model, foeHeight, radius }   a player running rings round a giant
  // { kind: 'herd',  at, title, model, count, height, radius }                 creatures wandering about
  // { kind: 'feature', title }                                                 the track's landmark scene
  const shots = [];
  const fileOf = (m) => (m.startsWith('pc_') ? m : `${zone}_${m}`);
  // (searching down from just above the track's highest point: zones have invisible ceilings)
  const topY = Math.max(...track.path.map((q) => q.y)) + 150;
  const groundAt = (x, z, yHint) => {
    const from = yHint ?? topY;
    const hit = cast(collider, new THREE.Vector3(x, from + 25, z), DOWN, from + 25 + 4000);
    return hit ? hit.point.y : null;
  };
  // on the road (with a margin): wanderers and herds keep off it
  const onRoadAt = (x, z, y) => {
    for (let j = 0; j < track.n; j += 2) {
      const q = track.path[j], r = (track.roadWR ? Math.max(track.roadWR[j], track.roadWL[j]) : track.width) + 6;
      if ((q.x - x) ** 2 + (q.z - z) ** 2 < r * r && Math.abs(q.y - y) < 20) return true;
    }
    return false;
  };
  const near = (c, r, yHint, offRoad = false) => {     // a spot on the ground within r of c
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2, d = r * Math.sqrt(Math.random());
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const y = groundAt(x, z, (yHint ?? c.y) + 20);
      if (y !== null && Math.abs(y - c.y) < 25 && !(offRoad && onRoadAt(x, z, y))) return new THREE.Vector3(x, y, z);
    }
    return offRoad ? null : c.clone();
  };
  for (const v of data.vignettes || []) {
    if (v.kind === 'named') {                          // a named NPC from the scenes, by name
      const nm = named.find((q) => q.name === v.name);
      if (nm) shots.push({ pos: nm.pos.clone(), height: nm.height, lookH: nm.height * 0.6, radius: 0, actor: nm.actor, title: v.title });
      continue;
    }
    if (v.kind === 'feature') {
      if (feature) shots.push({ pos: feature.pos.clone(), height: feature.radius ? feature.lookH / 0.6 : feature.height, lookH: feature.lookH, radius: feature.radius || 0, around: !!feature.radius, actor: feature.actor, title: v.title });
      continue;
    }
    const R = v.radius ?? 20;
    let c = null;
    if (v.pos) {                                         // a place in the zone (EQ coordinates)
      const y0 = groundAt(v.pos[0], v.pos[2], v.pos[1] ?? undefined);
      if (y0 !== null) c = new THREE.Vector3(v.pos[0], y0, v.pos[2]);
    } else if (v.along !== undefined) {                  // beside the road, part way round the lap
      const size = Math.max(v.heroHeight || 6, v.foeHeight || 7, v.height || 6);
      // the room it wants beside the road, then less (narrow halls)
      for (const k of [1, 0.6, 0.35]) {
        for (let tryI = 0; tryI < 40 && !c; tryI++) {
          const i = (Math.floor(v.along * track.n) + tryI * 6) % track.n;
          const b = beside(i, track.width + 4 + (R * 0.6 + size * 0.5) * k, (R * 0.5 + size * 0.4) * k, size * k);
          if (b) c = b.spot.clone();
        }
      }
    }
    if (!c) { console.warn(`vignette "${v.title}": no place found`); continue; }
    let height = 6;
    if (v.kind === 'fight') {
      const heroes = (await Promise.all(v.heroes.map((h) => loadModel(fileOf(h))))).filter(Boolean);
      const foes = (await Promise.all(v.foes.map((f) => loadModel(fileOf(f))))).filter(Boolean);
      if (!heroes.length || !foes.length) continue;
      const hh = v.heroHeight || 6, fh = v.foeHeight || 7;
      height = Math.max(hh, fh);
      for (let k = 0; k < (v.pairs || 3); k++) {
        const at = k === 0 ? c.clone() : near(c, R);
        const along = new THREE.Vector3(Math.cos(k * 2.4), 0, Math.sin(k * 2.4));
        const gap = (hh + fh) * 0.32;
        const a = at.clone().addScaledVector(along, -gap), b = at.clone().addScaledVector(along, gap);
        for (const q of [a, b]) q.y = groundAt(q.x, q.z, at.y + 20) ?? at.y;
        const hero = spawn(heroes[k % heroes.length], hh * (0.92 + Math.random() * 0.16), a, faceYaw(along), { fighter: true });
        const foe = spawn(foes[k % foes.length], fh * (0.92 + Math.random() * 0.16), b, faceYaw(along.clone().negate()), { fighter: true });
        for (const f of [hero, foe]) {
          if (!f.attack.length) continue;
          if (f.idle) f.idle.stop();
          f.swing = Math.random();
          f.attack[0].play();
          f.attack[0].time = Math.random();
        }
        fights.push({ hero, foe, cast: 1 + Math.random() * 3 });
      }
    } else if (v.kind === 'kite') {
      const hm = await loadModel(fileOf(v.hero)), fm = await loadModel(fileOf(v.foe));
      if (!hm || !fm) continue;
      const fh = v.foeHeight || 24;
      height = fh;
      // the whole ring stays off the road: shrink it until it does
      let R2 = R;
      const ringOnRoad = (r) => Array.from({ length: 16 }, (_, k) => k / 16 * Math.PI * 2)
        .some((a) => { const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; const y = groundAt(x, z, c.y + 20) ?? c.y; return onRoadAt(x, z, y); });
      while (R2 > 8 && ringOnRoad(R2)) R2 *= 0.8;
      if (ringOnRoad(R2)) continue;
      const w = 18 / Math.max(10, R2);                  // the runner covers ~18 units a second
      const runner = spawn(hm, v.heroHeight || 6, c.clone(), 0, { fixed: true });
      const giant = spawn(fm, fh, c.clone(), 0, { fixed: true });
      runner.circle = { c, R: R2, ang: 0, w };
      giant.circle = { c, R: R2, ang: -Math.min(1.2, (fh * 0.9 + 8) / R2), w };   // a stride or two behind
      for (const [s2, clip, sp] of [[runner, runner.run, runner.runSpeed], [giant, giant.walk, giant.walkSpeed]]) {
        if (!clip) continue;
        if (s2.idle) s2.idle.stop();
        clip.timeScale = THREE.MathUtils.clamp((w * R2) / sp, 0.4, 2.5);
        clip.play();
      }
    } else if (v.kind === 'raid') {
      // a raid: a ring of player characters round a big monster, the melee close in, the casters
      // further back casting; the monster turns on them and breathes on them now and then
      const heroes = (await Promise.all(v.heroes.map((h) => loadModel(fileOf(h))))).filter(Boolean);
      const fm = (v.foeVariant !== undefined && await loadModel(`${zone}_${v.foe}_v${v.foeVariant}`)) || await loadModel(fileOf(v.foe));
      if (!heroes.length || !fm) continue;
      const fh = v.foeHeight || 40, hh = v.heroHeight || 6.5;
      height = fh;
      const boss = spawn(fm, fh, c.clone(), Math.random() * Math.PI * 2, { fighter: true, raidBoss: true, breath: !!v.breath, cool: 2 + Math.random() * 2, name: v.foeName });
      boss.radius = fh * 0.3;
      if (v.foeName) named.push({ name: v.foeName, actor: boss, pos: c.clone(), height: fh });
      const count = v.count || 18, arc = v.arc ?? Math.PI * 1.6, a0 = Math.random() * Math.PI * 2;
      boss.raid = [];
      for (let k = 0; k < count; k++) {
        const caster = k % 3 === 2;                     // a third of the raid casts from further back
        const ang = a0 + (k / Math.max(1, count - 1) - 0.5) * arc + (Math.random() - 0.5) * 0.12;
        const r = R * (caster ? 1.35 : 1) + (Math.random() - 0.5) * 4;
        const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
        const y = groundAt(x, z, c.y + 20);
        if (y === null || Math.abs(y - c.y) > 20 || onRoadAt(x, z, y)) continue;
        const at = new THREE.Vector3(x, y, z);
        const h = spawn(heroes[k % heroes.length], hh * (0.92 + Math.random() * 0.16), at, faceYaw(c.clone().sub(at).setY(0).normalize()),
          { fighter: true, caster });
        if (h.attack.length) { h.idle?.stop(); h.swing = Math.random() * 2; h.attack[0].play(); h.attack[0].time = Math.random(); }
        boss.raid.push(h);
        fights.push({ hero: h, foe: boss, cast: (caster ? 1 : 4) + Math.random() * 4 });
      }
      if (boss.attack.length) { boss.idle?.stop(); boss.swing = 0; boss.attack[0].play(); }
    } else if (v.kind === 'train' && v.route?.length > 1) {
      // a monk "training" a pack down a hall: he runs the planned route end to end and back, the
      // pack strung out along his trail
      const hm = await loadModel(fileOf(v.hero)), fm = await loadModel(fileOf(v.foe));
      if (!hm || !fm) continue;
      const route = v.route.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
      const cum = [0];
      for (let k = 1; k < route.length; k++) cum.push(cum[k - 1] + route[k].distanceTo(route[k - 1]));
      const fh = v.foeHeight || 8;
      height = Math.max(fh, 6);
      c = route[Math.floor(route.length / 2)].clone();
      const runner = spawn(hm, v.heroHeight || 6, route[0].clone(), 0, { fixed: true });
      if (runner.run) { runner.idle?.stop(); runner.run.timeScale = THREE.MathUtils.clamp(20 / runner.runSpeed, 0.5, 2); runner.run.play(); }
      const pack = [];
      for (let k = 0; k < (v.count || 6); k++) {
        const f = spawn(fm, fh * (0.9 + Math.random() * 0.2), route[0].clone(), 0, { fixed: true });
        const clip = f.run || f.walk;
        if (clip) { f.idle?.stop(); clip.timeScale = THREE.MathUtils.clamp(20 / (clip === f.run ? f.runSpeed : f.walkSpeed), 0.5, 2.5); clip.play(); }
        pack.push({ s: f, gap: (fh * 0.9 + 5) * (k + 1.3), side: (Math.random() - 0.5) * fh * 0.6 });
      }
      runner.train = { route, cum, len: cum.at(-1), pos: 0, dir: 1, speed: 20, trail: [], pack };
    } else if (v.kind === 'train') {
      // (no planned route: the old ring) a monk "training" a pack round in a loop
      const hm = await loadModel(fileOf(v.hero)), fm = await loadModel(fileOf(v.foe));
      if (!hm || !fm) continue;
      const fh = v.foeHeight || 8;
      height = Math.max(fh, 6);
      let R2 = R;
      const ringOnRoad = (r) => Array.from({ length: 24 }, (_, k) => k / 24 * Math.PI * 2)
        .some((a) => { const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; const y = groundAt(x, z, c.y + 20) ?? c.y; return onRoadAt(x, z, y) || Math.abs(y - c.y) > 15; });
      while (R2 > 10 && ringOnRoad(R2)) R2 *= 0.85;
      if (ringOnRoad(R2)) {
        const bad = Array.from({ length: 24 }, (_, k) => k / 24 * Math.PI * 2).map((a) => { const x = c.x + Math.cos(a) * R2, z = c.z + Math.sin(a) * R2; const y = groundAt(x, z, c.y + 20); return [Math.round(x), Math.round(z), y === null ? null : Math.round(y), y !== null && onRoadAt(x, z, y)]; });
        console.warn(`vignette "${v.title}": no room for its ring at ${c.toArray().map(Math.round)} (r ${R2.toFixed(0)})`, JSON.stringify(bad.filter((b) => b[2] === null || b[3] || Math.abs(b[2] - c.y) > 15).slice(0, 6)));
        continue;
      }
      const w = 20 / R2;                               // the monk runs ~20 units a second
      const runner = spawn(hm, v.heroHeight || 6, c.clone(), 0, { fixed: true });
      runner.circle = { c, R: R2, ang: 0, w };
      if (runner.run) { runner.idle?.stop(); runner.run.timeScale = THREE.MathUtils.clamp(20 / runner.runSpeed, 0.5, 2); runner.run.play(); }
      for (let k = 0; k < (v.count || 6); k++) {
        const f = spawn(fm, fh * (0.9 + Math.random() * 0.2), c.clone(), 0, { fixed: true });
        f.circle = { c, R: R2 + (Math.random() - 0.5) * 4, ang: -(fh * 0.9 + 6) / R2 * (k + 1.2), w };
        const clip = f.run || f.walk;
        if (clip) { f.idle?.stop(); clip.timeScale = THREE.MathUtils.clamp(20 / (clip === f.run ? f.runSpeed : f.walkSpeed), 0.5, 2.5); clip.play(); }
      }
    } else if (v.kind === 'herd') {
      const m = await loadModel(fileOf(v.model));
      if (!m) continue;
      height = v.height || 12;
      for (let k = 0; k < (v.count || 3); k++) {
        const at = near(c, R, undefined, true);
        if (!at) continue;
        const s2 = spawn(m, height * (0.9 + Math.random() * 0.2), at, Math.random() * Math.PI * 2, { fixed: true });
        s2.roam = { c, R, target: null, wait: Math.random() * 3 };
      }
    }
    shots.push({ pos: c, height, radius: v.kind === 'raid' ? R * 1.4 : R, title: v.title, follow: v.kind === 'kite' ? placed.slice(-2) : null });
  }
  if (!shots.length && feature) shots.push({ pos: feature.pos.clone(), height: feature.height, radius: 0, actor: feature.actor });

  // --- 4. a crowd at the start / finish: player characters lining both sides of the straight
  {
    const files = ['pc_HUM', 'pc_ELF', 'pc_DWM', 'pc_HIF', 'pc_BAM', 'pc_ERM', 'pc_DAF', 'pc_HOM', 'pc_OGM', 'pc_GNF'];
    const tall = { pc_OGM: 9, pc_BAM: 7, pc_DWM: 4, pc_HOM: 3.5, pc_GNF: 3 };
    const crowd = (await Promise.all(files.map(async (f) => ({ f, m: await loadModel(f) })))).filter((c) => c.m);
    if (crowd.length) {
      for (let step = -14; step <= 16; step += 2) {
        for (const sg of [1, -1]) {
          const c = crowd[Math.floor(Math.random() * crowd.length)];
          const h = (tall[c.f] || 6) * (0.92 + Math.random() * 0.16);
          const i = ((step % track.n) + track.n) % track.n;
          const b = beside(i, track.width + 4 + h * 0.4 + Math.random() * 4, h * 0.3, h, sg);
          if (!b) continue;
          const s = spawn(c.m, h, b.spot, faceYaw(b.out.clone().negate()) + (Math.random() - 0.5) * 0.6, { crowd: true, unarmed: true });
          s.radius = h * 0.2;                              // shoulder to shoulder
          s.next = Math.random() * 4;
        }
      }
    }
  }

  // the mouth: the tip of the jaw (the jaw vertex furthest from its bone), followed through
  // the animation, and the way the snout points (head bone -> jaw tip)
  const jawOf = (s) => {
    // the mouth: the lower jaw's tip and the upper snout's tip (searched over every piece of the
    // model - EQ splits a dragon into a mesh per texture), kept in their bones' spaces so the
    // mouth follows the animation; the breath leaves from between them, just inside
    if (s.jaw !== undefined) return s.jaw;
    s.jaw = null;
    const meshes = [];
    s.npc.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    if (!meshes.length) return null;
    const bones = meshes[0].skeleton.bones;
    const ji = bones.findIndex((b) => /JA_TRACK$/.test(b.name)), hi = bones.findIndex((b) => /HE_TRACK$/.test(b.name));
    if (ji < 0 || hi < 0) return null;
    const v = new THREE.Vector3();
    const jawPts = [], headPts = [];                       // model space at the bind pose
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position'), si = m.geometry.getAttribute('skinIndex');
      for (let k = 0; k < pos.count; k++) {
        const b = si.getX(k);
        if (b !== ji && b !== hi) continue;
        v.fromBufferAttribute(pos, k).applyMatrix4(m.bindMatrix);
        (b === ji ? jawPts : headPts).push(v.clone());
      }
    }
    if (!jawPts.length || !headPts.length) return null;
    const bindOf = (i) => new THREE.Matrix4().copy(meshes[0].skeleton.boneInverses[i]).invert();
    const jawO = new THREE.Vector3().setFromMatrixPosition(bindOf(ji)), headO = new THREE.Vector3().setFromMatrixPosition(bindOf(hi));
    let jawTip = jawPts[0];                                // the lower jaw's tip: furthest from its hinge
    for (const q of jawPts) if (q.distanceTo(jawO) > jawTip.distanceTo(jawO)) jawTip = q;
    const fwd = jawTip.clone().sub(headO).normalize();
    let snout = headPts[0];                                // the upper snout's tip: furthest forward
    for (const q of headPts) if (q.clone().sub(headO).dot(fwd) > snout.clone().sub(headO).dot(fwd)) snout = q;
    const inv = (i) => meshes[0].skeleton.boneInverses[i];
    s.jaw = { bone: bones[ji], head: bones[hi], tip: jawTip.clone().applyMatrix4(inv(ji)), snout: snout.clone().applyMatrix4(inv(hi)) };
    return s.jaw;
  };
  const mouth = (s) => {
    const f = new THREE.Vector3(-Math.sin(s.npc.rotation.y), 0, -Math.cos(s.npc.rotation.y));
    const jaw = jawOf(s);
    if (!jaw) return { at: s.npc.position.clone().add(new THREE.Vector3(0, s.height * 0.72, 0)).addScaledVector(f, s.height * 0.45), dir: f };
    s.npc.updateMatrixWorld(true);
    const lower = jaw.tip.clone().applyMatrix4(jaw.bone.matrixWorld);
    const upper = jaw.snout.clone().applyMatrix4(jaw.head.matrixWorld);
    const head = new THREE.Vector3().setFromMatrixPosition(jaw.head.matrixWorld);
    const tip = lower.clone().lerp(upper, 0.5);            // the middle of the open mouth
    const dir = tip.clone().sub(head);
    const at = tip.clone().lerp(head, 0.12);               // just inside it
    return { at, dir: dir.lengthSq() > 1e-6 ? dir.normalize() : f };
  };
  // a jet of EQ fire from the dragon's mouth to a point on the ground
  function breathe(s, target, eqfx) {
    if (!eqfx) return;
    s.cool = 6 + Math.random() * 4;
    const jets = 9;
    for (let j = 0; j < jets; j++) (s.jets ??= []).push({ t: -j * 0.14, target: target.clone(), eqfx, fx: null });
    const clip = s.fidget;                            // (T06 flattens a dragon's wing across the floor)
    if (clip) { clip.reset().setLoop(THREE.LoopOnce, 1); clip.clampWhenFinished = false; clip.play(); }
  }

  function update(dt, karts = [], eqfx = null) {
    for (const s of placed) {
      s.mixer.update(dt);
      if (s.jets) {
        for (const j of s.jets) {
          j.t += dt;
          if (j.t < 0) continue;
          if (!j.from) {                                     // leaves the mouth where it is now, out along the snout
            const m = mouth(s);
            const toT = j.target.clone().sub(m.at);
            j.len = toT.length();
            j.from = m.at;
            j.dir = m.dir.clone().multiplyScalar(0.7).add(toT.normalize().multiplyScalar(0.3)).normalize();   // out along the snout
            j.pos = j.from.clone();
          }
          const u = Math.min(1, j.t / 0.9);
          j.pos = j.from.clone().addScaledVector(j.dir, j.len * u);
          if (!j.fx) { j.a = pointAnchor(() => j.pos, () => j.dir); j.fx = j.eqfx.play('fireball', 1, j.a, 0.9); j.eqfx.play('fireball', 2, j.a, 0.9); }
          if (u >= 1 && !j.done) { j.done = true; j.fx.stop(); j.eqfx.play('fireball', 2, j.a, 0.8); }
        }
        s.jets = s.jets.filter((j) => !j.done);
        if (!s.jets.length) s.jets = null;
      }
      if (s.breath && !s.raidBoss) {
        s.cool -= dt;
        if (s.cool <= 0) {
          const near = karts.find((k) => k.pos.distanceTo(s.npc.position) < s.height * 2.2 + 40);
          if (near) breathe(s, near.pos.clone().addScaledVector(near.forward(), 6), eqfx);
        }
      }
      if (s.raidBoss && s.raid?.length) {                   // the raid's monster: turns on one raider, then another
        s.turnT = (s.turnT ?? 0) - dt;
        if (s.turnT <= 0 || !s.target) { s.turnT = 3 + Math.random() * 3; s.target = s.raid[Math.floor(Math.random() * s.raid.length)]; }
        const want = faceYaw(s.target.npc.position.clone().sub(s.npc.position).setY(0).normalize());
        let dy = want - s.npc.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        s.npc.rotation.y += THREE.MathUtils.clamp(dy, -dt * 0.8, dt * 0.8);
        if (s.breath && eqfx && (s.cool -= dt) <= 0 && Math.abs(dy) < 0.3) breathe(s, s.target.npc.position.clone(), eqfx);
      }
      if (s.fighter) {                                       // alternate the attack animations
        if (s.attack.length > 1 && (s.swing -= dt) <= 0) {
          s.swing = 1.5 + Math.random() * 2;
          const [a, b] = s.attack[0].isRunning() ? s.attack : [s.attack[1], s.attack[0]];
          b.reset().play();
          a.crossFadeTo(b, 0.2, false);
        }
        continue;
      }
      if (s.train) {                                         // a training run: down the hall and back
        const T = s.train;
        T.pos += T.dir * T.speed * dt;
        if (T.pos >= T.len || T.pos <= 0) { T.pos = THREE.MathUtils.clamp(T.pos, 0, T.len); T.dir = -T.dir; }
        const at = (d) => {                                  // a point at distance d along the route
          let k = 1;
          while (k < T.cum.length - 1 && T.cum[k] < d) k++;
          const u = (d - T.cum[k - 1]) / ((T.cum[k] - T.cum[k - 1]) || 1);
          return T.route[k - 1].clone().lerp(T.route[k], THREE.MathUtils.clamp(u, 0, 1));
        };
        const p = at(T.pos), ahead = at(THREE.MathUtils.clamp(T.pos + T.dir * 2, 0, T.len));
        s.npc.position.copy(p);
        const fwd = ahead.clone().sub(p).setY(0);
        if (fwd.lengthSq() > 1e-4) s.npc.rotation.y = faceYaw(fwd.normalize());
        T.trail.push({ p: p.clone(), yaw: s.npc.rotation.y, d: (T.trail.at(-1)?.d ?? 0) + (T.trail.length ? p.distanceTo(T.trail.at(-1).p) : 0) });
        if (T.trail.length > 600) T.trail.shift();
        for (const m of T.pack) {                            // each one where the monk was, a stride or two back
          const want = T.trail.at(-1).d - m.gap;
          let k = T.trail.length - 1;
          while (k > 0 && T.trail[k].d > want) k--;
          const q = T.trail[k];
          const side = new THREE.Vector3(Math.cos(q.yaw), 0, -Math.sin(q.yaw)).multiplyScalar(m.side);
          m.s.npc.position.copy(q.p).add(side);
          m.s.npc.rotation.y = q.yaw;
        }
        continue;
      }
      if (s.circle) {                                        // kiting: round and round
        const C = s.circle;
        C.ang += C.w * dt;
        const x = C.c.x + Math.cos(C.ang) * C.R, z = C.c.z + Math.sin(C.ang) * C.R;
        const gy = groundAt(x, z, s.npc.position.y + 15);
        s.npc.position.set(x, gy ?? s.npc.position.y, z);
        s.npc.rotation.y = faceYaw(new THREE.Vector3(-Math.sin(C.ang), 0, Math.cos(C.ang)));
        continue;
      }
      if (s.roam) {                                          // wander about, stop, wander on
        const W = s.roam;
        if (W.wait > 0) {
          W.wait -= dt;
          if (W.wait <= 0) {
            const to = near(W.c, W.R, undefined, true);    // somewhere off the road
            if (!to) { W.wait = 2; continue; }
            W.target = to;
            if (s.walk) { s.walk.reset(); s.walk.timeScale = 0.7; s.walk.play(); s.idle?.stop(); }
          }
          continue;
        }
        const d = W.target.clone().sub(s.npc.position).setY(0);
        if (d.length() < 1) {
          W.wait = 2 + Math.random() * 4;
          if (s.walk) { s.walk.stop(); s.idle?.reset().play(); }
          continue;
        }
        d.normalize();
        const next = s.npc.position.clone().addScaledVector(d, s.walkSpeed * 0.7 * dt);   // in step with the walk cycle
        const gy = groundAt(next.x, next.z, s.npc.position.y + 15);
        if (gy === null || Math.abs(gy - s.npc.position.y) > 8 || onRoadAt(next.x, next.z, gy)) {   // a drop, a wall or the road: stop
          W.wait = 1;
          if (s.walk) { s.walk.stop(); s.idle?.reset().play(); }
          continue;
        }
        s.npc.position.set(next.x, gy, next.z);
        s.npc.rotation.y = faceYaw(d);
        continue;
      }
      if (s.patrol) {
        const P = s.patrol;
        const target = P.toB ? P.b : P.a;
        const d = target.clone().sub(s.npc.position).setY(0);
        if (d.length() < 0.8) P.toB = !P.toB;
        else {
          d.normalize();
          const nextP = s.npc.position.clone().addScaledVector(d, P.speed * dt);
          const gy = ground(collider, nextP);
          if (gy === null || Math.abs(gy - s.npc.position.y) > 6) P.toB = !P.toB;      // edge or wall: turn round
          else { s.npc.position.copy(nextP).setY(gy); s.npc.rotation.y = faceYaw(d); }
        }
        continue;
      }
      s.next -= dt;                                          // now and then play the fidget once
      if (s.next <= 0 && s.fidget && s.idle && s.fidget !== s.idle) {
        s.next = s.crowd ? 2 + Math.random() * 4 : 6 + Math.random() * 8;
        s.fidget.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.3).play();
        s.idle.crossFadeTo(s.fidget, 0.3, false);
        const f = s.fidget, idle = s.idle;
        setTimeout(() => f.crossFadeTo(idle.reset().play(), 0.4, false), f.getClip().duration * 1000);
      }
    }
    if (eqfx) {
      for (const f of fights) {                              // heroes cast real EQ spells at their foes
        if ((f.cast -= dt) > 0) continue;
        f.cast = 4 + Math.random() * 7;
        if (!karts.some((k) => k.pos.distanceTo(f.hero.npc.position) < 260)) continue;
        const kind = ['fireball', 'lightning', 'snare', 'wolf'][Math.floor(Math.random() * 4)];
        const mid = (s) => pointAnchor(() => s.npc.position.clone().add(new THREE.Vector3(0, s.height * 0.55, 0)));
        eqfx.play(kind, 0, mid(f.hero), 0.9);
        eqfx.play(kind, 2, mid(kind === 'wolf' ? f.hero : f.foe), 1.4);
      }
    }
  }
  return { placed, fights, feature, shots, update, breathe: (s, target, eqfx) => breathe(s, target, eqfx) };
}
