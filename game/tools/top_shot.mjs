// Straight down on the built track at a path point: the road, kerbs, walls and junctions as
// a racer never sees them (everything more than `above` over the road is left out: roofs,
// floating rocks). Path points are numbered every 8th in yellow.
//   node tools/top_shot.mjs <track> <path point> <span> <out.png> [above=20]   (needs the dev server)
import puppeteer from 'puppeteer-core';
const [track, at, span, out, above = '20'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 900, height: 900 }, protocolTimeout: 900000 });
const page = await browser.newPage();
await page.goto(`http://localhost:5199/?track=${track}&mute&nohud&nointro`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.road, { timeout: 600000, polling: 500 });
await page.evaluate((at, span, above) => {
  const p = window.__ek.track.path[at];
  window.__top = { x: p.x, y: p.y, z: p.z, span, above };
}, +at, +span, +above);
await new Promise((r) => setTimeout(r, 2500));
const labels = await page.evaluate(() => {
  const { track, camera } = window.__ek, out = [];
  for (let i = 0; i < track.n; i += 8) {
    const v = track.path[i].clone().project(camera);
    if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1) out.push([i, (v.x + 1) * 450, (1 - v.y) * 450]);
  }
  return out;
});
await page.evaluate((labels) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:11px monospace;color:#ff0';
  d.innerHTML = labels.map(([i, x, y]) => `<span style="position:absolute;left:${x}px;top:${y}px">·${i}</span>`).join('');
  document.body.appendChild(d);
}, labels);
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: out });
await browser.close();
