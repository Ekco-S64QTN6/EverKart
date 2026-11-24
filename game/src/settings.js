// The player's options, kept between sessions (localStorage). The options screen changes them;
// the race reads them. Every value has a default, so a fresh install (or cleared storage) works.
const KEY = 'ek.settings';

export const DEFAULTS = {
  fullscreen: true,        // the desktop app starts fullscreen (F11 toggles)
  renderScale: 1,          // 0.5 .. 1 of the screen's resolution (lower = faster)
  musicVolume: 0.7,        // 0 .. 1
  sfxVolume: 0.8,          // 0 .. 1
  laps: 0,                 // 0 = the track's own; 1 .. 5
  difficulty: 1,           // CPU racers: 0 apprentice, 1 journeyman, 2 master
  minimap: true,
  intro: true,             // the race intro (course flyover, grid)
  weather: 'random',       // rain and snow where they fall: 'random' (changing), 'always', 'clear'
  padLayout: 'classic',    // the controller: 'classic' (A drives, B brakes) or 'triggers' (RT drives, LT brakes)
  speedClass: 1,           // the engine class last raced: 0 50cc, 1 100cc, 2 150cc (SPEED_CLASSES)
};

// The engine classes, as kart racers have them: every kart in the race (yours and the rivals') runs
// at the class's pace - top speed and acceleration both, so a kart takes as long to reach its top
// speed in each. 100cc is the game's own tuning.
export const SPEED_CLASSES = [
  { name: '50cc', speed: 0.95, sub: 'An easier pace: time to take in the sights' },
  { name: '100cc', speed: 1, sub: 'The standard race' },
  { name: '150cc', speed: 1.12, sub: 'Fast and unforgiving: drift early, brake late' },
];
export const speedClass = (i) => SPEED_CLASSES[i] || SPEED_CLASSES[1];

export const DIFFICULTY = [
  { name: 'Apprentice', skill: 0.86, band: 0.7 },   // slower rivals, gentler catch-up
  { name: 'Journeyman', skill: 0.93, band: 1 },
  { name: 'Master', skill: 0.99, band: 1.25 },
];

let current = null;

export function settings() {
  if (current) return current;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* fresh */ }
  current = { ...DEFAULTS, ...stored };
  return current;
}

export function setSetting(name, value) {
  settings()[name] = value;
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* not kept, still applied */ }
  for (const fn of listeners) fn(name, value);
}

const listeners = new Set();
export function onSetting(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// fullscreen: the desktop app's window, or the browser's fullscreen in development
export function applyFullscreen(on) {
  if (window.everkart?.setFullscreen) { window.everkart.setFullscreen(on); return; }
  try {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen?.();
  } catch { /* the browser may refuse without a click */ }
}
