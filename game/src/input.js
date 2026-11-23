// Keyboard + gamepad, merged into one set of controls.
//
//   action      keyboard              gamepad (standard mapping: Xbox / PlayStation / 8BitDo...)
//   steer       Left/Right, A/D       left stick, d-pad
//   accelerate  Up, W                 A (cross)  - or RT when "triggers drive" style is preferred
//   brake/back  Down, S               B (circle), X (square)
//   drift/hop   Space                 RB, RT
//   cast spell  E, Shift, Ctrl        LB, LT, Y (triangle)
//   rescue      R                     Back / Select
//   pause       Esc, P                Start
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

export function readControls() {
  const p = pad();
  const k = (...names) => names.some((n) => keys.has(n));
  let steer = (k('arrowright', 'd') ? 1 : 0) - (k('arrowleft', 'a') ? 1 : 0);
  let throttle = (k('arrowup', 'w') ? 1 : 0) - (k('arrowdown', 's') ? 1 : 0);
  let drift = k(' ');
  let item = k('e', 'shift', 'control');
  let rescue = k('r');
  let pause = k('escape', 'p');
  if (p) {
    const x = p.axes[0] || 0;
    if (Math.abs(x) > DEAD) steer = Math.sign(x) * (Math.abs(x) - DEAD) / (1 - DEAD);
    if (btn(p, 14)) steer = -1;
    if (btn(p, 15)) steer = 1;
    if (btn(p, 0)) throttle = 1;
    if (btn(p, 1) || btn(p, 2)) throttle = throttle > 0 ? 0 : -1;
    drift ||= btn(p, 5) || btn(p, 7);
    item ||= btn(p, 4) || btn(p, 6) || btn(p, 3);
    rescue ||= btn(p, 8);
    pause ||= btn(p, 9);
  }
  // one-shot presses
  const edge = (name, v) => { const was = prev[name]; prev[name] = v; return v && !was; };
  return {
    steer: Math.max(-1, Math.min(1, steer)), throttle, drift,
    itemPressed: edge('item', item), rescuePressed: edge('rescue', rescue), pausePressed: edge('pause', pause),
    gamepad: !!p,
  };
}

// Menu navigation (title / pause): up/down to move, A / Enter to choose, B / Esc to go back.
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
