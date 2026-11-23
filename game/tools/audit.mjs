// Visual audit: screenshots down the road at evenly spaced path points on every track, joined
// into one contact sheet per track (needs the dev server and python3 + PIL for the sheet).
//   node tools/audit.mjs <outdir> [shots per track] [tracks...]
import puppeteer from 'puppeteer-core';
import { TRACK_IDS } from './tracks.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const all = TRACK_IDS;
const [out, nArg, ...rest] = process.argv.slice(2);
const per = parseInt(nArg || '15', 10);
const tracks = rest.length ? rest : all;
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 800, height: 450 }, protocolTimeout: 900000 });
async function one(t) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/error|decor on/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:5199/?track=${t}&mute&nohud&nointro&day=100000${process.env.EXTRA || ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ek?.road || window.__ek?.state, { timeout: 300000, polling: 500 });
  const n = await page.evaluate(() => window.__ek.track.n);
  const files = [];
  for (let k = 0; k < per; k++) {
    const p = Math.floor((k * n) / per);
    await page.evaluate((p) => { window.__camAt = p; window.__camUp = 4; }, p);
    await new Promise((r) => setTimeout(r, 900));
    const f = `${out}/${t}_${String(p).padStart(4, '0')}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  console.log(t.padEnd(14), `n=${n}`, errors.length ? `errors: ${errors.slice(0, 3).join(' | ')}` : '');
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = sys.argv[2:]
W = 4; w, h = 400, 225
out = Image.new('RGB', (w * W, h * ((len(fs) + W - 1) // W)))
for i, f in enumerate(fs):
    im = Image.open(f).resize((w, h)); ImageDraw.Draw(im).text((6, 6), f.split('_')[-1][:-4], fill=(255, 255, 0))
    out.paste(im, ((i % W) * w, (i // W) * h))
out.save(sys.argv[1])`, `${out}/sheet_${t}.png`, ...files]);
  await page.close();
}
for (const t of tracks) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await one(t); break; } catch (e) { console.log(t, 'failed:', e.message.slice(0, 120)); }
  }
}
await browser.close();
