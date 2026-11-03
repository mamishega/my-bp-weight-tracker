import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreProvider } from '../store/Store';
import { ToastProvider } from '../components/ui';
import { App } from '../App';
import { closeStore, DB_NAMES, loadAll, lock } from '../db/db';
import { walkMinutes } from '../lib/habits';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

async function setHash(hash: string) {
  if (window.location.hash === hash) return;
  await new Promise<void>((r) => { window.addEventListener('hashchange', () => r(), { once: true }); window.location.hash = hash; });
}

beforeEach(async () => {
  await closeStore('real');
  lock('real');
  for (const n of Object.values(DB_NAMES)) await new Promise((r) => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});

describe('walking goal length', () => {
  it('recognises the length from the field or an older habit name', () => {
    const h = { id: 'h', active: true, createdAt: '', updatedAt: '' };
    expect(walkMinutes({ ...h, name: 'Walk', minutes: 35 })).toBe(35);
    expect(walkMinutes({ ...h, name: 'Walk for 20 minutes' })).toBe(20);
    expect(walkMinutes({ ...h, name: 'Prepare a meal at home' })).toBeNull();
  });

  it('adds a walk of the chosen length, changes it later and keeps the ticked days', async () => {
    const user = userEvent.setup();
    await setHash('#/symptoms?tab=habits');
    render(<StoreProvider initialMode="real"><ToastProvider><App /></ToastProvider></StoreProvider>);
    await user.click(await screen.findByRole('button', { name: '30 min' }));
    await waitFor(async () => expect((await loadAll('real')).habits.map((x) => [x.name, x.minutes])).toEqual([['Walk for 30 minutes', 30]]));
    const id = (await loadAll('real')).habits[0].id;
    await user.click((await screen.findAllByRole('checkbox', { name: /Walk for 30 minutes on/ }))[0]); // Monday is never in the future
    await waitFor(async () => expect((await loadAll('real')).habitChecks).toHaveLength(1));

    const field = screen.getByLabelText('Other length (minutes)');
    await user.clear(field);
    await user.type(field, '3');
    await user.click(screen.getByRole('button', { name: 'Update walk' }));
    expect(await screen.findByText(/from 5 to 240/)).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '50');
    await user.click(screen.getByRole('button', { name: 'Update walk' }));
    await waitFor(async () => {
      const d = await loadAll('real');
      expect(d.habits).toHaveLength(1);
      expect(d.habits[0]).toMatchObject({ id, name: 'Walk for 50 minutes', minutes: 50 });
      expect(d.habitChecks).toHaveLength(1);
    });
    // The field shows the saved length, and a second walk can't be added by typing its name.
    expect(screen.getByLabelText('Other length (minutes)')).toHaveValue('50');
    await user.type(screen.getByLabelText('New habit'), 'walk for 15 mins');
    await user.click(screen.getByRole('button', { name: 'Add habit' }));
    expect(await screen.findByText(/already have a walking goal/)).toBeInTheDocument();
    expect((await loadAll('real')).habits).toHaveLength(1);
  });
});
