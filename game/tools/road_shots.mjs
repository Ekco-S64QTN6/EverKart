// Screenshots looking down the road at given path points:
//   node tools/road_shots.mjs <track> <outdir> <i> [i ...]     (needs the dev server)
// Also prints the road cross-section (ground G, surface H) at each point.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [track, out, ...pts] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 960, height: 540 }, protocolTimeout: 600000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('console', (m) => { if (/roadbed|carve|decor/.test(m.text())) console.log('[page]', m.text()); });
await page.goto(`http://localhost:5199/?track=${track}&mute&nohud&nointro&day=100000${process.env.EXTRA || ""}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.road, { timeout: 300000, polling: 500 });
for (const p of pts.map(Number)) {
  await page.evaluate((p) => { window.__camAt = p; }, p);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${out}/${track}_${p}.png` });
  const sec = await page.evaluate((p) => {
    const { G, H } = window.__ek.road;
    return { y: +window.__ek.track.path[p].y.toFixed(1), G: G[p].map((v) => (v === null ? null : +v.toFixed(1))), H: H[p].map((v) => +v.toFixed(1)) };
  }, p);
  console.log(p, JSON.stringify(sec));
}
await browser.close();
