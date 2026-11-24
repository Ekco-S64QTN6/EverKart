// EverKart's front end: every screen outside the race, in one style, over the 3D showroom.
//
//   title -> main menu -> Single Race:  class -> racer -> track -> race
//                      -> Campaign:     class -> cup -> racer -> race, standings, race ... -> podium
//                      -> Options:      video, audio, gameplay, controls
//                      -> Quit (the desktop app)
//
// Keyboard, mouse and controller all work everywhere. Left / right (and up / down) repeat while
// held, faster the longer they are held: hold to run through the whole racer list.
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './frontend.css';
import { Showroom } from './showroom.js';
import { RACERS, TRACKS, opponents } from '../ui.js';
import { settings, setSetting, DIFFICULTY, SPEED_CLASSES, speedClass, applyFullscreen } from '../settings.js';

// --- the campaign: four cups, points per race, a trophy per cup ------------------------------------
export const CUPS = [
  { id: 'antonica', name: 'Antonica Cup', sub: 'Plains, forest and desert of the old continent, and the crossing to Odus', tracks: ['northkarana', 'ecommons', 'nektulos', 'oasis', 'erudsxing'] },
  { id: 'faydwer', name: 'Faydwer Cup', sub: 'Elves, orcs and the restless dead', tracks: ['gfaydark', 'butcher', 'unrest'] },
  { id: 'planes', name: 'Planes Cup', sub: 'Through the realms of the gods', tracks: ['fearplane', 'hateplane', 'growthplane', 'mischiefplane'] },
  { id: 'dragons', name: 'Dragon Cup', sub: 'Vox’s and Nagafen’s lands, Velious and the dragons’ peak', tracks: ['everfrost', 'lavastorm', 'kael', 'veeshan', 'vpeak'] },
];
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const CKEY = 'ek.campaign', TKEY = 'ek.trophies';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };
export const loadCampaign = () => read(CKEY, null);
const trophies = () => read(TKEY, {});
// a cup's trophy is won in each class (100cc keeps the plain cup key trophies were first kept under)
const trophyKey = (cupId, cls) => ((cls ?? 1) === 1 ? cupId : `${cupId}.${speedClass(cls).name}`);

// the race the campaign is on: { track, racer, field, difficulty, cup, race, of }
export function campaignRace() {
  const c = loadCampaign();
  if (!c) return null;
  const cup = CUPS.find((x) => x.id === c.cup);
  if (!cup || c.race >= cup.tracks.length) return null;
  return { track: cup.tracks[c.race], racer: c.racer, field: c.field, difficulty: c.difficulty, speedClass: c.speedClass ?? 1, cup, race: c.race, of: cup.tracks.length };
}

// after a campaign race: order = the racers' names, first to last
export function recordCampaignRace(order) {
  const c = loadCampaign();
  if (!c) return;
  c.last = order.map((name, i) => ({ name, gained: POINTS[i] ?? 0 }));
  for (const r of c.last) c.points[r.name] = (c.points[r.name] || 0) + r.gained;
  c.race += 1;
  write(CKEY, c);
}

// --- menu sounds (EverQuest's own) -----------------------------------------------------------------
const sounds = {};
function sound(name, vol = 0.5) {
  const v = settings().sfxVolume * vol;
  if (v <= 0) return;
  const a = (sounds[name] ??= new Audio(`sfx/${name}.ogg`)).cloneNode();
  a.volume = Math.min(1, v);
  a.play().catch(() => {});
}

// --- input: actions with hold-to-repeat --------------------------------------------------------------
class Nav {
  constructor() {
    this.keys = new Set();
    this.hold = {};
    this.prevPad = {};
    this.queue = [];
    const DIR = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' };
    this.onKey = (e) => {
      const k = e.key.toLowerCase();
      if (e.repeat) return;
      this.keys.add(k);
      if (DIR[k]) {                            // a tap always counts (holding adds the repeats)
        this.queue.push(DIR[k]);
        this.hold[DIR[k]] = { t: 0, next: 0.34 };
        e.preventDefault();
        return;
      }
      const map = { enter: 'ok', ' ': 'ok', escape: 'back', backspace: 'back', q: 'lb', e: 'rb', tab: 'rb', r: 'extra', y: 'extra', f11: null };
      if (map[k]) { this.queue.push(map[k]); e.preventDefault(); }
      if (k === 'tab') e.preventDefault();
    };
    this.onUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.onBlur = () => this.keys.clear();
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onUp);
    addEventListener('blur', this.onBlur);
    // a button already down as a screen opens (A held from driving over the line) is not a press
    const p = this.pad();
    if (p) for (const [name, i] of [['a', 0], ['start', 9], ['b', 1], ['lb', 4], ['rb', 5], ['y', 3], ['x', 2]]) this.prevPad[name] = !!p.buttons[i]?.pressed;
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onUp);
    removeEventListener('blur', this.onBlur);
  }

  pad() {
    for (const p of navigator.getGamepads?.() || []) if (p?.connected) return p;
    return null;
  }

  // the actions this frame
  poll(dt) {
    const out = this.queue.splice(0);
    const p = this.pad();
    const b = (i) => !!p?.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
    const ax = p ? p.axes[0] || 0 : 0, ay = p ? p.axes[1] || 0 : 0;
    const k = (...n) => n.some((x) => this.keys.has(x));
    const dirs = {
      left: k('arrowleft', 'a') || b(14) || ax < -0.5,
      right: k('arrowright', 'd') || b(15) || ax > 0.5,
      up: k('arrowup', 'w') || b(12) || ay < -0.5,
      down: k('arrowdown', 's') || b(13) || ay > 0.5,
    };
    for (const [d, on] of Object.entries(dirs)) {
      const h = this.hold[d];
      if (!on) { delete this.hold[d]; continue; }
      if (!h) { this.hold[d] = { t: 0, next: 0.34 }; out.push(d); continue; }
      h.t += dt;
      if (h.t >= h.next) {                    // repeat, quicker the longer it is held
        out.push(d);
        h.next = h.t + Math.max(0.045, 0.14 - (h.t - 0.34) * 0.06);
      }
    }
    if (p) {
      const edge = (name, on) => { const was = this.prevPad[name]; this.prevPad[name] = on; return on && !was; };
      if (edge('a', b(0)) || edge('start', b(9))) out.push('ok');
      if (edge('b', b(1))) out.push('back');
      if (edge('lb', b(4) || b(6))) out.push('lb');
      if (edge('rb', b(5) || b(7))) out.push('rb');
      if (edge('y', b(3))) out.push('extra');
      if (edge('x', b(2))) out.push('extra');
    }
    return out;
  }

  anyPressed() {
    const p = this.pad();
    return this.keys.size > 0 || !!p?.buttons.some((x) => x.pressed);
  }
}

// --- small builders --------------------------------------------------------------------------------
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hints = (list) => list.map(([k, label]) => `<span><kbd>${k}</kbd>${label}</span>`).join('');
const trophySvg = (color = '#f6c453', dim = false) => `<svg viewBox="0 0 64 72" aria-hidden="true" style="opacity:${dim ? 0.28 : 1}">
  <defs><linearGradient id="tg${color.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d8"/><stop offset=".5" stop-color="${color}"/><stop offset="1" stop-color="#5a3a0a"/></linearGradient></defs>
  <path d="M14 6h36v10c0 14-8 24-18 24S14 30 14 16z" fill="url(#tg${color.slice(1)})" stroke="#2a1606" stroke-width="2"/>
  <path d="M14 10H5c0 10 5 16 12 17M50 10h9c0 10-5 16-12 17" fill="none" stroke="${color}" stroke-width="3"/>
  <rect x="28" y="40" width="8" height="12" fill="${color}" stroke="#2a1606" stroke-width="1.5"/>
  <rect x="18" y="52" width="28" height="8" rx="1" fill="${color}" stroke="#2a1606" stroke-width="1.5"/>
  <rect x="14" y="60" width="36" height="7" rx="1" fill="#3a220c" stroke="#2a1606" stroke-width="1.5"/></svg>`;
const MEDAL = { 1: ['#f6c453', 'Gold'], 2: ['#cfd6de', 'Silver'], 3: ['#c8834a', 'Bronze'] };

const genderOf = (r) => (r.npc ? 'Norrath' : r.gender === 'Male' ? '♂ Male' : '♀ Female');
const armorName = (r, id) => (r.armors.find((a) => a.id === id) || r.armors[0]).name;
const trackInfo = {};
async function trackFacts(id) {
  if (trackInfo[id]) return trackInfo[id];
  try {
    const d = await (await fetch(`tracks/${id}.json`)).json();
    let len = 0;
    for (let i = 1; i < d.path.length; i++) len += Math.hypot(d.path[i][0] - d.path[i - 1][0], d.path[i][2] - d.path[i - 1][2]);
    trackInfo[id] = { open: !!d.open, laps: d.laps || 3, length: Math.round(len), racers: d.grid?.length || 8 };
  } catch { trackInfo[id] = null; }
  return trackInfo[id];
}

// ======================================================================================================
// the front end
// ======================================================================================================
export function startFrontend({ renderer, onRace, screen = 'title' }) {
  const S = settings();
  applyFullscreen(S.fullscreen);
  const root = h(`<div id="fe"><div class="vignette"></div></div>`);
  document.body.appendChild(root);
  const room = new Showroom(renderer);
  const nav = new Nav();
  const hintBar = h('<div class="fe-hints"></div>');
  root.appendChild(hintBar);
  let current = null, alive = true, last = performance.now();

  // the racers: one entry per race (and per NPC model), each with the armor last chosen for it
  const saved = (localStorage.getItem('ek.racer') || 'HUM_3').split('_');
  const armorOf = JSON.parse(localStorage.getItem('ek.armors') || '{}');
  const racerItems = RACERS.map((r) => ({ code: r.code, info: r,
    armor: armorOf[r.code] ?? (r.armors.find((a) => a.id === 2) || r.armors[r.armors.length - 1]).id }));
  const iSaved = Math.max(0, racerItems.findIndex((x) => x.code === saved[0]));
  if (racerItems[iSaved] && racerItems[iSaved].info.armors.some((a) => a.id === +saved[1])) racerItems[iSaved].armor = +saved[1];
  let racerSel = iSaved;
  let trackSel = Math.max(0, TRACKS.findIndex((t) => t.id === localStorage.getItem('ek.track')));
  let flow = null;               // { kind: 'single' } or { kind: 'campaign', cup }

  const screens = {};
  function go(name, arg) {
    if (current) { current.el.classList.remove('on'); current.leave?.(); }
    current = screens[name];
    current.enter?.(arg);
    hintBar.innerHTML = hints(current.hints?.() || []);
    requestAnimationFrame(() => current.el.classList.add('on'));
  }
  function add(name, el, def) {
    el.classList.add('fe-screen');
    root.insertBefore(el, hintBar);
    screens[name] = { el, ...def };
  }
  const OK = ['Enter', 'Select'], BACK = ['Esc', 'Back'];

  // --- title ---------------------------------------------------------------------------------------
  let attract = 0;
  add('title', h(`<div>
      <div class="fe-title-wrap"><div class="fe-logo">EverKart</div><div class="fe-tag">Kart racing through the zones of Norrath</div></div>
      <div class="fe-press">Press any button</div>
      <div class="fe-corner l">${esc(typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'development build')} · ${TRACKS.length} tracks · ${RACERS.length} racers</div>
      <div class="fe-corner r">EverQuest is a trademark of Daybreak Game Company LLC · fan project</div>
    </div>`), {
    enter() { room.setItems(racerItems, racerSel); room.setMode('row'); attract = 0; },
    update(dt) {
      attract += dt;
      if (attract > 2.6) { attract = 0; room.select(room.sel + 1); }   // the racers turn by, one by one
    },
    action() { sound('whoosh', 0.35); go('main'); },
    hints: () => [],
  });
  screens.title.el.addEventListener('click', () => { sound('whoosh', 0.35); go('main'); });

  // --- main menu -----------------------------------------------------------------------------------
  const mainItems = [
    { id: 'race', name: 'Single Race', sub: 'Any track, any racer' },
    { id: 'campaign', name: 'Campaign', sub: 'Four cups across Norrath: points, standings, trophies' },
    { id: 'options', name: 'Options', sub: 'Video, sound, racing and controls' },
    ...(window.everkart?.quit ? [{ id: 'quit', name: 'Quit', sub: 'Back to the real Norrath' }] : []),
  ];
  let mainSel = 0;
  const mainEl = h(`<div><div class="fe-main-logo"><div class="fe-logo">EverKart</div><div class="fe-tag">Kart racing through the zones of Norrath</div></div>
    <div class="fe-menu">${mainItems.map((m, i) => `<div class="fe-item" data-i="${i}"><b>${m.name}</b><small>${m.sub}</small></div>`).join('')}</div></div>`);
  const mainMark = () => mainEl.querySelectorAll('.fe-item').forEach((e, i) => e.classList.toggle('sel', i === mainSel));
  const mainChoose = () => {
    const id = mainItems[mainSel].id;
    sound('pickup', 0.45);
    if (id === 'race') { flow = { kind: 'single' }; go('class'); }
    else if (id === 'campaign') { flow = { kind: 'campaign' }; go('class'); }
    else if (id === 'options') go('options');
    else if (id === 'quit') window.everkart.quit();
  };
  add('main', mainEl, {
    enter() { room.setItems(racerItems, racerSel); room.setMode('single', { side: 0.9 }); mainMark(); },
    action(a) {
      if (a === 'up' || a === 'down') { mainSel = (mainSel + (a === 'up' ? -1 : 1) + mainItems.length) % mainItems.length; mainMark(); sound('tick', 0.3); }
      else if (a === 'ok') mainChoose();
      else if (a === 'back') go('title');
    },
    hints: () => [['↑↓', 'Choose'], OK, BACK],
  });
  mainEl.querySelectorAll('.fe-item').forEach((e) => {
    e.addEventListener('mouseenter', () => { mainSel = +e.dataset.i; mainMark(); });
    e.addEventListener('click', () => { mainSel = +e.dataset.i; mainChoose(); });
  });

  // --- the engine class, chosen first as kart racers do it: 50cc, 100cc, 150cc ------------------------
  let classSel = speedClass(S.speedClass) === SPEED_CLASSES[S.speedClass] ? S.speedClass : 1;
  const classEl = h(`<div>
      <div class="fe-head"><h1>Choose your class</h1><span class="fe-sub"></span></div>
      <div class="fe-cups fe-classes"></div>
    </div>`);
  const classDraw = () => {
    classEl.querySelector('.fe-sub').textContent = flow?.kind === 'campaign' ? 'Every race of the cup at this pace; a trophy for each class' : 'Every kart in the race runs at this pace';
    classEl.querySelector('.fe-cups').innerHTML = SPEED_CLASSES.map((c, i) => `<div class="fe-cup fe-panel ${i === classSel ? 'sel' : ''}" data-i="${i}">
        <div class="fe-cc">${c.name}</div><div class="sub">${c.sub}</div>
        <div class="fe-speed">${SPEED_CLASSES.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div></div>`).join('');
    classEl.querySelectorAll('.fe-cup').forEach((e) => e.addEventListener('click', () => {
      const i = +e.dataset.i;
      if (i === classSel) classChoose(); else { classSel = i; sound('tick', 0.25); classDraw(); }
    }));
  };
  const classChoose = () => {
    sound('pickup', 0.5);
    setSetting('speedClass', classSel);
    go(flow?.kind === 'campaign' ? 'cups' : 'racer');
  };
  add('class', classEl, {
    enter() { room.setMode('empty'); classDraw(); },
    action(a) {
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') {
        const d = a === 'left' || a === 'up' ? -1 : 1;
        const j = Math.max(0, Math.min(SPEED_CLASSES.length - 1, classSel + d));
        if (j !== classSel) { classSel = j; sound('tick', 0.25); classDraw(); }
      } else if (a === 'ok') classChoose();
      else if (a === 'back') { sound('whoosh', 0.3); go('main'); }
    },
    hints: () => [['◀ ▶', 'Class'], OK, BACK],
  });

  // --- racer select: a turning row of the real racers in their karts ---------------------------------
  const racerEl = h(`<div>
      <div class="fe-head"><h1>Choose your racer</h1><span class="fe-sub"></span><span class="fe-count"></span></div>
      <div class="fe-plate fe-panel">
        <div class="fe-arrow l">◀</div>
        <div><h2></h2><div class="who"></div><div class="armor"></div></div>
        <div class="fe-arrow r">▶</div>
      </div>
      <div class="fe-ribbon"></div>
    </div>`);
  const kick = (side) => { const a = racerEl.querySelector(`.fe-arrow.${side}`); a.classList.add('kick'); setTimeout(() => a.classList.remove('kick'), 120); };
  const racerDraw = () => {
    const it = racerItems[racerSel], r = it.info;
    racerEl.querySelector('h2').textContent = r.race;
    racerEl.querySelector('.who').textContent = `${genderOf(r)} · ${r.npc ? 'EverQuest NPC' : 'Player race'}`;
    const arm = racerEl.querySelector('.armor');
    if (r.armors.length > 1) {
      arm.innerHTML = `<span>▴</span><span>${esc(armorName(r, it.armor))}</span><span class="pips">${r.armors.map((a) => `<i class="pip ${a.id === it.armor ? 'on' : ''}"></i>`).join('')}</span><span>▾</span>`;
    } else arm.innerHTML = `<span style="opacity:.6">${esc(armorName(r, it.armor))}</span>`;
    racerEl.querySelector('.fe-count').textContent = `${racerSel + 1} / ${racerItems.length}`;
    racerEl.querySelector('.fe-sub').textContent = `${flow?.kind === 'campaign' ? `${flow.cup.name} · ` : ''}${speedClass(S.speedClass).name}`;
    // a ribbon of where you are in the list (eleven marks around the selection)
    const n = racerItems.length, marks = [];
    for (let k = -5; k <= 5; k++) marks.push(`<i class="${k === 0 ? 'on' : ''}" style="opacity:${1 - Math.abs(k) * 0.15}"></i>`);
    racerEl.querySelector('.fe-ribbon').innerHTML = n > 1 ? marks.join('') : '';
    room.select(racerSel);
  };
  const racerMove = (d) => {
    racerSel = (racerSel + d + racerItems.length) % racerItems.length;
    room.select(room.sel + d);          // the row keeps turning the same way (it wraps round)
    kick(d < 0 ? 'l' : 'r');
    sound('tick', 0.25);
    racerDraw();
  };
  const armorStep = (d) => {
    const it = racerItems[racerSel], list = it.info.armors.map((a) => a.id);
    if (list.length < 2) return;
    it.armor = list[(list.indexOf(it.armor) + d + list.length) % list.length];
    armorOf[it.code] = it.armor;
    localStorage.setItem('ek.armors', JSON.stringify(armorOf));
    sound('tick', 0.3);
    racerDraw();
  };
  const racerChoose = () => {
    const it = racerItems[racerSel];
    localStorage.setItem('ek.racer', `${it.code}_${it.armor}`);
    sound('pickup', 0.5);
    if (flow?.kind === 'campaign') startCampaign(flow.cup, { code: it.code, armor: it.armor });
    else go('track');
  };
  add('racer', racerEl, {
    enter() {
      room.setItems(racerItems, racerSel);
      room.select(racerSel, true);
      room.setMode('row');
      racerDraw();
    },
    action(a) {
      if (a === 'left' || a === 'right') racerMove(a === 'left' ? -1 : 1);
      else if (a === 'up' || a === 'rb') armorStep(1);
      else if (a === 'down' || a === 'lb') armorStep(-1);
      else if (a === 'extra') racerMove(1 + Math.floor(Math.random() * (racerItems.length - 1)));
      else if (a === 'ok') racerChoose();
      else if (a === 'back') { sound('whoosh', 0.3); go(flow?.kind === 'campaign' ? 'cups' : 'class'); }
    },
    hints: () => [['◀ ▶', 'Racer (hold to run)'], ['▲ ▼', 'Armor'], ['R / Y', 'Random'], OK, BACK],
  });
  racerEl.querySelector('.fe-arrow.l').addEventListener('click', () => racerMove(-1));
  racerEl.querySelector('.fe-arrow.r').addEventListener('click', () => racerMove(1));
  racerEl.querySelector('h2').addEventListener('click', racerChoose);
  racerEl.addEventListener('wheel', (e) => racerMove(e.deltaY > 0 ? 1 : -1), { passive: true });

  // --- track select: a cover flow of the tracks ----------------------------------------------------------
  const trackEl = h(`<div>
      <div class="fe-head"><h1>Choose your track</h1><span class="fe-count"></span></div>
      <div class="fe-flow">${TRACKS.map((t, i) => `<div class="fe-card" data-i="${i}"><img src="ui/track_${t.id}.jpg" alt=""><div class="cap">${esc(t.name)}</div></div>`).join('')}</div>
      <div class="fe-detail fe-panel"><h2></h2><p></p><div class="fe-facts"></div></div>
    </div>`);
  const cards = [...trackEl.querySelectorAll('.fe-card')];
  const trackDraw = async () => {
    cards.forEach((c, i) => {
      let k = i - trackSel;
      const n = TRACKS.length;
      if (k > n / 2) k -= n;
      if (k < -n / 2) k += n;
      const a = Math.abs(k);
      c.classList.toggle('sel', k === 0);
      c.style.transform = `translateX(${k * 52}%) translateZ(${-a * 220}px) rotateY(${-Math.sign(k) * Math.min(a, 1) * 32}deg) scale(${k === 0 ? 1 : 0.86})`;
      c.style.opacity = a > 3 ? 0 : 1 - a * 0.18;
      c.style.zIndex = 50 - a;
      c.style.filter = k === 0 ? 'none' : `brightness(${0.55 - a * 0.08})`;
    });
    const t = TRACKS[trackSel];
    trackEl.querySelector('.fe-count').textContent = `${trackSel + 1} / ${TRACKS.length}`;
    trackEl.querySelector('.fe-detail h2').textContent = t.name;
    trackEl.querySelector('.fe-detail p').textContent = t.sub;
    const facts = trackEl.querySelector('.fe-facts');
    facts.innerHTML = '';
    const f = await trackFacts(t.id);
    if (TRACKS[trackSel] !== t || !f) return;
    const laps = S.laps || f.laps;
    const cup = CUPS.find((c) => c.tracks.includes(t.id));
    facts.innerHTML = [f.open ? 'Point to point' : `${laps} lap${laps === 1 ? '' : 's'}`,
      `${(f.length * (f.open ? 1 : laps)).toLocaleString()} units`, `${f.racers} racers`, cup ? cup.name : '']
      .filter(Boolean).map((x) => `<span>${x}</span>`).join('');
  };
  const trackMove = (d) => { trackSel = (trackSel + d + TRACKS.length) % TRACKS.length; sound('tick', 0.25); trackDraw(); };
  const trackChoose = () => {
    const t = TRACKS[trackSel], it = racerItems[racerSel];
    localStorage.setItem('ek.track', t.id);
    sound('pickup', 0.5);
    race(t.id, { code: it.code, armor: it.armor }, {});
  };
  add('track', trackEl, {
    enter() { room.setMode('empty'); trackDraw(); },
    action(a) {
      if (a === 'left' || a === 'up') trackMove(-1);
      else if (a === 'right' || a === 'down') trackMove(1);
      else if (a === 'ok') trackChoose();
      else if (a === 'back') { sound('whoosh', 0.3); go('racer'); }
    },
    hints: () => [['◀ ▶', 'Track'], OK, BACK],
  });
  cards.forEach((c) => c.addEventListener('click', () => { const i = +c.dataset.i; if (i === trackSel) trackChoose(); else { trackSel = i; trackDraw(); } }));
  trackEl.addEventListener('wheel', (e) => trackMove(e.deltaY > 0 ? 1 : -1), { passive: true });

  // --- campaign: the cups --------------------------------------------------------------------------------
  let cupSel = 0, cupRow = 0, cupDiff = S.difficulty;
  const cupEl = h(`<div>
      <div class="fe-head"><h1>Campaign</h1><span class="fe-sub"></span></div>
      <div class="fe-cups"></div>
      <div class="fe-row fe-panel"><span>Rivals</span><span class="ar">◀</span><b></b><span class="ar">▶</span></div>
    </div>`);
  const cupDraw = () => {
    const won = trophies();
    cupEl.querySelector('.fe-sub').textContent = `${speedClass(S.speedClass).name} · race every track of a cup: points for each finish, a trophy for the cup`;
    cupEl.querySelector('.fe-cups').innerHTML = CUPS.map((c, i) => {
      const best = won[trophyKey(c.id, S.speedClass)];
      const m = MEDAL[best];
      return `<div class="fe-cup fe-panel ${i === cupSel ? 'sel' : ''}" data-i="${i}">${trophySvg(m ? m[0] : '#f6c453', !m)}
        <h3>${c.name}</h3><div class="sub">${c.sub}</div>
        <ol>${c.tracks.map((id) => `<li>${esc(TRACKS.find((t) => t.id === id)?.name || id)}</li>`).join('')}</ol>
        <div class="won" style="color:${m ? m[0] : 'var(--ek-dim)'}">${m ? `${m[1]} trophy` : `No ${speedClass(S.speedClass).name} trophy yet`}</div></div>`;
    }).join('');
    cupEl.querySelectorAll('.fe-cup').forEach((e) => e.addEventListener('click', () => {
      const i = +e.dataset.i;
      if (i === cupSel) cupChoose(); else { cupSel = i; cupRow = 0; cupDraw(); }
    }));
    cupEl.querySelector('.fe-row b').textContent = DIFFICULTY[cupDiff].name;
    cupEl.querySelector('.fe-row').classList.toggle('sel', cupRow === 1);
    cupEl.querySelector('.fe-cups').classList.toggle('dim', cupRow === 1);
  };
  const cupChoose = () => { sound('pickup', 0.5); setSetting('difficulty', cupDiff); flow = { kind: 'campaign', cup: CUPS[cupSel] }; go('racer'); };
  add('cups', cupEl, {
    enter() { room.setItems(racerItems, racerSel); room.setMode('empty'); cupDraw(); },
    action(a) {
      if (a === 'up' || a === 'down') { cupRow = a === 'down' ? 1 : 0; sound('tick', 0.25); cupDraw(); }
      else if (a === 'left' || a === 'right') {
        const d = a === 'left' ? -1 : 1;
        if (cupRow === 0) cupSel = (cupSel + d + CUPS.length) % CUPS.length;
        else cupDiff = Math.max(0, Math.min(DIFFICULTY.length - 1, cupDiff + d));
        sound('tick', 0.25);
        cupDraw();
      } else if (a === 'ok') cupChoose();
      else if (a === 'back') { sound('whoosh', 0.3); go('class'); }
    },
    hints: () => [['◀ ▶', 'Cup'], ['▼', 'Rivals'], OK, BACK],
  });

  function startCampaign(cup, racer) {
    const field = opponents(racer, 7).map((o) => ({ code: o.code, armor: o.armor, name: o.name }));
    write(CKEY, { cup: cup.id, racer, field, difficulty: cupDiff, speedClass: S.speedClass, race: 0, points: {}, last: [] });
    const r = campaignRace();
    race(r.track, racer, { campaign: true });
  }

  // --- campaign standings (after each race) and the podium ----------------------------------------------
  const standEl = h(`<div>
      <div class="fe-head"><h1>Standings</h1><span class="fe-sub"></span></div>
      <div class="fe-table fe-panel"><table></table></div>
    </div>`);
  const standRows = (c) => {
    const names = ['You', ...c.field.map((f) => f.name)];
    const infoOf = (n) => (n === 'You' ? c.racer : c.field.find((f) => f.name === n));
    return names.map((n) => ({ name: n, info: infoOf(n), total: c.points[n] || 0, gained: c.last.find((x) => x.name === n)?.gained || 0 }))
      .sort((a, b) => b.total - a.total || b.gained - a.gained);
  };
  const racerLine = (x) => { const r = RACERS.find((q) => q.code === x?.code); return r ? `${r.race}${r.npc ? '' : ' ' + (r.gender === 'Male' ? '♂' : '♀')}` : ''; };
  add('standings', standEl, {
    enter() {
      const c = loadCampaign();
      if (!c) { go('main'); return; }
      const cup = CUPS.find((x) => x.id === c.cup);
      const rows = standRows(c);
      standEl.querySelector('.fe-sub').textContent = `${cup.name} · ${speedClass(c.speedClass).name} · after race ${c.race} of ${cup.tracks.length}`;
      standEl.querySelector('table').innerHTML = rows.map((r, i) => `<tr class="${r.name === 'You' ? 'you' : ''}"><td class="p">${i + 1}</td>
        <td class="n">${esc(r.name)}</td><td class="r">${esc(racerLine(r.info))}</td><td class="g">${r.gained ? '+' + r.gained : ''}</td><td class="t">${r.total}</td></tr>`).join('');
      const lead = rows[0].info;
      const it = { code: lead.code, armor: lead.armor, info: RACERS.find((q) => q.code === lead.code) };
      room.setItems([it], 0);
      room.setMode('single', { side: 0.8 });
    },
    action(a) {
      if (a !== 'ok' && a !== 'back') return;
      sound('pickup', 0.5);
      const next = campaignRace();
      if (next) race(next.track, next.racer, { campaign: true });
      else go('podium');
    },
    hints: () => [['Enter', 'Continue']],
  });

  const podEl = h(`<div><div class="fe-podium"><h1></h1><p></p></div></div>`);
  add('podium', podEl, {
    enter() {
      const c = loadCampaign();
      if (!c) { go('main'); return; }
      const cup = CUPS.find((x) => x.id === c.cup);
      const rows = standRows(c);
      const place = rows.findIndex((r) => r.name === 'You') + 1;
      const m = MEDAL[place];
      const ccName = speedClass(c.speedClass).name, tk = trophyKey(cup.id, c.speedClass);
      podEl.querySelector('h1').textContent = m ? `${cup.name} ${ccName} · ${m[1]}` : `${cup.name} ${ccName}`;
      podEl.querySelector('p').textContent = m ? `You finish ${place === 1 ? 'first' : place === 2 ? 'second' : 'third'} with ${rows[place - 1].total} points.`
        : `You finish ${place}th with ${rows[place - 1].total} points. The podium awaits next time.`;
      if (m) { const t = trophies(); if (!t[tk] || place < t[tk]) { t[tk] = place; write(TKEY, t); } sound('ding', 0.6); }
      room.setMode('podium', { items: rows.slice(0, 3).map((r) => ({ code: r.info.code, armor: r.info.armor, info: RACERS.find((q) => q.code === r.info.code) })) });
      localStorage.removeItem(CKEY);
    },
    action(a) { if (a === 'ok' || a === 'back') { sound('whoosh', 0.3); go('main'); } },
    hints: () => [['Enter', 'Continue']],
  });

  // --- options ---------------------------------------------------------------------------------------
  const pct = (v) => `<span class="fe-bar"><i style="width:${Math.round(v * 100)}%"></i></span><span>${Math.round(v * 100)}%</span>`;
  const OPTS = {
    Video: [
      { k: 'fullscreen', name: 'Display', vals: [true, false], show: (v) => (v ? 'Fullscreen' : 'Window'), apply: applyFullscreen },
      { k: 'renderScale', name: 'Render resolution', vals: [0.5, 0.67, 0.75, 0.85, 1], show: (v) => `${Math.round(v * 100)}%`, note: 'Lower runs faster on older graphics cards' },
      { k: 'intro', name: 'Race intro', vals: [true, false], show: (v) => (v ? 'Course flyover' : 'Straight to the grid') },
    ],
    Audio: [
      { k: 'musicVolume', name: 'Music', vals: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], show: pct },
      { k: 'sfxVolume', name: 'Sound effects', vals: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], show: pct, apply: () => sound('tick', 0.6) },
    ],
    Racing: [
      { k: 'difficulty', name: 'Rivals', vals: [0, 1, 2], show: (v) => DIFFICULTY[v].name, note: 'How fast the other racers drive, and how hard they keep up' },
      { k: 'laps', name: 'Laps', vals: [0, 1, 2, 3, 4, 5], show: (v) => (v ? `${v}` : 'The track’s own') },
      { k: 'minimap', name: 'Minimap', vals: [true, false], show: (v) => (v ? 'Shown' : 'Hidden') },
      { k: 'weather', name: 'Weather', vals: ['random', 'always', 'clear'], show: (v) => ({ random: 'Changing', always: 'Always', clear: 'Clear skies' })[v], note: 'Rain and snow where they fall in Norrath' },
    ],
    Controls: [
      { k: 'padLayout', name: 'Controller', vals: ['classic', 'triggers'], show: (v) => (v === 'triggers' ? 'Triggers: RT drives, LT brakes' : 'Classic: A drives, B brakes'),
        note: 'Classic is the kart racer\u2019s layout; Triggers drives like a racing game', apply: () => keysDraw() },
    ],
  };
  const TABS = Object.keys(OPTS);
  let tab = 0, optSel = 0;
  const optEl = h(`<div>
      <div class="fe-head"><h1>Options</h1></div>
      <div class="fe-tabs">${TABS.map((t, i) => `<div class="fe-tab" data-i="${i}">${t}</div>`).join('')}</div>
      <div class="fe-opts fe-panel"></div>
      <div class="fe-keys fe-panel"><table></table></div>
    </div>`);
  // the bindings, for the controller layout chosen
  const keysDraw = () => {
    const tr = S.padLayout === 'triggers';
    optEl.querySelector('.fe-keys table').innerHTML = `
        <tr><th></th><th>Keyboard</th><th>Controller</th></tr>
        <tr><td>Steer</td><td>← → / A D</td><td>Left stick, D-pad</td></tr>
        <tr><td>Accelerate</td><td>↑ / W</td><td>${tr ? 'RT / A' : 'A'}</td></tr>
        <tr><td>Brake / reverse</td><td>↓ / S</td><td>${tr ? 'LT / B' : 'B'}</td></tr>
        <tr><td>Drift (release for a mini-turbo)</td><td>Space</td><td>${tr ? 'RB' : 'RB / RT'}</td></tr>
        <tr><td>Cast your spell</td><td>E / Shift</td><td>${tr ? 'LB / Y' : 'LB / LT / Y'}</td></tr>
        <tr><td>Look behind (hold)</td><td>Q / C</td><td>X</td></tr>
        <tr><td>Back on the track</td><td>R</td><td>Back / View</td></tr>
        <tr><td>Pause</td><td>Esc / P</td><td>Start / Menu</td></tr>
        <tr><td>Fullscreen / window</td><td>F11</td><td></td></tr>`;
  };
  const optDraw = () => {
    optEl.querySelectorAll('.fe-tab').forEach((e, i) => e.classList.toggle('sel', i === tab));
    const list = OPTS[TABS[tab]];
    optEl.querySelector('.fe-opts').style.display = list ? '' : 'none';
    optEl.querySelector('.fe-keys').style.display = TABS[tab] === 'Controls' ? '' : 'none';
    keysDraw();
    if (!list) return;
    optEl.querySelector('.fe-opts').innerHTML = list.map((o, i) => `<div class="fe-opt ${i === optSel ? 'sel' : ''}" data-i="${i}"><span>${o.name}</span>
      <span class="v"><span class="ar">◀</span>${o.show(S[o.k])}<span class="ar">▶</span></span>${o.note ? `<div class="note">${o.note}</div>` : ''}</div>`).join('');
    optEl.querySelectorAll('.fe-opt').forEach((e) => e.addEventListener('click', () => { optSel = +e.dataset.i; optChange(1); }));
  };
  const optChange = (d) => {
    const o = OPTS[TABS[tab]]?.[optSel];
    if (!o) return;
    const i = o.vals.findIndex((v) => v === S[o.k]);
    const j = Math.max(0, Math.min(o.vals.length - 1, (i < 0 ? 0 : i) + d));
    if (o.vals[j] === S[o.k]) return;
    setSetting(o.k, o.vals[j]);
    o.apply?.(o.vals[j]);
    if (o.k !== 'sfxVolume') sound('tick', 0.3);
    optDraw();
  };
  add('options', optEl, {
    enter() { room.setMode('empty'); tab = 0; optSel = 0; optDraw(); },
    action(a) {
      const list = OPTS[TABS[tab]];
      if (a === 'lb' || a === 'rb') { tab = (tab + (a === 'lb' ? -1 : 1) + TABS.length) % TABS.length; optSel = 0; sound('tick', 0.3); optDraw(); }
      else if ((a === 'up' || a === 'down') && list) { optSel = (optSel + (a === 'up' ? -1 : 1) + list.length) % list.length; sound('tick', 0.2); optDraw(); }
      else if (a === 'left' || a === 'right') { if (list) optChange(a === 'left' ? -1 : 1); else { tab = (tab + (a === 'left' ? -1 : 1) + TABS.length) % TABS.length; optDraw(); } }
      else if (a === 'back' || a === 'ok') { sound('whoosh', 0.3); go('main'); }
    },
    hints: () => [['Q E / LB RB', 'Section'], ['↑↓', 'Option'], ['◀ ▶', 'Change'], BACK],
  });
  optEl.querySelectorAll('.fe-tab').forEach((e) => e.addEventListener('click', () => { tab = +e.dataset.i; optSel = 0; optDraw(); }));

  // --- loading, then the race -------------------------------------------------------------------------
  const TIPS = [
    'Hold drift through a long bend: blue sparks are a small turbo, orange a big one.',
    'Steering into a drift charges it faster.',
    'A spell gem gives you an EverQuest spell: Spirit of Wolf, Flame Bolt, Snare, Gate and more.',
    'Off the road you lose speed. A turbo carries you over the rough.',
    'Stuck? R (or Back) puts you back on the track.',
    'In Veeshan’s Peak, Hoshkar breathes fire on karts that come too close to his island.',
  ];
  const loadEl = h(`<div><div class="fe-load"><div class="in"><h1></h1><p></p><div class="tip"></div></div><div class="fe-spin"></div></div></div>`);
  add('loading', loadEl, {
    enter({ track, sub }) {
      loadEl.querySelector('.fe-load').style.backgroundImage = `url(ui/track_${track}.jpg)`;
      loadEl.querySelector('h1').textContent = TRACKS.find((t) => t.id === track)?.name || track;
      loadEl.querySelector('p').textContent = sub;
      loadEl.querySelector('.tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    },
    action() {},
    hints: () => [],
  });

  function race(track, racer, opts) {
    const c = opts.campaign ? campaignRace() : null;
    go('loading', { track, sub: c ? `${c.cup.name} · race ${c.race + 1} of ${c.of}` : 'Single race' });
    setTimeout(() => {                 // let the loading screen draw before the zone loads
      alive = false;
      nav.dispose();
      onRace(track, racer, { ...opts, close });
    }, 60);
  }
  function close() {                   // the race calls this once it is on screen
    root.classList.add('closing');
    root.remove();
  }

  // --- the loop -----------------------------------------------------------------------------------------
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const acts = nav.poll(dt);
    if (current === screens.title && acts.length === 0 && nav.anyPressed()) acts.push('ok');
    for (const a of acts) current.action(a);
    current.update?.(dt);
    room.update(dt);
    room.render();
    requestAnimationFrame(frame);
  }
  go(screen);
  requestAnimationFrame(frame);
  return { go };
}
