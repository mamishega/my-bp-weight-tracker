import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { StoreProvider } from '../store/Store';
import { ToastProvider } from '../components/ui';
import { App } from '../App';
import { closeStore, DB_NAMES, replaceAll, lock } from '../db/db';
import { buildDemoData } from '../lib/demo';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

const ROUTES = ['#/', '#/add?type=morning_post', '#/medication', '#/weight', '#/symptoms', '#/symptoms?tab=lifestyle', '#/symptoms?tab=habits', '#/trends', '#/history', '#/report', '#/appointments', '#/share', '#/week', '#/week?id=demo-week', '#/settings'];

beforeAll(async () => {
  await closeStore('demo');
  lock('demo');
  await new Promise((r) => { const q = indexedDB.deleteDatabase(DB_NAMES.demo); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
  await replaceAll('demo', buildDemoData('Australia/Sydney'));
});

describe('automated accessibility (axe-core) on every page with sample data', () => {
  for (const route of ROUTES) {
    it(`${route} has no axe violations`, async () => {
      await new Promise<void>((r) => { if (window.location.hash === route) return r(); window.addEventListener('hashchange', () => r(), { once: true }); window.location.hash = route; });
      const { container } = render(<StoreProvider initialMode="demo"><ToastProvider><App /></ToastProvider></StoreProvider>);
      await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
      const res = await axe.run(container, {
        rules: {
          'color-contrast': { enabled: false }, // jsdom has no layout/colour engine; checked in browser instead
          region: { enabled: false },
        },
      });
      const summary = res.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      cleanup();
      expect(res.passes.length).toBeGreaterThan(15); // rules really ran against the page
      expect(summary).toEqual([]);
    }, 20000);
  }
});
