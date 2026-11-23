// Every track's id, in menu order: read from the game's own list (src/ui.js TRACKS), so the
// check tools never fall out of step with the game.
import fs from 'node:fs';
const ui = fs.readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const list = ui.slice(ui.indexOf('export const TRACKS'), ui.indexOf('];', ui.indexOf('export const TRACKS')));
export const TRACK_IDS = [...list.matchAll(/\{ id: '(\w+)'/g)].map((m) => m[1]);
