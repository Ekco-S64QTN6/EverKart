import { defineConfig } from 'vite';

// relative paths so the same build runs from the desktop app (app:// protocol)
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('./package.json', 'utf8')).version;
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD__: JSON.stringify(`v${version} · built ${stamp} UTC`) },
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  server: { port: 5199, hmr: !process.env.NO_HMR },   // NO_HMR=1: headless tests are not reloaded by edits
});
