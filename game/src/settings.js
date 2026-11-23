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
};

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
