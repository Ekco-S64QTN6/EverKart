// Ride check: drive a track on autopilot and report everything a player would feel or see
// go wrong - bumps (sudden vertical kicks), airtime, hitting walls (speed lost in a frame),
// camera jumps, rescues - with the path point where each happens.
//   node tools/ride_check.mjs <track> [seconds] [extra url params]     (needs the dev server)
import puppeteer from 'puppeteer-core';
const [track, secs = '120', extra = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 640, height: 360 }, protocolTimeout: 900000 });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:5199/?track=${track}&mute&autopilot&nointro&nohud&record${extra}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.state, { timeout: 600000, polling: 500 });
await page.waitForFunction((s) => window.__ek.state.t >= s || window.__ek.player.finished, { timeout: 1800000, polling: 1000 }, +secs);
const rec = await page.evaluate(() => window.__rec);
const n = await page.evaluate(() => window.__ek.track.n);
await browser.close();
const issues = { bump: [], air: [], wall: [], camera: [], rescue: [] };
let airStart = null;
for (let k = 1; k < rec.length; k++) {
  const [t, p, x, y, z, vy, on, sp, cx, cy, cz, res] = rec[k];
  const [t0, p0, x0, y0, z0, vy0, on0, sp0, cx0, cy0, cz0, res0] = rec[k - 1];
  const dt = Math.max(1e-3, t - t0);
  if (t <= 0.5) continue;                                     // the start
  if (res > res0) issues.rescue.push([p, t]);
  if (Math.abs(vy - vy0) > 22 && on0 && !(res > res0)) issues.bump.push([p, +(vy - vy0).toFixed(0)]);          // a kick up or a drop
  if (!on && on0) airStart = [p, t];
  if (on && !on0 && airStart) { if (t - airStart[1] > 0.35) issues.air.push([airStart[0], +(t - airStart[1]).toFixed(2)]); airStart = null; }
  if (sp0 - sp > 14 && sp0 > 30) issues.wall.push([p, +(sp0 - sp).toFixed(0)]);
  const jump = Math.hypot(cx - cx0, cy - cy0, cz - cz0) - Math.hypot(x - x0, y - y0, z - z0);
  if (jump > 6 && !(res > res0)) issues.camera.push([p, +jump.toFixed(1)]);
}
const last = rec.at(-1);
console.log(`${track}: ${rec.length} frames, reached path point ${last[1]} of ${n} at t=${last[0].toFixed(0)}s, errors ${errors.length}`);
for (const [k, v] of Object.entries(issues)) console.log(`  ${k.padEnd(7)} ${String(v.length).padStart(3)}  ${JSON.stringify(v.slice(0, 30))}`);
