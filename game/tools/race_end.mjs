// Full race on autopilot (1 lap) until the results screen shows; screenshot it.
import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 640, height: 360 }, protocolTimeout: 1500000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('results').hidden, { timeout: 600000, polling: 1000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: out });
console.log(await page.evaluate(() => document.getElementById('standings').innerText.replace(/\t/g, ' | ')));
console.log('rescues', await page.evaluate(() => JSON.stringify(window.__ek?.karts?.map((k) => k.rescues ?? 0) ?? window.__ek?.state?.rescues)));
await browser.close();
