// Every racer seated in its kart, five views each (front, side, three-quarter, behind as the race
// camera sees it, the face close up): is each one sitting in the kart, face the right way up and
// looking ahead?
//   node tools/racer_sheet.mjs <outdir> [CODE ...]      (needs the dev server; default: every racer, first armor)
//   ALL_ARMORS=1 node tools/racer_sheet.mjs <outdir>    (every armor of every racer)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [out, ...only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 1500, height: 300 }, protocolTimeout: 900000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.goto('http://localhost:5199/tools/racerview.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.ready, { timeout: 120000 });
let list = await page.evaluate(() => window.racers);
if (!process.env.ALL_ARMORS) list = list.filter(([c], i) => list.findIndex(([c2]) => c2 === c) === i);
if (only.length) list = list.filter(([c]) => only.includes(c));
for (const [code, armor] of list) {
  await page.evaluate((c, a) => window.show(c, a), code, armor);
  await page.screenshot({ path: `${out}/${code}_${armor}.png` });
  process.stdout.write(`${code}_${armor} `);
}
console.log(`\n${list.length} racers`);
await browser.close();
