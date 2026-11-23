// EverQuest's own sound effects (tools/export_sfx.py): your kart's mine-cart rumble, the
// countdown, the level-up ding at the finish, and every spell's cast, flight and landing.
// Sounds placed in the world fade with distance and pan left / right with the camera.
import * as THREE from 'three';

const NAMES = ['kart', 'tick', 'go', 'ding', 'pickup', 'cast', 'travel', 'fire', 'hit', 'snare', 'thunder',
  'gate', 'wolf', 'invis', 'whirl', 'whoosh', 'bump'];
const REACH = 160;              // beyond this a sound in the world is silent

export class Sfx {
  constructor(enabled) {
    this.enabled = enabled;
    this.buffers = {};
    this.live = [];               // playing sounds that follow something in the world
    this.ear = new THREE.Vector3();
    this.right = new THREE.Vector3(1, 0, 0);
  }

  async load() {
    if (!this.enabled || !window.AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    const wake = () => { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
    addEventListener('keydown', wake);
    addEventListener('pointerdown', wake);
    this.wake = wake;
    wake();
    await Promise.all(NAMES.map(async (n) => {
      try {
        const data = await (await fetch(`sfx/${n}.ogg`)).arrayBuffer();
        this.buffers[n] = await this.ctx.decodeAudioData(data);
      } catch { /* a missing sound stays silent */ }
    }));
  }

  // where the listener is (the camera) and which way is right
  listen(camera) {
    if (!this.ctx) return;
    this.ear.copy(camera.position);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const h of this.live) this.place(h);
    this.live = this.live.filter((h) => !h.done);
  }

  place(h) {
    if (!h.at) return;
    const p = typeof h.at === 'function' ? h.at() : h.at;
    if (!p) return;
    const to = p.clone().sub(this.ear);
    const d = to.length();
    const fall = Math.max(0, 1 - d / REACH) ** 1.6;
    h.gain.gain.setTargetAtTime(h.vol * fall, this.ctx.currentTime, 0.05);
    if (h.pan) h.pan.pan.setTargetAtTime(THREE.MathUtils.clamp(to.dot(this.right) / Math.max(d, 1), -0.9, 0.9), this.ctx.currentTime, 0.05);
  }

  // play a sound: at (a point, or a function giving one) places it in the world; dur cuts it
  // short with a fade (the casting chant); loop keeps it going until stop()
  play(name, { at = null, vol = 1, rate = 1, loop = false, dur = 0 } = {}) {
    const buf = this.buffers[name];
    if (!this.ctx || !buf) return { stop() {}, rate() {}, volume() {} };
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    src.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(this.master); } else gain.connect(this.master);
    const h = { src, gain, pan, at, vol, done: false };
    gain.gain.value = at ? 0 : vol;
    if (at) { this.place(h); this.live.push(h); }
    const t0 = this.ctx.currentTime;
    src.start(t0);
    if (dur) {
      gain.gain.setTargetAtTime(0, t0 + dur, 0.12);
      src.stop(t0 + dur + 0.6);
    }
    src.onended = () => { h.done = true; };
    h.stop = (fade = 0.15) => {
      if (h.done) return;
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
      try { src.stop(this.ctx.currentTime + fade); } catch { /* already stopped */ }
      h.done = true;
    };
    h.rate = (r) => src.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.05);
    h.volume = (v) => { h.vol = v; if (!at) gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); };
    return h;
  }

  pause(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }
}
