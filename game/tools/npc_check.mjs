// What a track placed: intro shots, NPCs by behaviour, named NPCs, kiting / training rings
//   node tools/npc_check.mjs <track>     (needs the dev server; skipped scenes are explained)
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 640, height: 360 }, protocolTimeout: 900000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('console', (m) => { if (/error|warn|npc|vignette/i.test(m.text())) console.log('[page]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:5199/?track=${process.argv[2]}&mute&nointro`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.state, { timeout: 600000, polling: 500 });
console.log(await page.evaluate(() => JSON.stringify({
  shots: window.__ek.npcs.shots.map((s) => ({ title: s.title, pos: s.pos.toArray().map(Math.round), h: s.height, r: s.radius })),
  byKind: window.__ek.npcs.placed.reduce((a, s) => { const k = s.raidBoss ? 'boss' : s.fighter ? 'fighter' : s.circle ? 'circle' : s.roam ? 'roam' : s.patrol ? 'patrol' : s.crowd ? 'crowd' : 'other'; a[k] = (a[k] || 0) + 1; return a; }, {}),
  named: window.__ek.npcs.placed.filter((s) => s.name).map((s) => [s.name, s.npc.position.toArray().map(Math.round)]),
  circles: window.__ek.npcs.placed.filter((s) => s.circle).map((s) => [s.npc.position.toArray().map(Math.round), Math.round(s.circle.R)]),
})));
await browser.close();
