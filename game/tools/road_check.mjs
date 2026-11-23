// Road smoothness check: how bumpy the road surface is, and where the zone pokes through it.
//   node tools/road_check.mjs [tracks...]        (needs the dev server)
// Per track: worst and count of along-track kinks (change of slope between 6-unit steps),
// across-road kinks (deviation of the surface from a straight line across), and samples where
// the zone's ground stands above the road surface (it shows through / the karts hit it).
import puppeteer from 'puppeteer-core';
import { TRACK_IDS } from './tracks.mjs';
const all = TRACK_IDS;
const tracks = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const verbose = process.argv.includes('-v');
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], protocolTimeout: 600000 });
const out = {};
for (const t of tracks.length ? tracks : all) {
  const page = await browser.newPage();
  await page.goto(`http://localhost:5199/?track=${t}&mute&autopilot&nohud`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ek?.road, { timeout: 300000, polling: 500 });
  const r = await page.evaluate(() => {
    const { H, C, X, Z } = window.__ek.road;
    const path = window.__ek.track.path;
    const n = H.length, mid = (C - 1) / 2;
    const step = (i) => Math.max(1, Math.hypot(path[(i + 1) % n].x - path[i].x, path[(i + 1) % n].z - path[i].z));
    let kinks = 0, worstKink = 0, worstAt = 0, cross = 0, worstCross = 0, poke = 0, poke2 = 0, worstPoke = 0, pokeAt = 0, wall = 0;
    const spots = [];
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      for (const j of [2, mid, C - 3]) {
        const s1 = (H[i][j] - H[a][j]) / step(a), s2 = (H[b][j] - H[i][j]) / step(i);
        const k = Math.abs(s2 - s1);
        if (k > 0.06) kinks++;
        if (k > worstKink) { worstKink = k; worstAt = i; }
      }
      // across: deviation from the straight line between the two road edges
      for (let j = 2; j <= C - 3; j++) {
        // (by distance across: the road's columns need not be evenly spaced - each side has its own width)
        const span = Math.hypot(X[i][C - 3] - X[i][2], Z[i][C - 3] - Z[i][2]);
        const u = span > 1e-6 ? Math.hypot(X[i][j] - X[i][2], Z[i][j] - Z[i][2]) / span : 0.5;
        const lin = H[i][2] * (1 - u) + H[i][C - 3] * u;
        const d = Math.abs(H[i][j] - lin);
        if (d > 0.5) cross++;
        worstCross = Math.max(worstCross, d);
        const top = window.__ek.groundAt(X[i][j], H[i][j] + 12, Z[i][j]);
        const p = top === null ? 0 : top - H[i][j] - (window.__ek.track.surfaceLift ?? 0);   // something above the road's surface (not the road itself)
        const edge = j === 2 || j === C - 3;            // the road's own edge: a wall beside the road is fine
        if (p > 0.15 && !edge) poke++;
        if (p > 1 && edge) wall++;
        if (p > 1 && !edge) { poke2++; spots.push([i, j, +p.toFixed(1)]); }
        if (p > worstPoke && !edge) { worstPoke = p; pokeAt = i; }
      }
    }
    return { n, kinks, worstKink: +worstKink.toFixed(3), worstAt, cross, worstCross: +worstCross.toFixed(2), wall, poke, poke2, worstPoke: +worstPoke.toFixed(1), pokeAt, spots: spots.slice(0, 40) };
  });
  out[t] = r;
  const { spots, ...row } = r;
  console.log(t.padEnd(14), JSON.stringify(row));
  if (verbose) console.log('   pokes:', JSON.stringify(spots));
  await page.close();
}
await browser.close();
