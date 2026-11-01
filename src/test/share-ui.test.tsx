import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { StoreProvider } from '../store/Store';
import { ToastProvider } from '../components/ui';
import { App } from '../App';
import { SharedView } from '../pages/SharedView';
import { closeStore, DB_NAMES, loadAll, lock, replaceAll } from '../db/db';
import { buildDemoData } from '../lib/demo';
import { DEFAULT_SHARE_OPTIONS, _resetSyncForTests, createShare, deleteShare, parseShareHash, resolveShareId } from '../lib/share';
import { installFakeShareServer, TEST_API } from './fakeShareServer';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

async function setHash(hash: string) {
  if (window.location.hash === hash) return;
  await new Promise<void>((r) => { window.addEventListener('hashchange', () => r(), { once: true }); window.location.hash = hash; });
}

let server: ReturnType<typeof installFakeShareServer>;
beforeEach(async () => {
  vi.stubEnv('VITE_SHARE_API_URL', TEST_API);
  server = installFakeShareServer();
  _resetSyncForTests();
  localStorage.clear();
  await closeStore('real');
  lock('real');
  for (const n of Object.values(DB_NAMES)) await new Promise((r) => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});
afterEach(() => {
  cleanup();
  server.restore();
  vi.unstubAllEnvs();
});

describe('doctor share link (patient side)', () => {
  it('creates a live link, saves it, and turns it off', async () => {
    const user = userEvent.setup();
    const data = buildDemoData('Australia/Sydney');
    await replaceAll('real', data);
    await setHash('#/share');
    render(<StoreProvider initialMode="real"><ToastProvider><App /></ToastProvider></StoreProvider>);
    await screen.findByRole('heading', { level: 1, name: 'Share with my doctor' });
    await user.type(screen.getByLabelText(/name shown to your doctor/i), 'Sam Citizen');
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    const input = (await screen.findByLabelText('Link', {}, { timeout: 5000 })) as HTMLInputElement;
    expect(input.value).toMatch(/#\/d\/sam-citizen\/[A-Za-z0-9_-]{16}$/);
    const parsed = parseShareHash(new URL(input.value).hash);
    expect(parsed).not.toBeNull();
    const id = await resolveShareId(parsed!);
    const saved = await loadAll('real');
    expect(saved.settings.share?.id).toBe(id);
    expect(saved.settings.share?.linkName).toBe('sam-citizen');
    expect(saved.settings.share?.options.displayName).toBe('Sam Citizen');
    expect(server.env.SHARES.map.has(`share:${id}`)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Turn off sharing' }));
    const dialogButtons = await screen.findAllByRole('button', { name: 'Turn off sharing' });
    await user.click(dialogButtons[dialogButtons.length - 1]);
    await screen.findByRole('button', { name: 'Create link' }, { timeout: 5000 });
    expect(server.env.SHARES.map.has(`share:${id}`)).toBe(false);
    expect((await loadAll('real')).settings.share).toBeNull();
  }, 20000);

  it('explains when sharing is not set up', async () => {
    vi.stubEnv('VITE_SHARE_API_URL', '');
    await setHash('#/share');
    render(<StoreProvider initialMode="real"><ToastProvider><App /></ToastProvider></StoreProvider>);
    expect(await screen.findByText(/sharing isn’t set up for this copy of the app/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull();
  });
});

describe('doctor share link (doctor side)', () => {
  it('shows the decrypted records read-only, with no accessibility violations', async () => {
    const data = buildDemoData('Australia/Sydney');
    const cfg = await createShare(data, { ...DEFAULT_SHARE_OPTIONS, displayName: 'Sam Citizen' }, 30);
    const { container } = render(<SharedView link={{ id: null, key: cfg.key, name: 'sam-citizen' }} />);
    await screen.findByText(/last updated by the patient/i, {}, { timeout: 5000 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/blood pressure & weight summary/i);
    expect(screen.getByText(/Sam Citizen/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Original readings' })).toBeInTheDocument();
    // Dashboard overview at the top.
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument();
    expect(screen.getByText('Latest reading')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Average by session type' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Five most recent blood pressure sessions' })).toBeInTheDocument();
    expect(screen.getByText(/not monitored/i)).toBeInTheDocument();
    // No editing controls on the doctor's view.
    expect(screen.queryByRole('textbox')).toBeNull();
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  }, 20000);

  it('says so when the link was turned off', async () => {
    const cfg = await createShare(buildDemoData('Australia/Sydney'), DEFAULT_SHARE_OPTIONS, 30);
    await deleteShare(cfg);
    render(<SharedView link={{ id: null, key: cfg.key, name: 'sam-citizen' }} />);
    expect(await screen.findByText(/turned off or has expired/i)).toBeInTheDocument();
  });

  it('says so when the key in the link is wrong', async () => {
    const cfg = await createShare(buildDemoData('Australia/Sydney'), DEFAULT_SHARE_OPTIONS, 30);
    const other = await createShare(buildDemoData('Australia/Sydney'), DEFAULT_SHARE_OPTIONS, 30);
    render(<SharedView link={{ id: cfg.id, key: other.key, name: null }} />);
    expect(await screen.findByText(/incomplete or damaged/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/original readings/i)).toBeNull());
  });
});
