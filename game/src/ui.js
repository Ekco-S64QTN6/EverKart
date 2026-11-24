// The racers and tracks lists, and the race's results screen (the menus are src/frontend/);
// keyboard, mouse and controller all work.
import { readMenu, primeMenu } from './input.js';

// racers come from drivers/index.json (tools/export_drivers.py): every classic race,
// both genders, each with the armor materials it has
export let RACERS = [];
export async function loadRacers() {
  RACERS = await (await fetch('drivers/index.json')).json();
  return RACERS;
}
export const racerLabel = (r, armorId) => (r.npc ? r.race : `${r.race} ${r.gender === 'Male' ? '♂' : '♀'} · ${(r.armors.find((a) => a.id === armorId) || r.armors[0]).name}`);
const NAMES = ['Faerlie', 'Brokk', 'Fizzwix', 'Ulfgar', 'Vexia', 'Thaddeus', 'Pip', 'Grubnak', 'Sssylith', 'Kerrick',
  'Lanys', 'Dorn', 'Mirela', 'Throgg', 'Ysolde', 'Belgar', 'Nimbletoe', 'Ashra', 'Corvin', 'Hesta'];
export function opponents(you, count) {
  const pool = RACERS.filter((r) => r.code !== you.code).sort(() => Math.random() - 0.5).slice(0, count);
  const names = [...NAMES].sort(() => Math.random() - 0.5);
  return pool.map((r, i) => ({ code: r.code, armor: r.armors[Math.floor(Math.random() * r.armors.length)].id, name: names[i], info: r }));
}

export const TRACKS = [
  { id: 'veeshan', name: 'Temple of Veeshan', sub: 'Dragon halls of the north wing' },
  { id: 'kael', name: 'Kael Drakkal', sub: 'Around the giants’ arena' },
  { id: 'gfaydark', name: 'Greater Faydark', sub: 'Forest trails under Kelethin' },
  { id: 'oasis', name: 'Oasis of Marr', sub: 'Around the oasis, across the dunes' },
  { id: 'everfrost', name: 'Everfrost Peaks', sub: 'Ice canyons and the frozen plain' },
  { id: 'nektulos', name: 'Nektulos Forest', sub: 'Under the dark canopy' },
  { id: 'lavastorm', name: 'Lavastorm Mountains', sub: 'Between the lava flows' },
  { id: 'fearplane', name: 'Plane of Fear', sub: 'Past the temple of Cazic-Thule' },
  { id: 'hateplane', name: 'Plane of Hate', sub: 'Innoruuk’s plaza and tower' },
  { id: 'growthplane', name: 'Plane of Growth', sub: 'Around Tunare’s tree' },
  { id: 'mischiefplane', name: 'Plane of Mischief', sub: 'Bristlebane’s garden' },
  { id: 'unrest', name: 'Estate of Unrest', sub: 'Round the haunted mansion' },
  { id: 'vpeak', name: 'Veeshan’s Peak', sub: 'Through the dragons’ halls' },
  { id: 'butcher', name: 'Butcherblock Mountains', sub: 'From the docks to the gates of Kaladim' },
  { id: 'northkarana', name: 'North Karana', sub: 'Across the plains to the druid circle' },
  { id: 'ecommons', name: 'East Commonlands', sub: 'The road from the gates of Freeport' },
  { id: 'erudsxing', name: "Erud's Crossing", sub: 'Round the Kerran isle, on the sand' },
];
export function showResults(rows, actions) {
  const el = document.getElementById('results');
  const table = document.getElementById('standings');
  table.innerHTML = rows.map((r, i) => `<tr class="${r.you ? 'you' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.race}</td><td>${r.time}</td></tr>`).join('');
  el.hidden = false;
  el.querySelectorAll('button').forEach((b) => { b.onclick = () => actions[b.dataset.act](); });
  // only the buttons shown (a campaign race has just one, to its standings): a hidden button can
  // take no focus, and A / Enter would press nothing
  const buttons = [...el.querySelectorAll('button')].filter((b) => !b.hidden);
  let sel = 0;
  buttons[0].focus();
  primeMenu();                                   // A still held from driving is not a press here
  (function loop() {
    if (el.hidden) return;
    const m = readMenu();
    if (m.left || m.up || m.right || m.down) {
      sel = (sel + (m.left || m.up ? -1 : 1) + buttons.length) % buttons.length;
      buttons[sel].focus();
    }
    if (m.ok) document.activeElement?.click();
    requestAnimationFrame(loop);
  })();
}
