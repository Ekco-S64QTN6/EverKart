// Race intro check: screenshots down the intro by game time - three down each flyover run (its
// start, middle, end) and five down the crane move over the grid into the chase camera
//   node tools/intro_shots.mjs <track> <outdir>     (needs the dev server)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [track, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 960, height: 540 }, protocolTimeout: 900000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('console', (m) => { if (/error|roadbed|warn/i.test(m.text())) console.log('[page]', m.text().slice(0, 200)); });
await page.goto(`http://localhost:5199/?track=${track}&mute`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.state, { timeout: 600000, polling: 500 });
const { t, intro } = await page.evaluate(() => window.__ek.state);
console.log(JSON.stringify(intro));
const t0 = t;                                // the intro starts at -3.5 - INTRO
const marks = [];
for (let k = 0; k < intro.passes; k++) for (const f of [0.1, 0.5, 0.9]) marks.push([`run${k}_${f}`, t0 + (k + f) * intro.PASS_T]);
for (const f of [0.05, 0.3, 0.55, 0.8, 0.99]) marks.push([`grid_${f}`, t0 + intro.FLY + f * intro.GRID_T]);
for (const [name, m] of marks) {
  await page.waitForFunction((m) => window.__ek.state.t >= m, { timeout: 600000, polling: 50 }, m);
  await page.screenshot({ path: `${out}/${track}_${name}.png` });
}
console.log(marks.length, 'shots');
await browser.close();
