// A close look at one NPC in the game (by name, e.g. Hoshkar, or model code)
//   node tools/npc_shot.mjs <track> <name> <out.png>     (needs the dev server)
import puppeteer from 'puppeteer-core';
const [track, name, out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 960, height: 540 }, protocolTimeout: 900000 });
let page = await browser.newPage();
await page.goto(`http://localhost:5199/?track=${track}&mute&nointro&nohud`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.state, { timeout: 600000, polling: 500 });
const idx = await page.evaluate((n) => window.__ek.npcs.placed.findIndex((s) => s.name === n || s.model === n), name);
await page.close();
page = await browser.newPage();
await page.goto(`http://localhost:5199/?track=${track}&mute&nointro&nohud&npc=${idx}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.state, { timeout: 600000, polling: 500 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: out });
console.log('npc', idx);
await browser.close();
