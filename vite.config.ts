/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

/**
 * Builds the service worker from src/sw-template.js at build time, injecting
 * the build id and the full list of emitted files so the whole app shell is
 * precached on install (offline use works after the first successful load).
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'bpt-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = [
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
        'icons/apple-touch-icon.png',
        'icons/icon.svg',
      ];
      const precache = ['./', ...files, ...publicFiles];
      const template = readFileSync(
        fileURLToPath(new URL('./src/sw-template.js', import.meta.url)),
        'utf8',
      );
      const source = template
        .replace('__BUILD_ID__', BUILD_ID)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: { TZ: 'UTC' },
  },
});
