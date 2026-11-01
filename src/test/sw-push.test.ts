// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Run the real service worker's push handler in a sandbox at a given time. */
async function pushAt(iso: string, meta: unknown) {
  const src = readFileSync(new URL('../sw-template.js', import.meta.url), 'utf8').replace('__BUILD_ID__', 't').replace('__PRECACHE__', '[]');
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; opts: { body: string; data: { url: string } } }[] = [];
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a: ConstructorParameters<typeof Date>) {
      super(...((a.length ? a : [iso]) as [string]));
    }
    static now() { return RealDate.parse(iso); }
  }
  const self = {
    location: { origin: 'https://app.example' },
    registration: { scope: 'https://app.example/app/', showNotification: async (title: string, opts: never) => { shown.push({ title, opts }); } },
    addEventListener: (name: string, fn: (e: unknown) => void) => { handlers[name] = fn; },
    clients: {},
  };
  const caches = { open: async () => ({ match: async () => new Response(JSON.stringify(meta)) }) };
  vm.runInNewContext(src, { self, caches, Date: FakeDate, Intl, URL, Response, Promise, Object, Number, JSON, console });
  let done: Promise<unknown> = Promise.resolve();
  handlers.push({ waitUntil: (p: Promise<unknown>) => { done = p; } });
  await done;
  return shown[0];
}

const items = [
  { t: '07:30', title: 'Morning blood pressure', body: 'b1', url: '#/add?type=morning_pre' },
  { t: '07:30', d: [1], title: 'Weight (optional)', body: 'b2', url: '#/weight' },
  { t: '07:30', n: 2, s: '2026-11-02', title: 'Medication — record it', body: 'b3', url: '#/medication' },
];

describe('service worker push: which reminder to show', () => {
  it('shows only reminders due on that day (weekday and every-N-days respected)', async () => {
    // Mon 2 Nov 2026 07:31 UTC: all three are due.
    const mon = await pushAt('2026-11-02T07:31:00Z', { tz: 'UTC', items });
    expect(mon.title).toBe('Morning blood pressure · Weight (optional) · Medication — record it');
    // Tue 3 Nov: only the daily one.
    const tue = await pushAt('2026-11-03T07:31:00Z', { tz: 'UTC', items });
    expect(tue.title).toBe('Morning blood pressure');
    expect(tue.opts.body).toBe('b1');
    expect(tue.opts.data.url).toBe('#/add?type=morning_pre');
  });

  it('falls back to a generic reminder (e.g. a test push)', async () => {
    const r = await pushAt('2026-11-03T12:00:00Z', { tz: 'UTC', items });
    expect(r.title).toBe('Reminder from My BP & Weight');
  });
});
