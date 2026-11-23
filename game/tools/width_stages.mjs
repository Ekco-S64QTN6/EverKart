// Why is the road this wide here? Each side's half width after each stage of course.js, at
// chosen path points: the walls and floor ("limits": also a tight bend's inside), another
// stretch alongside ("neighbours"), decks / bridges / the ring ("decks"), eased along ("eased"),
// the edges smoothed in the world and kept from folding ("folds").
//   node tools/width_stages.mjs <track> <path point> ...     (needs the dev server)
import puppeteer from 'puppeteer-core';
const [track, ...pts] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 320, height: 200 }, protocolTimeout: 900000 });
const page = await browser.newPage();
await page.goto(`http://localhost:5199/?track=${track}&mute&nohud&nointro`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.road, { timeout: 600000, polling: 500 });
console.log(await page.evaluate((pts) => {
  const t = window.__ek.track, S = t.widthStages, d = t.data;
  return pts.map((i) => `${i}: walls L ${t.roomL0[i].toFixed(0)} R ${t.roomR0[i].toFixed(0)}, floor L ${d.room_l?.[i] ?? '-'} R ${d.room_r?.[i] ?? '-'} | `
    + Object.entries(S).map(([k, [l, r]]) => `${k} ${l[i].toFixed(1)}/${r[i].toFixed(1)}`).join('  ')).join('\n');
}, pts.map(Number)));
await browser.close();
