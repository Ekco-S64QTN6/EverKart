const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('everkart', {
  quit: () => ipcRenderer.send('quit'),
  setFullscreen: (on) => ipcRenderer.send('fullscreen', !!on),     // the options screen
  log: (line) => ipcRenderer.send('log', String(line).slice(0, 4000)),   // a line in this session's log file
  desktop: true,
});
