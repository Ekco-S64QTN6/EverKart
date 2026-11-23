// Drive test with real key presses: accelerate, then hold Right, then Left; check the
// kart turns that way, moves that way, and its model faces where it is going.
import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ek?.state?.t > 0.3, { timeout: 180000 });
const snap = () => page.evaluate(() => {
  const p = window.__ek.player;
  const f = p.forward();
  const m = new p.mesh.position.constructor(0, 0, -1).applyQuaternion(p.mesh.quaternion);
  return { yaw: p.yaw, pos: p.pos.toArray(), speed: p.speed, meshVsHeading: m.x * f.x + m.z * f.z, t: window.__ek.state.t };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.keyboard.down('ArrowUp');
await sleep(2500);
const a = await snap();
for (const [key, label] of [['ArrowRight', 'right'], ['ArrowLeft', 'left']]) {
  const s0 = await snap();
  await page.keyboard.down(key);
  await sleep(500);
  await page.keyboard.up(key);
  const s1 = await snap();
  const right = [Math.cos(s0.yaw), Math.sin(s0.yaw)];          // x, z of "right" for this heading
  const d = [s1.pos[0] - s0.pos[0], s1.pos[2] - s0.pos[2]];
  const side = d[0] * right[0] + d[1] * right[1];
  console.log(`${label}: yaw ${(s1.yaw - s0.yaw).toFixed(2)} rad, sideways ${side.toFixed(1)} units ` +
    `(+ is right), speed ${s1.speed.toFixed(0)}, model faces heading ${s1.meshVsHeading.toFixed(2)}`);
  await sleep(300);
}

// drift: hold Right + Space for 1.6 s, release, check turbo
await page.keyboard.down('ArrowRight');
await page.keyboard.down(' ');
await sleep(1600);
const dr = await page.evaluate(() => ({ drifting: window.__ek.player.drifting, charge: window.__ek.player.charge }));
await page.keyboard.up(' ');
await sleep(80);
const tb = await page.evaluate(() => window.__ek.player.turbo);
console.log('drift: drifting', dr.drifting, 'charge', dr.charge.toFixed(2), '-> turbo', tb.toFixed(2));
await page.keyboard.up('ArrowRight');
console.log('after accelerating 2.5 s: speed', a.speed.toFixed(0));
console.log('state', await page.evaluate(() => {
  const p = window.__ek.player, t = window.__ek.track, i = p.progress, s = t.sides[i], c = t.path[i];
  const lat = (p.pos.x - c.x) * s.x + (p.pos.z - c.z) * s.z;
  return JSON.stringify({ lat: lat.toFixed(1), railR: t.railR[i], railL: t.railL[i], prog: i, onGround: p.onGround,
    vel: p.vel.toArray().map((v) => v.toFixed(1)), yaw: p.yaw.toFixed(2), spin: p.spin, slow: p.slow, offTrack: p.offTrack?.toFixed(1),
    drifting: p.drifting, input: p.input, others: window.__ek.karts.slice(1).map((k) => Math.round(k.pos.distanceTo(p.pos))) });
}));
await browser.close();
