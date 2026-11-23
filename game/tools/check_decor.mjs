// Build check: on every track, no rail post or chevron board may stand on the road.
//   node tools/check_decor.mjs [tracks...]      (needs the dev server; exits 1 on any hit)
import puppeteer from 'puppeteer-core';
import { TRACK_IDS } from './tracks.mjs';
const all = TRACK_IDS;
const tracks = process.argv.slice(2).length ? process.argv.slice(2) : all;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], protocolTimeout: 600000 });
let bad = 0;
for (const t of tracks) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:5199/?track=${t}&mute&autopilot`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ek?.decorOnRoad, { timeout: 300000, polling: 500 });
  const r = await page.evaluate(() => ({ hits: window.__ek.decorOnRoad.length, npcs: window.__ek.npcCount, fights: window.__ek.fights }));
  console.log(`${t.padEnd(14)} decor on road: ${r.hits}   npcs: ${r.npcs}   fights: ${r.fights}   errors: ${errors.length}${errors.length ? ' ' + errors[0] : ''}`);
  bad += r.hits + errors.length;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
