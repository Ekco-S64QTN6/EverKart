import * as THREE from 'three';
import { loadZone, cast, makeSky, addToCollider, DAY_MINUTES } from './world.js';
import { carveZone } from './roadbed.js';
import { Sfx } from './sfx.js';
import { Kart, seatDriver, animateKart } from './kart.js';
import { Track, Driver, updateProgress, raceDistance } from './race.js';
import { placeNpcs } from './npcs.js';
import { ItemSystem, SPELLS } from './items.js';
import { readControls, readMenu, rumble as padRumble } from './input.js';
import { buildCourse, keepInside, makeMinimap } from './course.js';
import { Fx, LOOKS } from './particles.js';
import { EqFx, kartAnchor } from './eqfx.js';
import { RACERS, TRACKS, showResults, loadRacers, opponents, racerLabel } from './ui.js';
import { startFrontend, campaignRace, recordCampaignRace } from './frontend/frontend.js';
import { settings, onSetting, DIFFICULTY } from './settings.js';

const params = new URLSearchParams(location.search);
// errors anywhere end up in the console (and so in the desktop app's log file)
addEventListener('error', (e) => console.error('[error]', e.message, e.filename ? `${e.filename}:${e.lineno}` : '', e.error?.stack || ''));
addEventListener('unhandledrejection', (e) => console.error('[unhandled]', e.reason?.stack || e.reason));
let LAPS = parseInt(params.get('laps') || '0', 10);
const COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd4ac0d, 0x8e44ad, 0xe67e22, 0x16a085, 0x7f8c8d];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
const pixelRatio = () => Math.min(devicePixelRatio, 2) * settings().renderScale;   // the options' render resolution
renderer.setPixelRatio(pixelRatio());
onSetting((k) => { if (k === 'renderScale') { renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight); } });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.5, 8000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});


const hud = {
  root: document.getElementById('hud'), lap: document.getElementById('lap'), time: document.getElementById('time'),
  pos: document.getElementById('pos'), msg: document.getElementById('msg'), title: document.getElementById('title'),
  item: document.getElementById('item'), best: document.getElementById('best'),
};
const fmt = (s) => `${Math.floor(s / 60)}'${(s % 60).toFixed(2).padStart(5, '0')}"`;
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th');

async function start(trackName, racer = { code: 'HUM', armor: 3 }, opts = {}) {
  const tLoad = performance.now();
  const S = settings();
  const camp = opts.campaign ? campaignRace() : null;                    // a race of the campaign
  const level = DIFFICULTY[camp ? camp.difficulty : S.difficulty] || DIFFICULTY[1];
  window.everkart?.log?.(`[race] ${trackName} racer ${racer.code}_${racer.armor} ${innerWidth}x${innerHeight} ${navigator.getGamepads?.().filter(Boolean).map((g) => g.id).join(', ') || 'no pad'}`);
  hud.root.hidden = params.has('nohud');
  hud.msg.textContent = 'Loading…';
  const data = await (await fetch(`tracks/${trackName}.json`)).json();
  const track = new Track(data);
  if (!LAPS) LAPS = S.laps;                                             // the options' laps (0: the track's own)
  if (!LAPS || data.open) LAPS = data.open ? 1 : data.laps || 3;   // an open course is run once
  track.laps = LAPS;
  const zone = await loadZone(data.zone, params);
  track.measure(zone.collider, cast);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(zone.look.sky);
  scene.fog = new THREE.Fog(...zone.look.fog);
  camera.far = zone.look.far;                                     // the zone's own view distance
  camera.updateProjectionMatrix();
  scene.add(zone.visual, zone.collider);
  const sky = zone.look.outdoor ? makeSky(zone.look.dome) : null;
  if (sky) { sky.scale.setScalar((zone.look.far * 0.9) / 5000); scene.add(sky); }   // inside the view distance
  // karts and NPCs (the zone is unlit, its light baked in): EQ lights characters almost evenly, so
  // a strong ambient under a gentle sky / ground split - a dragon's wing seen from below is not black
  const hemi = new THREE.HemisphereLight(0xfff2dd, 0x8a7458, 1.1);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);
  const fill = new THREE.PointLight(0xfff0dd, 0, 140, 1.2);   // the intro's scene shots (karts and NPCs only: the zone is unlit)
  scene.add(fill);   // lights karts and NPCs (zone has baked light)
  // zone music (EQ's own MIDI, rendered with a General MIDI soundfont)
  if (data.music && !params.has('mute')) {
    const music = new Audio(`music/${data.music}`);
    music.loop = true;
    music.volume = 0.85 * S.musicVolume;
    music.play().catch(() => addEventListener('keydown', () => music.play(), { once: true }));
    window.__ekMusic = music;
  }
  hud.title.textContent = data.title;
  const course = buildCourse(scene, track, zone.collider, cast, zone.visual);
  // the road is the zone's own ground, shaped to the road bed (the karts drive on it)
  if (!params.has('nocarve')) carveZone(zone.visual, zone.collider, course.userData.roadQuery, (o, d, far) => cast(zone.collider, o, d, far));
  addToCollider(zone.collider, course.userData.roadGeometry);   // the karts drive on the road
  const npcs = await placeNpcs(scene, track, zone.collider, data.zone);   // on the ground as cut for the road
  // the hour of the day dims the zone, the course, the fog and the light on the karts together
  const courseMats = [];
  course.traverse((o) => { if (o.material?.color) courseMats.push([o.material, o.material.color.clone()]); });
  const fogBase = new THREE.Color(zone.look.sky);
  let lastLight = -1;
  function setLight(l) {
    if (Math.abs(l - lastLight) < 0.004) return;
    lastLight = l;
    zone.setLight(l);
    const L = Math.pow(l, 2.2);                    // l is display brightness; colours are linear
    for (const [m, base] of courseMats) m.color.copy(base).multiplyScalar(L);
    scene.fog.color.copy(fogBase).multiplyScalar(L);
    scene.background.copy(scene.fog.color);
    hemi.intensity = 1.1 * (0.4 + 0.6 * l);
    ambient.intensity = 0.9 * (0.4 + 0.6 * l);
  }
  setLight(1);
  const drawMinimap = makeMinimap(track);
  if (!S.minimap) document.getElementById('minimap').style.display = 'none';
  window.everkart?.log?.(`[race] ${trackName} zone and course ready in ${Math.round(performance.now() - tLoad)} ms`);

  // you start at the back of the grid (like a GP), the other seven racers ahead
  if (!RACERS.length) await loadRacers();
  const you = { ...racer, name: 'You', info: RACERS.find((r) => r.code === racer.code) };
  // the field: the campaign's rivals (the same all cup), or a fresh one
  let rivals = camp ? camp.field.map((f) => ({ ...f, info: RACERS.find((r) => r.code === f.code) })).filter((f) => f.info) : [];
  if (rivals.length < data.grid.length - 1) rivals = [...rivals, ...opponents(racer, data.grid.length - 1 - rivals.length)];
  const field = [you, ...rivals.slice(0, data.grid.length - 1)];
  // data.grid runs from the front row back; karts[0] is you, so take the slots last-first
  const slots = [...data.grid].reverse();
  const karts = slots.map((p, i) => {
    const k = new Kart(COLORS[i], field[i].name);
    k.entry = field[i];
    k.colorHex = COLORS[i].toString(16).padStart(6, '0');
    // stand on the real ground (the grid heights come from the smoothed racing line)
    const gHit = cast(zone.collider, new THREE.Vector3(p[0], p[1] + 25, p[2]), new THREE.Vector3(0, -1, 0), 60);
    k.place(gHit ? [p[0], gHit.point.y + 0.6, p[2]] : p, data.heading);
    if (track.open) {                 // point to point: the grid is the start of the path
      k.progress = track.nearest(k.pos, Math.max(0, track.start - 20)).index;
      k.lap = 0;
    } else {
      k.progress = track.nearest(k.pos, track.n - 1).index;   // where its slot really is: the back row is last
      if (k.progress < track.n / 2) k.progress = track.n - 1;    // (never past the line)
      k.lap = -1;                     // crossing the line starts lap 0
    }
    scene.add(k.mesh);
    return k;
  });
  await Promise.all(karts.map((k) => seatDriver(k, { code: k.entry.code, armor: k.entry.armor }, k.entry.info)));
  const standings = () => [...karts].sort((a, b) => (b.finished && a.finished ? a.finishTime - b.finishTime
    : b.finished ? 1 : a.finished ? -1 : raceDistance(b, track) - raceDistance(a, track)));
  const fx = new Fx(scene, renderer, camera);
  await fx.load();
  const eqfx = new EqFx(scene, renderer, camera);
  await eqfx.load();
  const sfx = new Sfx(!params.has('mute'));          // EverQuest's own sound effects
  await sfx.load();
  if (sfx.master) sfx.master.gain.value = 0.8 * S.sfxVolume;
  const items = new ItemSystem(scene, track, karts, standings, fx, eqfx);
  items.sfx = sfx;
  const rolling = sfx.play('kart', { vol: 0, loop: true });  // your kart: the mine cart rolling
  let lastCount = null, bumpCool = 0, lastSpeed = 0;
  const player = karts[0];
  const auto = params.has('autopilot');
  const drivers = karts.map((k, i) => (i === 0 && !auto ? null :
    new Driver(k, track, ((i % 3) - 1) * 0.8, i === 0 ? 0.95 : Math.min(1, level.skill + 0.06 * Math.random()))));
  for (const d of drivers) if (d) { d.rival = player; d.bandScale = level.band; }   // CPUs measure the gap to you

  // intro, as kart racers do it: a flyover down the course - a drone's runs along the road past
  // each of its sights (Hoshkar on his island, the raid, the monk's train, Phara Dar), cut
  // together in course order - then one crane move over the grid, from high in front of the field
  // down past the racers into your chase camera, and the 3-2-1. The camera never holds still.
  const shots = npcs.shots || [];
  const PASS_T = 3.6, PASS_SPEED = 52;             // seconds per run down the road, units a second
  const along = [0];
  for (let i = 1; i < track.n; i++) along.push(along[i - 1] + track.path[i].distanceTo(track.path[i - 1]));
  const stepLen = along[track.n - 1] / (track.n - 1);
  const pathAt = (k) => {                          // a point on the line at a fractional path index
    const i = Math.floor(k), u = k - i;
    return track.path[track.idx(i)].clone().lerp(track.path[track.idx(i + 1)], u);
  };
  const passes = (() => {
    const N = (PASS_T * PASS_SPEED) / stepLen;     // path points one run covers
    const nearestIdx = (p) => {
      let j = 0, bd = Infinity;
      for (let i = 0; i < track.n; i++) {
        const q = track.path[i], d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + ((q.y - p.y) * 3) ** 2;
        if (d < bd) { bd = d; j = i; }
      }
      return j;
    };
    const span = (j) => {                          // approach the sight, pass it
      let k0 = j - N * 0.8, k1 = j + N * 0.2;
      if (track.open) { if (k0 < 0) { k1 -= k0; k0 = 0; } if (k1 > track.n - 2) { k0 -= k1 - (track.n - 2); k1 = track.n - 2; } k0 = Math.max(0, k0); }
      return [k0, k1];
    };
    const out = shots.map((F) => {
      const j = nearestIdx(F.pos), k = span(j);
      // stop a good way short of it (a dragon fills the lens up close): back off the whole run
      const clear = F.height * 1.6 + (F.radius || 0);
      while (k[1] > 1 && pathAt(k[1]).distanceTo(F.pos) < clear && (!track.open || k[0] > 0)) { k[0] -= 1; k[1] -= 1; }
      if (track.open) k[0] = Math.max(0, k[0]);
      return { j, F, k };
    });
    // a course with few sights: runs down its most open stretches as well
    for (const f of [0.3, 0.6, 0.85]) {
      if (out.length >= 3) break;
      const j = Math.floor(f * (track.n - 1));
      if (out.every((o) => Math.abs(o.j - j) > N)) out.push({ j, F: null, k: span(j) });
    }
    out.sort((a, b) => a.j - b.j);
    return out.filter((o, i) => i === 0 || o.j - out[i - 1].j > N * 0.5).slice(0, 5);
  })();
  for (const ps of passes) {                       // its height over the road: a drone's, under any roof
    const [k0, k1] = ps.k, hs = [];
    for (let i = Math.floor(k0); i <= Math.ceil(k1) + 1; i++) {
      const p = track.path[track.idx(i)].clone().add(new THREE.Vector3(0, 2, 0));
      const roof = cast(zone.collider, p, new THREE.Vector3(0, 1, 0), 40);
      hs.push(roof ? Math.max(4, roof.distance - 4) : 18);
    }
    const lo = hs.map((_, i) => Math.min(...hs.slice(Math.max(0, i - 4), i + 5)));
    ps.h = lo.map((_, i) => { const w = lo.slice(Math.max(0, i - 3), i + 4); return Math.min(18, w.reduce((a, b) => a + b, 0) / w.length); });
    ps.i0 = Math.floor(k0);
  }
  const FLY = passes.length * PASS_T;
  const GRID_T = 5.5;                              // the crane move over the grid
  const INTRO = auto || params.has('nointro') || !S.intro ? 0 : FLY + GRID_T;
  // skipping the intro: Enter, Space, Esc, or A / Start on a pad - its own listener, so no other
  // screen's input polling can swallow the press
  let skip = false;
  const onSkipKey = (e) => { if (['Enter', ' ', 'Escape'].includes(e.key)) skip = true; };
  addEventListener('keydown', onSkipKey);
  const padDown = () => { const p = navigator.getGamepads?.().find((g) => g?.connected); return !!p && [0, 9].some((b) => p.buttons[b]?.pressed); };
  let padWasDown = padDown();                       // a button still held from the menu does not count
  const skipAsked = () => {
    const d = padDown();
    if (d && !padWasDown) skip = true;
    padWasDown = d;
    if (!skip) return false;
    skip = false;
    removeEventListener('keydown', onSkipKey);
    return true;
  };
  let t = -3.5 - INTRO;
  let last = performance.now();
  const camPos = new THREE.Vector3();             // where the camera is drawn from
  const camIdeal = new THREE.Vector3();           // where it would be with nothing in the way (smoothed)
  let camReach = null;                            // how far behind the kart it may be (walls pull it in)
  const look = new THREE.Vector3();
  let finishedAt = null;
  let resultsShown = false;
  let camYaw = null;
  let paused = false;
  const pauseEl = document.getElementById('pause');
  const pauseButtons = [...pauseEl.querySelectorAll('button')];
  let pauseSel = 0;
  function togglePause() {
    paused = !paused;
    pauseEl.hidden = !paused;
    pauseSel = 0;
    pauseButtons[0].focus();
    if (window.__ekMusic) paused ? window.__ekMusic.pause() : window.__ekMusic.play().catch(() => {});
    sfx.pause(paused);
  }
  function pauseMenu() {
    const m = readMenu();
    if (m.up || m.down) {
      pauseSel = (pauseSel + (m.down ? 1 : -1) + pauseButtons.length) % pauseButtons.length;
      pauseButtons[pauseSel].focus();
    }
    if (m.back) togglePause();
    if (m.ok) document.activeElement?.click();
  }
  pauseEl.querySelector('[data-act=resume]').onclick = () => togglePause();
  pauseEl.querySelector('[data-act=restart]').onclick = () => { location.search = camp ? '?campaign' : `?track=${trackName}&racer=${racer.code}_${racer.armor}`; };
  pauseEl.querySelector('[data-act=title]').onclick = () => { location.search = '?menu'; };
  pauseEl.querySelector('[data-act=quit]').onclick = () => (window.everkart?.quit ? window.everkart.quit() : window.close());
  window.__ek = { karts, track, player, scene, camera, npcs, zone, sfx, eqfx, cast, decorOnRoad: course.userData.decorOnRoad, road: course.userData.roadDebug, groundAt: (x, y, z) => cast(zone.collider, new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0), 60)?.point.y ?? null, npcCount: npcs.placed.length, fights: npcs.fights.length };

  // debug: what is drawn at a screen pixel (tools: which mesh / material is that?)
  window.__pick = (px, py) => {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
    return rc.intersectObjects(scene.children, true).filter((h) => h.object.visible && h.object !== zone.collider).slice(0, 4)
      .map((h) => ({ name: h.object.name, parent: h.object.parent?.name, type: h.object.type, d: Math.round(h.distance), mat: h.object.material?.type,
        map: h.object.material?.map?.name || !!h.object.material?.map, color: h.object.material?.color?.getHexString(), y: +h.point.y.toFixed(1) }));
  };
  // under the ground: the first surface above `p` (within `margin` + 60) faces up, i.e. a floor
  // seen from below. Returns that hit (null when clear). Ceilings face down and do not count.
  const UPV0 = new THREE.Vector3(0, 1, 0);
  function buried(p, margin) {
    const hit = cast(zone.collider, p.clone().add(new THREE.Vector3(0, -margin, 0)), UPV0, 60 + margin);
    if (!hit) return null;
    const ny = hit.face.normal.clone().transformDirection(zone.collider.matrixWorld).y;
    return ny > 0.2 ? hit : null;
  }

  // the race loop never stops on an unexpected error: it is logged (once per message) and the
  // race carries on - a frozen screen is the worst failure a game can have
  const seenErrors = new Set();
  function frame(now) {
    try { step(now); } catch (e) {
      const msg = String(e?.stack || e);
      if (!seenErrors.has(msg)) { seenErrors.add(msg); console.error('[race loop]', msg); window.everkart?.log?.(`[race loop] ${msg}`); }
      requestAnimationFrame(frame);
    }
  }
  function step(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));   // (a frame's timestamp can be a hair before the last clock reading)
    last = now;
    t += dt;
    const ctl = readControls();
    if (ctl.pausePressed && !player.finished && t >= -3.5) togglePause();   // (during the intro Start skips it)
    if (paused) {
      pauseMenu();
      last = performance.now();
      requestAnimationFrame(frame);
      return;
    }
    if (player.finished && !drivers[0]) drivers[0] = new Driver(player, track, 0, 0.8);   // cruise after the line
    if (t >= 0) {
      if (!drivers[0]) {
        player.input.throttle = ctl.throttle;
        player.input.steer = ctl.steer;
        player.input.drift = ctl.drift;
        if (ctl.itemPressed && player.item) items.use(player);
      }
      for (const d of drivers) if (d) d.update(dt);
      if (params.get('give') && t > 2) {               // debug: test a spell (on you, or on kart giveTo)
        const g = karts[parseInt(params.get('giveTo') || '0', 10)];
        if (!g.item) { g.item = params.get('give'); g.itemTimer = 1.5; }
      }
      items.preUpdate(dt, (k) => k !== player || !!drivers[0]);
    }
    if (t >= 0) {
      for (const k of karts) {
        k.update(dt, zone.collider);
        updateProgress(k, track);
        // off the track (not over the road or its kerbs): the ground slows a kart down
        k.offRoad = !course.userData.roadQuery.at(k.pos.x, k.pos.y - 1, k.pos.z, true)?.inner;
        keepInside(k, track);
        // fell off, wandered far, or stuck for 4 s: put back on the line a little ahead
        const dist = raceDistance(k, track);
        if (k.bestDist === undefined || dist > k.bestDist) { k.bestDist = dist; k.bestAt = t; }
        // CPU karts that make no progress for 4 s are put back on the line; you never are (sitting
        // still is your choice - R rescues you when you are really stuck)
        const stuck = t - k.bestAt > 4 && !k.finished && !!drivers[karts.indexOf(k)];
        const asked = k === player && !drivers[0] && ctl.rescuePressed;
        const lost = k.pos.y < track.path[k.progress].y - 120 || k.offTrack > track.width * 4 || stuck || asked;
        if (lost) {
          const i = track.idx(k.lastGood + (stuck || asked ? 8 : 0));
          k.lastGood = i;
          k.bestAt = t;
          k.rescues = (k.rescues || 0) + 1;
          (window.__ek.rescueAt ??= []).push([k.progress, Math.round(k.pos.x), Math.round(k.pos.y), Math.round(k.pos.z), stuck ? 'stuck' : 'lost']);
          const p = track.path[i];
          const tan = track.tangent(i);
          k.place([p.x, p.y + 4, p.z], Math.atan2(tan.x, -tan.z));
          k.progress = i;
        }
        if (k.lap >= LAPS && !k.finished) {
          k.finished = true;
          if (k === player) sfx.play('ding', { vol: 0.9 });          // EQ's level-up ding
          k.finishTime = t;
        }
      }
    }
    if (t >= 0) items.update(dt);
    if (player.spin > 0 && !player.wasSpinning) padRumble(0.8, 300);      // the controller shakes
    player.wasSpinning = player.spin > 0;
    if (player.turbo > 0 && !player.hadTurbo) padRumble(0.35, 150);
    player.hadTurbo = player.turbo > 0;
    // karts bump each other
    for (let a = 0; a < karts.length; a++) {
      for (let b = a + 1; b < karts.length; b++) {
        const A = karts[a].pos, B = karts[b].pos;
        const dx = B.x - A.x, dz = B.z - A.z, dy = Math.abs(B.y - A.y);
        const d = Math.hypot(dx, dz);
        if (d < 5.5 && d > 1e-3 && dy < 5) {
          const push = (5.5 - d) / 2;
          A.x -= (dx / d) * push; A.z -= (dz / d) * push;
          B.x += (dx / d) * push; B.z += (dz / d) * push;
          karts[a].speed *= 0.98; karts[b].speed *= 0.98;
        }
      }
    }
    // camera: follows the kart's heading with a little lag, wider view at speed
    camYaw ??= player.yaw;
    let dy = player.yaw - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * Math.min(1, dt * 6);
    const fwd = new THREE.Vector3(Math.sin(camYaw), 0, -Math.cos(camYaw));
    // big races (ogres, trolls, barbarians) sit tall in the cart: lift the camera over them
    const tall = Math.max(0, ((player.racer?.info?.height) || 6) - 6);
    const want = player.pos.clone().addScaledVector(fwd, -14 - tall * 0.8).add(new THREE.Vector3(0, 6 + tall * 1.3, 0));
    camIdeal.lerp(want, t < -3 ? 1 : 1 - Math.pow(0.0005, dt));
    const intro = t < -3.5;
    if (intro && (skipAsked() || readMenu().ok)) t = -3.5;   // skip the intro
    const fov = 70 + 14 * Math.min(1, Math.max(0, player.speed) / 80) + (player.turbo > 0 || player.boost > 0 ? 6 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    // keep the camera inside the zone: in front of walls, above the floor
    const head = player.pos.clone().add(new THREE.Vector3(0, 5 + tall, 0));
    // a wall (or the zone-in's pedestal) behind the kart pulls the camera in at once; it eases
    // back out only as the way clears - never snapping in and out from one frame to the next
    const toCam = camIdeal.clone().sub(head);
    const dist = toCam.length();
    toCam.normalize();
    const blocked = cast(zone.collider, head, toCam, dist + 2);
    const allowed = blocked ? Math.max(2, blocked.distance - 2) : dist;
    camReach = camReach === null || t < -3 || allowed < camReach ? Math.min(allowed, dist) : Math.min(dist, camReach + (allowed - camReach) * Math.min(1, dt * 2.5));
    camPos.copy(head).addScaledVector(toCam, camReach);
    // never below the ground (downhill, the slope behind the kart is higher than the kart):
    // look down from above head height, but from under any ceiling
    const UPV = new THREE.Vector3(0, 1, 0), DOWNV = new THREE.Vector3(0, -1, 0);
    let topY = Math.max(camPos.y, head.y) + 8;
    const roof = cast(zone.collider, camPos, UPV, topY - camPos.y);
    if (roof) topY = roof.point.y - 0.3;
    const floor = cast(zone.collider, new THREE.Vector3(camPos.x, topY, camPos.z), DOWNV, topY - camPos.y + 30);
    if (floor && camPos.y < floor.point.y + 2.5) camPos.y = Math.min(floor.point.y + 2.5, topY);
    camera.position.copy(camPos);
    for (const k of karts) if (k !== player) k.mesh.visible = k.pos.distanceTo(camPos) > 6;   // never look through a kart
    look.copy(player.pos).addScaledVector(fwd, 14).add(new THREE.Vector3(0, 3.5, 0));
    camera.lookAt(look);
    if (intro) {
      const ti = t + 3.5 + INTRO;                     // seconds into the intro
      const keepOut = (pos, from) => {                // not through a wall, not under the ground
        const dir = pos.clone().sub(from);
        const wall = cast(zone.collider, from, dir.clone().normalize(), dir.length());
        if (wall) pos.copy(from).addScaledVector(dir.normalize(), Math.max(1, wall.distance - 1.5));
        const floor = buried(pos, 2);
        if (floor) pos.y = floor.point.y + 2;
        return pos;
      };
      if (ti < FLY) {                                 // 1. the flyover: runs down the road past the sights
        const pi = THREE.MathUtils.clamp(Math.floor(ti / PASS_T), 0, passes.length - 1), ps = passes[pi], F = ps.F;
        const u = THREE.MathUtils.clamp((ti - pi * PASS_T) / PASS_T, 0, 1);
        const [k0, k1] = ps.k, k = k0 + (k1 - k0) * u;
        const P = pathAt(k), T = pathAt(k + 1).sub(pathAt(k - 1)).setY(0).normalize();
        const side = new THREE.Vector3(-T.z, 0, T.x);
        const hi = k - ps.i0, h0 = ps.h[Math.max(0, Math.floor(hi))] ?? 12, h1 = ps.h[Math.max(0, Math.ceil(hi))] ?? h0;
        const h = h0 + (h1 - h0) * (hi - Math.floor(hi));
        // the sight: where it stands (moving subjects: where they are now)
        let at = null;
        if (F) {
          at = F.follow ? F.follow.reduce((acc, f) => acc.add(f.npc.position), new THREE.Vector3()).divideScalar(F.follow.length) : F.pos.clone();
          at.y += F.lookH || F.height * 0.5;
        }
        // fly down the road a little to the far side of the sight (it stays in frame), looking down
        // the road and turning to the sight as it comes up
        const sg = at ? -Math.sign(at.clone().sub(P).dot(side)) || 1 : 0;
        const room = sg > 0 ? (track.roadWR?.[Math.round(k)] ?? 10) : (track.roadWL?.[Math.round(k)] ?? 10);
        const pos = P.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(side, sg * Math.min(10, room * 0.6));
        keepOut(pos, P.clone().add(new THREE.Vector3(0, Math.min(h, 4), 0)));
        const ahead = pathAt(k + 16).add(new THREE.Vector3(0, h * 0.35, 0));
        const lookAt = at ? ahead.lerp(at, 0.3 + 0.45 * THREE.MathUtils.smoothstep(u, 0.1, 0.8)) : ahead;
        camera.position.copy(pos);
        camera.lookAt(lookAt);
        camera.fov = 62;
        camera.updateProjectionMatrix();
        if (F?.actor?.breath && !F.fired && u > 0.45) {   // the dragon breathes fire as the drone comes by
          F.fired = true;
          npcs.breathe(F.actor, pathAt(k + 10), eqfx);
        }
        // a soft light on the sight: it reads at dusk and at night too
        if (F) {
          fill.position.copy(pos).lerp(at, 0.55);
          fill.intensity = 30 + 90 * (1 - lastLight);
        } else fill.intensity = 0;
        for (const bx of items.boxes) bx.mesh.visible = false;   // no spell gems in front of the lens
      } else {                                        // 2. the crane move: over the grid into your chase camera
        const u = THREE.MathUtils.clamp((ti - FLY) / GRID_T, 0, 1), e = u * u * u * (u * (u * 6 - 15) + 10);
        if (fill.intensity) { fill.intensity = 0; for (const bx of items.boxes) bx.mesh.visible = bx.respawn <= 0; }
        const f = player.forward(), sd = new THREE.Vector3(-f.z, 0, f.x);
        const mid = karts.reduce((acc, kk) => acc.add(kk.pos), new THREE.Vector3()).divideScalar(karts.length);
        const front = Math.max(...karts.map((kk) => kk.pos.clone().sub(mid).dot(f)));
        const head = player.pos.clone().add(new THREE.Vector3(0, 2.4, 0));
        const lift = (v, y) => v.clone().add(new THREE.Vector3(0, y, 0));
        const A = keepOut(lift(mid, 20).addScaledVector(f, front + 26), lift(mid, 3));     // high, in front of the field
        const B = keepOut(lift(mid, 11).addScaledVector(sd, 6), lift(mid, 3));             // over the middle of it
        const C = keepOut(lift(player.pos, 4).addScaledVector(sd, 7).addScaledVector(f, 5), head);   // beside you
        const crane = new THREE.CatmullRomCurve3([A, B, C, camPos.clone()], false, 'centripetal');
        const lookCurve = new THREE.CatmullRomCurve3([lift(mid, 1), lift(mid, 1.5), head.clone(), look.clone()], false, 'centripetal');
        camera.position.copy(crane.getPoint(e));
        camera.lookAt(lookCurve.getPoint(e));
        camera.fov = 56 + 14 * THREE.MathUtils.smoothstep(u, 0.7, 1);   // into the race lens
        camera.updateProjectionMatrix();
      }
    }
    if (params.has('npc') && npcs.placed.length) {     // look at an NPC (screenshots)
      const s = npcs.placed[parseInt(params.get('npc'), 10) % npcs.placed.length];
      const c = s.npc.position.clone().add(new THREE.Vector3(0, s.height * 0.5, 0));
      const yv = s.npc.rotation.y + (window.__npcView ?? 0);   // from the front, or round the side
      const dir = new THREE.Vector3(-Math.sin(yv), 0, -Math.cos(yv));
      camera.position.copy(c).addScaledVector(dir, s.height * 1.4).add(new THREE.Vector3(0, s.height * 0.15, 0));
      camera.lookAt(c);
    }
    const camAt = window.__camAt ?? (params.has('cam') ? parseInt(params.get('cam'), 10) : null);
    if (camAt !== null) {                         // look down the road at a path point (screenshots)
      const i = track.idx(camAt);
      const a = track.path[track.idx(i - 5)], b = track.path[track.idx(i + 4)];
      const side = window.__camSide ?? 0;         // metres to the right of the line
      const s = track.tangent(i);
      camera.position.set(a.x - s.z * side, a.y + (window.__camUp ?? 5), a.z + s.x * side);
      camera.lookAt(b.x, b.y + 1, b.z);
    }
    if (window.__camFix) window.__camFix();       // a free camera (tools)
    if (window.__top) {                           // straight down on the track (tools/top_shot.mjs)
      const { x, y, z, span, above } = window.__top;
      const h = (span / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.set(x, y + h, z);
      camera.up.set(0, 0, -1);
      camera.lookAt(x, y, z);
      camera.near = Math.max(0.5, h - above);     // nothing higher than `above` over the road
      camera.updateProjectionMatrix();
    }
    if (params.has('showcase')) {                 // look at the grid from the side (screenshots)
      const k = karts[parseInt(params.get('showcase') || '0', 10)];
      const side = new THREE.Vector3(Math.cos(k.yaw), 0, Math.sin(k.yaw));
      camera.position.copy(k.pos).addScaledVector(side, 9).addScaledVector(k.forward(), -5).add(new THREE.Vector3(0, 4.5, 0));
      camera.lookAt(k.pos.clone().add(new THREE.Vector3(0, 2.5, 0)));
    }

    // HUD
    const order = [...karts].sort((a, b) => (b.finished && a.finished ? a.finishTime - b.finishTime
      : b.finished ? 1 : a.finished ? -1 : raceDistance(b, track) - raceDistance(a, track)));
    const place = order.indexOf(player) + 1;
    const ord = ordinal(place);
    hud.pos.innerHTML = `${place}<small>${ord.slice(String(place).length)}</small>`;
    const it = player.item;
    if (hud.item.dataset.kind !== (it || '')) {
      hud.item.dataset.kind = it || '';
      hud.item.innerHTML = it ? `<img src="icons/${SPELLS[it].icon}.png" alt=""><span>${SPELLS[it].name}</span>`
        : '<span class="hint">no spell</span>';
    }
    const done = (k) => Math.round(100 * THREE.MathUtils.clamp((k.progress - track.start) / (track.finish - track.start), 0, 1));
    hud.lap.textContent = track.open ? `${done(player)}% of the way` : `Lap ${Math.min(LAPS, Math.max(1, player.lap + 1))} / ${LAPS}`;
    if (player.lap > (player.lastLap ?? 0) && !track.open) {  // lap times
      const lt = t - (player.lapStart ?? 0);
      if (player.lap >= 1) player.bestLap = Math.min(player.bestLap ?? Infinity, lt);
      player.lapStart = t;
    }
    player.lastLap = player.lap;
    hud.best.textContent = player.bestLap ? `best lap ${fmt(player.bestLap)}` : '';
    const shown = player.finished ? player.finishTime : Math.max(0, t);
    hud.time.textContent = fmt(shown);
    {                                                 // the countdown: a click on 3, 2, 1 and the GO chime
      const count = t >= -3 && t < 0 ? Math.ceil(-t) : t >= 0 && t < 1 ? 0 : null;
      if (count !== lastCount && count !== null) sfx.play(count ? 'tick' : 'go', { vol: count ? 1 : 0.8, rate: count ? 0.9 : 1 });
      lastCount = count;
    }
    {                                                 // your kart's rumble follows its speed; a thud on a wall
      const sp = Math.abs(player.speed);
      rolling.rate(0.55 + Math.min(1.3, sp / 80) * 0.75);
      rolling.volume(t > -3.5 && !player.finished ? 0.08 + 0.32 * Math.min(1, sp / 70) : 0.05);
      bumpCool -= dt;
      if (t > 0 && bumpCool <= 0 && lastSpeed - sp > 14 && !player.spin && player.input.throttle >= 0) {
        sfx.play('bump', { vol: Math.min(1, (lastSpeed - sp) / 30) });
        bumpCool = 0.35;
      }
      lastSpeed = sp;
    }
    sfx.listen(camera);
    hud.root.classList.toggle('intro', t < -3.5);
    // the course's name over the flyover (nothing over the grid: the racers speak for themselves)
    if (t < -3.5 && t + 3.5 + INTRO < FLY) hud.msg.innerHTML = `<div style="position:fixed;left:4vw;bottom:7vh;text-align:left">`
      + `<div style="font-size:52px">${track.data.title || ''}</div>`
      + `<div style="font-size:20px;opacity:.75">${track.open ? 'Start to finish' : `${LAPS} lap${LAPS === 1 ? '' : 's'}`} · Enter / A to skip</div></div>`;
    else if (t < -3.5) hud.msg.innerHTML = '';
    else if (t < 0) hud.msg.textContent = t < -3 ? '' : String(Math.ceil(-t));
    else if (t < 1) hud.msg.textContent = 'GO!';
    else if (player.finished) {
      finishedAt ??= t;
      hud.msg.textContent = t - finishedAt < 4 ? `${ordinal(place)} place!` : '';
      if (t - finishedAt > 4 && !resultsShown) {
        resultsShown = true;
        const rows = order.map((k) => ({ name: k.name, race: racerLabel(k.racer.info, k.racer.armor), you: k === player,
          time: k.finished ? fmt(k.finishTime) : track.open ? `${done(k)}%` : `lap ${Math.max(1, k.lap + 1)}` }));
        const next = TRACKS[(TRACKS.findIndex((x) => x.id === trackName) + 1) % TRACKS.length].id;
        if (camp) {                                    // the campaign: points, then the standings
          recordCampaignRace(order.map((k) => k.name));
          const res = document.getElementById('results');
          res.querySelector('[data-act=again]').hidden = true;
          res.querySelector('[data-act=next]').hidden = true;
          res.querySelector('[data-act=title]').textContent = 'Standings';
          showResults(rows, { again: () => {}, next: () => {}, title: () => { location.search = '?standings'; } });
        } else {
          showResults(rows, {
            again: () => { location.search = `?track=${trackName}&racer=${racer.code}_${racer.armor}`; },
            next: () => { location.search = `?track=${next}&racer=${racer.code}_${racer.armor}`; },
            title: () => { location.search = '?menu'; },
          });
        }
      }
    } else {
      // wrong way: driving against the line for a second
      const tan = track.tangent(player.progress);
      const against = player.vel.x * tan.x + player.vel.z * tan.z < -8;
      player.wrongFor = against ? (player.wrongFor || 0) + dt : 0;
      hud.msg.textContent = player.wrongFor > 1 ? 'WRONG WAY' : '';
    }
    if (params.has('record') && t > -4) {          // tools/ride_check.mjs: every frame of your kart and the camera
      (window.__rec ??= []).push([+t.toFixed(3), player.progress, +player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2),
        +player.vy.toFixed(2), player.onGround ? 1 : 0, +player.speed.toFixed(2), +camera.position.x.toFixed(2), +camera.position.y.toFixed(2),
        +camera.position.z.toFixed(2), player.rescues || 0]);
    }
    window.__ek.state = { t, intro: { passes: passes.length, PASS_T, FLY, GRID_T, INTRO }, place, item: player.item, lap: player.lap, progress: player.progress, speed: player.speed,
      pos: player.pos.toArray(), onGround: player.onGround,
      laps: karts.map((k) => k.lap), progs: karts.map((k) => k.progress), rescues: karts.map((k) => k.rescues || 0) };

    drawMinimap(karts, player);
    for (const k of karts) {
      animateKart(k, dt, now / 1000);
      if (t < 0) continue;
      const back = k.forward().multiplyScalar(-3.3), side = new THREE.Vector3(Math.cos(k.yaw), 0, Math.sin(k.yaw));
      const rear = (s) => k.pos.clone().add(back).addScaledVector(side, 2.3 * s).add(new THREE.Vector3(0, 0.7, 0));
      if (k.drifting && k.charge > 0.25) {
        const c = k.charge >= 2 ? [1, 0.55, 0.15] : k.charge >= 0.9 ? [0.35, 0.65, 1] : [1, 0.95, 0.8];
        LOOKS.driftSpark(fx, rear(1), c);
        LOOKS.driftSpark(fx, rear(-1), c);
      }
      if (k.turbo > 0) { LOOKS.turbo(fx, rear(0.5)); LOOKS.turbo(fx, rear(-0.5)); }
    }
    if (params.get('spell')) {                      // debug: loop a spell's EQ stages on the player
      const [kind, st] = params.get('spell').split(':');
      if ((now / 1600 | 0) !== window.__spellBeat) {
        window.__spellBeat = now / 1600 | 0;
        const stage = parseInt(st || '0', 10);
        if (stage === 1) {
          const pos = player.pos.clone().addScaledVector(player.forward(), 10).add(new THREE.Vector3(0, 3, 0));
          eqfx.play(kind, 1, { basis: () => player.anchor.basis(), point: () => pos }, 1.4);
        } else eqfx.play(kind, stage, player.anchor, 1.4);
      }
    }
    if (params.get('fx')) {                         // debug: show an effect in front of the camera
      const at = player.pos.clone().addScaledVector(player.forward(), 14).add(new THREE.Vector3(0, 3, 0));
      const name = params.get('fx');
      if (name === 'explosion' || name === 'gate' || name === 'roots' || name === 'lightning' || name === 'pickup') {
        if ((now / 700 | 0) !== window.__fxBeat) { window.__fxBeat = now / 700 | 0; LOOKS[name](fx, at); }
      } else LOOKS[name]?.(fx, at, [0.35, 0.65, 1]);
      if (name === 'fireballTrail') LOOKS.fireballCore(fx, at);
    }
    npcs.update(dt, karts, eqfx);
    fx.update(dt);
    eqfx.update(dt);
    if (sky) { sky.userData.update(camera, dt, params.has('day') ? parseFloat(params.get('day')) : DAY_MINUTES); setLight(sky.userData.light); }
    zone.animate(dt);                                 // fire, lava, water: EQ's animated textures
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  opts.close?.();                                     // the front end's loading screen: the race is ready
  requestAnimationFrame(frame);
  // heartbeat into the desktop app's log file: where the race was when it stopped
  if (window.everkart?.log) {
    let frames = 0, last = performance.now();
    const count = () => { frames++; requestAnimationFrame(count); };
    requestAnimationFrame(count);
    setInterval(() => {
      const now = performance.now(), fps = (frames * 1000) / (now - last);
      frames = 0; last = now;
      const st = window.__ek?.state;
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : '';
      window.everkart.log(`[beat] ${trackName} t=${st ? st.t.toFixed(1) : '-'} fps=${fps.toFixed(0)} progress=${st?.progress ?? '-'} lap=${st?.lap ?? '-'} speed=${st ? st.speed.toFixed(0) : '-'} heap=${mem} draw=${renderer.info.render.calls} tris=${renderer.info.render.triangles}`);
    }, 5000);
  }
}

loadRacers().then(() => {
  if (params.has('track')) {
    const [code, armor] = (params.get('racer') || 'HUM_3').split('_');
    start(params.get('track'), { code, armor: parseInt(armor ?? '3', 10) });
  } else if (params.has('campaign') && campaignRace()) {   // (restarting a campaign race)
    const c = campaignRace();
    start(c.track, c.racer, { campaign: true });
  } else {
    startFrontend({ renderer, onRace: (track, racer, opts) => start(track, racer, opts),
      screen: params.has('standings') ? 'standings' : params.has('menu') ? 'main' : 'title' });
  }
});
