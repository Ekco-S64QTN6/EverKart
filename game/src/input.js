// Keyboard + gamepad, merged into one set of controls.
//
//   action        keyboard              gamepad (standard mapping: Xbox / PlayStation / 8BitDo...)
//                                       Classic layout (A drives)     Triggers layout
//   steer         Left/Right, A/D       left stick, d-pad             same
//   accelerate    Up, W                 A                             RT (pressure-sensitive), A
//   brake/back    Down, S               B                             LT (pressure-sensitive), B
//   drift/hop     Space                 RB, RT                        RB
//   cast spell    E, Shift, Ctrl        LB, LT, Y                     LB, Y
//   look behind   Q, C                  X                             X
//   rescue        R                     Back / View                   same
//   pause         Esc, P                Start / Menu                  same
// (the classic layout is a kart racer's: A to drive, the triggers doubling the shoulder buttons;
// the triggers layout is a driving game's: RT and LT as gas and brake)
import { settings } from './settings.js';

const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const DEAD = 0.18;
const prev = {};

function pad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

const btn = (p, i) => !!p && !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4);
// a trigger's pressure, 0 .. 1 (a light touch does nothing)
const trig = (p, i) => { const v = p?.buttons[i]?.value ?? 0; return v < 0.08 ? 0 : Math.min(1, (v - 0.08) / 0.84); };

export function readControls() {
  const p = pad();
  const k = (...names) => names.some((n) => keys.has(n));
  let steer = (k('arrowright', 'd') ? 1 : 0) - (k('arrowleft', 'a') ? 1 : 0);
  let throttle = (k('arrowup', 'w') ? 1 : 0) - (k('arrowdown', 's') ? 1 : 0);
  let drift = k(' ');
  let item = k('e', 'shift', 'control');
  let lookBack = k('q', 'c');
  let rescue = k('r');
  let pause = k('escape', 'p');
  if (p) {
    const triggers = settings().padLayout === 'triggers';
    const x = p.axes[0] || 0;
    if (Math.abs(x) > DEAD) steer = Math.sign(x) * (Math.abs(x) - DEAD) / (1 - DEAD);
    if (btn(p, 14)) steer = -1;
    if (btn(p, 15)) steer = 1;
    const gas = Math.max(btn(p, 0) ? 1 : 0, triggers ? trig(p, 7) : 0);
    const brake = Math.max(btn(p, 1) ? 1 : 0, triggers ? trig(p, 6) : 0);
    if (gas || brake) throttle = gas > brake ? gas : -brake;     // both held: the brake wins only if pressed harder
    drift ||= btn(p, 5) || (!triggers && btn(p, 7));
    item ||= btn(p, 4) || btn(p, 3) || (!triggers && btn(p, 6));
    lookBack ||= btn(p, 2);
    rescue ||= btn(p, 8);
    pause ||= btn(p, 9);
  }
  // one-shot presses
  const edge = (name, v) => { const was = prev[name]; prev[name] = v; return v && !was; };
  return {
    steer: Math.max(-1, Math.min(1, steer)), throttle, drift, lookBack,
    itemPressed: edge('item', item), rescuePressed: edge('rescue', rescue), pausePressed: edge('pause', pause),
    gamepad: !!p,
  };
}

// Menu navigation (pause, results): up/down to move, A / Enter to choose, B to go back.
// primeMenu(): call as a menu opens - whatever is already held (Start that opened the pause, A still
// down from driving) does not count as a press in it.
export function primeMenu() { readMenu(); }
export function readMenu(keyboard = true) {
  const p = pad();
  const kb = (...n) => keyboard && n.some((k) => keys.has(k));
  const y = p ? p.axes[1] || 0 : 0;
  const x = p ? p.axes[0] || 0 : 0;
  const up = kb('arrowup', 'w') || btn(p, 12) || y < -0.5;
  const down = kb('arrowdown', 's') || btn(p, 13) || y > 0.5;
  const left = kb('arrowleft', 'a') || btn(p, 14) || x < -0.5;
  const right = kb('arrowright', 'd') || btn(p, 15) || x > 0.5;
  const ok = kb('enter') || btn(p, 0) || btn(p, 9);
  const back = btn(p, 1);
  const edge = (name, v) => { const was = prev['m' + name]; prev['m' + name] = v; return v && !was; };
  return { up: edge('up', up), down: edge('down', down), left: edge('left', left), right: edge('right', right),
    ok: edge('ok', ok), back: edge('back', back), lb: edge('lb', btn(p, 4)), rb: edge('rb', btn(p, 5)) };
}

export function rumble(strength = 0.6, ms = 180) {
  const p = pad();
  p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength });
}
