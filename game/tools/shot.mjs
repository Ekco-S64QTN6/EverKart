// Headless test: open a track, optionally on autopilot, and save screenshots over time.
//   node tools/shot.mjs <url> <outdir> <seconds...>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [url, out, ...times] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.state, { timeout: 120000 });
const t0 = Date.now();
for (const s of times.map(Number)) {
  const wait = s * 1000 - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const st = await page.evaluate(() => window.__ek.state);
  console.log(`t=${s}s`, JSON.stringify({ ...st, pos: st.pos.map((v) => Math.round(v)) }));
  await page.screenshot({ path: `${out}/t${String(s).padStart(3, '0')}.png` });
}
await browser.close();
