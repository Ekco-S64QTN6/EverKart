// EverKart desktop app: a fullscreen game window that serves the built game from the
// app:// scheme (so fetch / glTF loading work exactly as on a web server).
//
//   everkart                     title screen
//   everkart --track=kael        straight into a race (also --autopilot, --mute, --laps=N)
//   everkart --windowed          start in a window instead of fullscreen
//   EVERKART_DEV=1 everkart      load the Vite dev server instead of dist/
const { app, BrowserWindow, protocol, net, ipcMain, Menu } = require('electron');
const path = require('node:path');
const url = require('node:url');

if (process.env.EVERKART_DEBUG) {          // headless testing: software GL, page console to stdout
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const DIST = path.join(__dirname, '..', 'dist');
const args = process.argv.slice(1);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => flag(name)?.split('=')[1];

function query() {
  const q = new URLSearchParams();
  if (value('track')) q.set('track', value('track'));
  if (value('racer')) q.set('racer', value('racer'));
  for (const f of ['autopilot', 'mute']) if (flag(f)) q.set(f, '');
  if (value('laps')) q.set('laps', value('laps'));
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Every session writes a log (~/.config/EverKart/logs/everkart-<time>.log, the last 10 kept):
// the page's console, errors, renderer / GPU crashes and hangs, and the game's heartbeat (track,
// race time, fps, memory every few seconds) - after a crash or a hard lock, its last lines say
// what was going on.
const fs = require('node:fs');
let logFile = null;
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
  if (process.env.EVERKART_DEBUG) process.stdout.write(line);
  if (logFile) try { fs.appendFileSync(logFile, line); } catch { /* the log must never take the game down */ }
}
function openLog() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const old = fs.readdirSync(dir).filter((f) => f.startsWith('everkart-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 9))) fs.rmSync(path.join(dir, f), { force: true });
    logFile = path.join(dir, `everkart-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    log('EverKart', app.getVersion(), 'electron', process.versions.electron, 'args', JSON.stringify(args));
  } catch (e) { console.error('no log file:', e); }
}
app.on('child-process-gone', (e, d) => log('[crash] child process gone:', d.type, d.reason, 'exit', d.exitCode, d.name || ''));
process.on('uncaughtException', (e) => log('[crash] main process:', e.stack || e));

app.whenReady().then(() => {
  openLog();
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(url.pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1600, height: 900, title: 'EverKart', backgroundColor: '#000000',
    fullscreen: !flag('windowed'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false },
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  ipcMain.on('quit', () => { log('quit'); app.quit(); });
  ipcMain.on('fullscreen', (e, on) => { if (win.isFullScreen() !== on) win.setFullScreen(on); });
  ipcMain.on('log', (e, line) => log(line));
  win.webContents.on('console-message', (e, level, message) => log(`[page${typeof level === 'number' && level >= 2 ? ' ' + ['', '', 'warn', 'error'][level] : ''}]`, e.message ?? message ?? e));
  win.webContents.on('did-fail-load', (e, code, desc, u) => log('[load failed]', code, desc, u));
  win.webContents.on('render-process-gone', (e, d) => log('[crash] renderer gone:', d.reason, 'exit', d.exitCode));
  win.webContents.on('unresponsive', () => log('[hang] the game window stopped responding'));
  win.webContents.on('responsive', () => log('[hang] responding again'));
  win.on('closed', () => log('window closed'));
  if (process.env.EVERKART_DEBUG) {
    // EVERKART_SHOTS="20,40" EVERKART_SHOTDIR=/tmp/x : screenshots + race state at those seconds
    const fs = require('node:fs');
    for (const sec of (process.env.EVERKART_SHOTS || '').split(',').filter(Boolean)) {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.EVERKART_SHOTDIR || '.', `app_${sec}.png`), img.toPNG());
        const st = await win.webContents.executeJavaScript('JSON.stringify(window.__ek?.state ?? null)');
        log(`[state ${sec}s]`, st);
      }, Number(sec) * 1000);
    }
  }
  win.loadURL(process.env.EVERKART_DEV ? `http://localhost:5199/${query()}` : `app://game/index.html${query()}`);
});
app.on('window-all-closed', () => app.quit());
