// The front end, screen by screen, driven with real key presses: title, main menu, racer select
// (and a held arrow running through the list), track select, campaign cups, options.
//   node tools/menu_shot.mjs <outdir> [--race]     (needs the dev server; --race: start the race too)
//   node tools/menu_shot.mjs <outdir> --campaign   (a finished cup: the standings, then the podium)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [out, flag] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1600, height: 900 }, protocolTimeout: 900000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (flag === '--campaign') {                           // a cup with every race run: standings, then the podium
  await page.goto('http://localhost:5199/?nothing', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('ek.campaign', JSON.stringify({
    cup: 'dragons', racer: { code: 'BAF', armor: 2 }, difficulty: 1, race: 3,
    field: [['OGM', 3, 'Throgg'], ['HIF', 1, 'Lanys'], ['GNM', 0, 'Fizzwix'], ['DEN', 0, 'Grubnak'], ['IKF', 2, 'Sssylith'], ['DWM', 3, 'Brokk'], ['VSF', 0, 'Mirela']]
      .map(([code, armor, name]) => ({ code, armor, name })),
    points: { You: 24, Throgg: 26, Lanys: 18, Fizzwix: 9, Grubnak: 12, Sssylith: 7, Brokk: 14, Mirela: 4 },
    last: [{ name: 'Throgg', gained: 10 }, { name: 'You', gained: 8 }, { name: 'Brokk', gained: 6 }] })));
  await page.goto('http://localhost:5199/?standings', { waitUntil: 'load' });
  await sleep(5000);
  await page.screenshot({ path: `${out}/1_standings.png` });
  await page.keyboard.press('Enter');
  await sleep(5000);
  await page.screenshot({ path: `${out}/2_podium.png` });
  console.log('standings, podium');
  await browser.close();
  process.exit(0);
}
await page.evaluateOnNewDocument(() => localStorage.clear());
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
const shot = async (name, wait = 1500) => { await sleep(wait); await page.screenshot({ path: `${out}/${name}.png` }); console.log(name); };
const press = async (key, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await sleep(260); } };
await shot('1_title', 6000);
await press('Enter');
await shot('2_main');
await press('Enter');                                  // Single Race
await shot('3_racer', 4000);
await press('ArrowRight', 3);
await shot('4_racer_right3', 3000);
await page.keyboard.down('ArrowRight'); await sleep(2500); await page.keyboard.up('ArrowRight');   // hold: run through the list
await shot('5_racer_held', 3000);
await press('ArrowUp');                                // armor
await shot('6_racer_armor', 2000);
await press('Enter');
await shot('7_track');
await press('ArrowRight', 2);
await shot('8_track_right2');
if (flag === '--race') {
  await press('Enter');
  await shot('9_loading', 800);
  await page.waitForFunction(() => window.__ek?.state, { timeout: 600000, polling: 500 });
  await shot('10_race', 2000);
} else {
  await press('Escape', 2);                            // back to the main menu
  await press('ArrowDown');
  await press('Enter');                                // Campaign
  await shot('9_cups');
  await press('ArrowDown');
  await shot('10_cups_rivals', 800);
  await press('Escape');
  await press('ArrowDown');
  await press('Enter');                                // Options
  await shot('11_options');
  await press('e');
  await shot('12_options_audio', 800);
  await press('e', 2);
  await shot('13_options_controls', 800);
}
await browser.close();
