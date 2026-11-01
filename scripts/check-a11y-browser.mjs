// Real-browser accessibility check (axe-core, including colour contrast) in
// light and dark mode on every page, using sample data. Requires a built app
// served at BASE_URL (default http://localhost:4173/) and Chrome/Chromium.
//   npm run build && npm run preview &   then   npm run check:a11y
import { chromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const executablePath = candidates.find((p) => p && existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}
const axeSrc = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const ROUTES = ['#/', '#/add?type=morning_post', '#/medication', '#/weight', '#/symptoms', '#/symptoms?tab=lifestyle', '#/symptoms?tab=habits', '#/trends', '#/history', '#/report', '#/appointments', '#/settings'];

const browser = await chromium.launch({ executablePath, headless: true });
let failures = 0;
for (const colorScheme of ['light', 'dark']) {
  for (const viewport of [{ width: 1360, height: 1000 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport, colorScheme, bypassCSP: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '#/settings');
    await page.getByRole('button', { name: /Open demo mode/ }).click();
    await page.waitForTimeout(1200);
    for (const r of ROUTES) {
      await page.goto(BASE + r);
      await page.waitForSelector('h1', { timeout: 10000 });
      await page.waitForTimeout(500);
      await page.addScriptTag({ content: axeSrc });
      const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id} (${x.nodes.length}): ${x.help} — ${x.nodes[0].target.join(' ')}`));
      if (v.length) {
        failures += v.length;
        console.log(`✗ ${colorScheme} ${viewport.width}px ${r}\n  ${v.join('\n  ')}`);
      }
    }
    if (errors.length) {
      failures += errors.length;
      console.log(`✗ ${colorScheme} ${viewport.width}px page errors:\n  ${errors.join('\n  ')}`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} accessibility problem(s) found.` : '✓ No accessibility violations (light + dark, desktop + mobile, all pages).');
process.exit(failures ? 1 : 0);
