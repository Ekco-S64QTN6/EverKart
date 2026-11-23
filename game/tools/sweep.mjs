// Regression sweep: an autopilot race on each track for a while; reports rescues (where a
// kart got stuck or lost), page errors and how the field is spread.
//   node tools/sweep.mjs [seconds] [tracks...]        (needs the dev server)
import puppeteer from 'puppeteer-core';
import { TRACK_IDS } from './tracks.mjs';
const all = TRACK_IDS;
const [secArg, ...rest] = process.argv.slice(2);
const secs = parseFloat(secArg || '150');
const tracks = rest.length ? rest : all;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], protocolTimeout: 900000 });
for (const t of tracks) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:5199/?track=${t}&mute&autopilot&nointro&nohud`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ek?.state, { timeout: 300000, polling: 500 });
  await new Promise((r) => setTimeout(r, secs * 1000));
  const r = await page.evaluate(() => ({ t: Math.round(window.__ek.state.t), laps: window.__ek.state.laps, rescues: window.__ek.state.rescues,
    at: (window.__ek.rescueAt || []).slice(0, 12) }));
  console.log(`${t.padEnd(14)} sim ${String(r.t).padStart(3)}s laps ${JSON.stringify(r.laps)} rescues ${JSON.stringify(r.rescues)} errors ${errors.length}${errors.length ? ' ' + errors[0] : ''}`);
  if (r.at.length) console.log('   at [progress, x, y, z, why]:', JSON.stringify(r.at));
  await page.close();
}
await browser.close();
