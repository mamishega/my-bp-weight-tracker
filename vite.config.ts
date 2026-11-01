/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
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

/**
 * The optional doctor-share relay (VITE_SHARE_API_URL) must be allowed by the
 * Content-Security-Policy; nothing else beyond the app's own origin is.
 */
function shareOrigin(url: string | undefined): string | null {
  if (!url) return null;
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('VITE_SHARE_API_URL must use https://');
  return u.origin;
}

function cspPlugin(origin: string | null): Plugin {
  return {
    name: 'bpt-csp',
    transformIndexHtml(html) {
      return origin ? html.replace("connect-src 'self'", `connect-src 'self' ${origin}`) : html;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const origin = shareOrigin(env.VITE_SHARE_API_URL || process.env.VITE_SHARE_API_URL);
  return {
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), tailwindcss(), serviceWorkerPlugin(), cspPlugin(origin)],
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: { TZ: 'UTC' },
  },
  };
});
