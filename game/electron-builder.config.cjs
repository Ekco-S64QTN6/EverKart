// Packaging the desktop app (electron-builder) for the system it is built on:
//   Linux    release/EverKart-<version>.AppImage
//   Windows  release/EverKart-Setup-<version>.exe   (an installer: Start menu + desktop shortcut)
// The game data inside it is built from your own EverQuest files (python3 tools/build.py), so the
// app you build is yours alone - do not share it.
const fs = require('node:fs');

// A system Electron 39 (e.g. Arch Linux's electron39 package) packages offline in seconds;
// anywhere else electron-builder downloads the same Electron release.
const SYSTEM_ELECTRON = '/usr/lib/electron39';

module.exports = {
  appId: 'io.github.everkart',
  productName: 'EverKart',
  copyright: 'EverKart contributors. EverQuest is a trademark of Daybreak Game Company LLC.',
  directories: { output: 'release' },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  asar: false,
  electronVersion: '39.8.10',
  ...(fs.existsSync(SYSTEM_ELECTRON) ? { electronDist: SYSTEM_ELECTRON } : {}),
  linux: {
    target: ['AppImage'],
    category: 'Game',
    icon: 'electron/icon.png',
    artifactName: 'EverKart-${version}.${ext}',
  },
  win: {
    target: ['nsis'],
    icon: 'electron/icon.png',
    artifactName: 'EverKart-Setup-${version}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'EverKart',
    runAfterFinish: true,
  },
};
