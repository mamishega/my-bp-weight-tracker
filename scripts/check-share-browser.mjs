// End-to-end check of the live doctor link in real Chrome:
// patient creates a link → doctor (separate browser profile) sees the data →
// patient adds a reading → the SAME link shows it → patient turns it off.
// Needs: npm run share:dev  and a build made with
//   VITE_SHARE_API_URL=http://localhost:8787 npm run build && npm run preview
import { chromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
const executablePath = candidates.find((p) => p && existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}
const axeSrc = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exitCode = 1;
};

/** Write a BP session straight into the patient's IndexedDB (then reload). */
async function addSession(page, id, sys, dia) {
  await page.evaluate(
    ({ id, sys, dia }) =>
      new Promise((resolve, reject) => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
        const at = new Date().toISOString();
        const rec = {
          id, sessionType: 'evening', date, measuredAt: at, timeZone: tz, utcOffsetMinutes: -new Date().getTimezoneOffset(),
          readings: [{ systolic: sys, diastolic: dia, pulse: 70, measuredAt: at }, { systolic: sys + 2, diastolic: dia + 2, pulse: 71, measuredAt: at }],
          arm: null, monitorId: null, monitorLabel: null, conditionFlags: [], symptoms: '', notes: `note ${id}`, linkedDoseIds: [], unusualConfirmed: false, createdAt: at, updatedAt: at,
        };
        const req = indexedDB.open('my-bp-weight-tracker');
        req.onsuccess = () => {
          const tx = req.result.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').put(rec);
          tx.oncomplete = () => { req.result.close(); resolve(null); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    { id, sys, dia },
  );
}

const browser = await chromium.launch({ executablePath, headless: true });
const patientCtx = await browser.newContext();
const patient = await patientCtx.newPage();
const errors = [];
patient.on('pageerror', (e) => errors.push(`patient: ${e.message}`));

await patient.goto(BASE + '#/');
await patient.waitForSelector('h1');
await addSession(patient, 'e2e-1', 151, 93);
await patient.goto(BASE + '#/share');
await patient.reload();
await patient.getByRole('heading', { name: 'Share with my doctor' }).waitFor();
await patient.getByLabel(/Name shown to your doctor/).fill('E2E Patient');
await patient.getByRole('button', { name: 'Create link' }).click();
const linkInput = patient.getByLabel('Link', { exact: true });
await linkInput.waitFor({ timeout: 15000 });
const link = await linkInput.inputValue();
link.includes('#/shared/') && link.includes('?k=') ? ok('patient created a live link') : fail(`unexpected link ${link}`);

// The doctor uses a completely separate browser profile.
const doctorCtx = await browser.newContext();
const doctor = await doctorCtx.newPage();
const requests = [];
doctor.on('request', (r) => requests.push(r.url()));
doctor.on('pageerror', (e) => errors.push(`doctor: ${e.message}`));
await doctor.goto(link);
await doctor.getByText(/Last updated by the patient/).waitFor({ timeout: 15000 });
(await doctor.getByText('E2E Patient').count()) ? ok('doctor sees the patient name') : fail('name missing');
(await doctor.getByText('151/93').count()) ? ok('doctor sees the first reading') : fail('first reading missing');
requests.some((u) => u.includes('k=')) ? fail('the key was sent in a request') : ok('the key never left the doctor’s browser');
const dbs = await doctor.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
dbs.length === 0 ? ok('the doctor’s browser stores no app database') : fail(`doctor has databases: ${dbs}`);

// Accessibility (axe-core, incl. colour contrast) in light and dark, desktop and phone.
// A separate profile is used because axe has to be injected past the app's CSP.
for (const colorScheme of ['light', 'dark']) {
  for (const viewport of [{ width: 1360, height: 1000 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ bypassCSP: true, colorScheme, viewport });
    const p = await ctx.newPage();
    await p.goto(link);
    await p.getByText(/Last updated by the patient/).waitFor({ timeout: 15000 });
    await p.waitForTimeout(500);
    await p.addScriptTag({ content: axeSrc });
    const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.help} — ${x.nodes[0].target.join(' ')}`));
    v.length ? fail(`doctor view a11y (${colorScheme}, ${viewport.width}px): ${v.join('; ')}`) : ok(`doctor view: no axe violations (${colorScheme}, ${viewport.width}px)`);
    await ctx.close();
  }
}

// Patient adds a reading; the app uploads within seconds.
await addSession(patient, 'e2e-2', 162, 99);
await patient.reload();
const t0 = Date.now();
let seen = false;
while (!seen && Date.now() - t0 < 45000) {
  await doctor.waitForTimeout(3000);
  await doctor.getByRole('button', { name: 'Refresh' }).click();
  await doctor.waitForTimeout(500);
  seen = (await doctor.getByText('162/99').count()) > 0;
}
seen ? ok(`the same link shows the new reading (${Math.round((Date.now() - t0) / 1000)} s after the patient saved it)`) : fail('new reading not shown within 45 s');

// Turn off sharing → doctor's link stops working.
await patient.getByRole('button', { name: 'Turn off sharing' }).click();
await patient.getByRole('dialog').getByRole('button', { name: 'Turn off sharing' }).click();
await patient.getByRole('button', { name: 'Create link' }).waitFor({ timeout: 15000 });
await doctor.reload();
await doctor.getByText(/turned off or has expired/).waitFor({ timeout: 15000 }).then(() => ok('link stops working after turning sharing off'), () => fail('link still works'));

errors.length ? fail(`page errors:\n  ${errors.join('\n  ')}`) : ok('no page errors');
await browser.close();
