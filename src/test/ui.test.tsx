import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreProvider } from '../store/Store';
import { ToastProvider } from '../components/ui';
import { App } from '../App';
import { closeStore, DB_NAMES, loadAll } from '../db/db';

// jsdom lacks <dialog> methods
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

function renderApp(hash = '#/') {
  window.location.hash = hash;
  return render(<StoreProvider initialMode="real"><ToastProvider><App /></ToastProvider></StoreProvider>);
}

beforeEach(async () => {
  await closeStore('real');
  for (const n of Object.values(DB_NAMES)) await new Promise((r) => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});

describe('accessible forms and navigation', () => {
  it('dashboard starts empty and navigation links are keyboard-reachable', async () => {
    renderApp('#/');
    expect(await screen.findByText(/your dashboard is empty/i)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of ['Dashboard', 'Add Reading', 'Medication & Supply', 'Weight', 'Symptoms & Lifestyle', 'Trends & Weekly Review', 'History & Reports', 'Appointments', 'Settings & Backups']) {
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('href');
    }
    expect(screen.getAllByText(/^Not yet$/).length).toBe(3);
    expect(screen.getByText(/No successful backup yet/)).toBeInTheDocument();
  });

  it('add reading: labelled fields, clear errors, saves a two-reading session with average', async () => {
    const user = userEvent.setup();
    renderApp('#/add?type=morning_pre');
    const sys = await screen.findAllByLabelText(/Systolic \(top\)/);
    const dia = screen.getAllByLabelText(/Diastolic \(bottom\)/);
    expect(sys).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Save reading' }));
    expect((await screen.findAllByText(/Enter the systolic/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.activeElement).toBe(sys[0])); // focus moves to first invalid field
    await user.type(sys[0], '141');
    await user.type(dia[0], '90');
    await user.type(sys[1], '136');
    await user.type(dia[1], '87');
    expect(screen.getByText(/138\.5\/88\.5 mmHg/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save reading' }));
    await waitFor(async () => {
      const d = await loadAll('real');
      expect(d.sessions).toHaveLength(1);
      expect(d.sessions[0].readings.map((r) => r.systolic)).toEqual([141, 136]);
      expect(d.sessions[0].sessionType).toBe('morning_pre');
    });
  });

  it('unusual values need confirmation but can be saved', async () => {
    const user = userEvent.setup();
    renderApp('#/add?type=evening');
    await user.click(await screen.findByRole('button', { name: /Single reading/ }));
    await user.type(screen.getByLabelText(/Systolic \(top\)/), '238');
    await user.type(screen.getByLabelText(/Diastolic \(bottom\)/), '142');
    await user.click(screen.getByRole('button', { name: 'Save reading' }));
    expect(await screen.findByText(/Confirm the values, or correct them/)).toBeInTheDocument();
    expect((await loadAll('real')).sessions).toHaveLength(0);
    await user.click(screen.getByLabelText(/these are the values my monitor showed/));
    await user.click(screen.getByRole('button', { name: 'Save reading' }));
    await waitFor(async () => {
      const d = await loadAll('real');
      expect(d.sessions).toHaveLength(1);
      expect(d.sessions[0].readings[0]).toMatchObject({ systolic: 238, diastolic: 142 });
      expect(d.sessions[0].unusualConfirmed).toBe(true);
    });
  });

  it('symptoms page shows urgent guidance before the form', async () => {
    renderApp('#/symptoms');
    const urgent = await screen.findByRole('heading', { name: /Urgent symptoms\? Call Triple Zero \(000\) now/ });
    const field = screen.getByLabelText(/What are you experiencing/);
    expect(urgent.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('regressions found in review', () => {
  it('number settings can be cleared and retyped', async () => {
    const user = userEvent.setup();
    renderApp('#/settings');
    const f = await screen.findByLabelText('Every (days)');
    await user.clear(f);
    await user.type(f, '14');
    expect(f).toHaveValue('14');
    await waitFor(async () => expect((await loadAll('real')).settings.reminders.backup.everyDays).toBe(14));
  });

  it('weight milestone accepts decimals while typing', async () => {
    const user = userEvent.setup();
    renderApp('#/weight');
    await user.click(await screen.findByRole('button', { name: /Set goal/ }));
    await user.click(screen.getByRole('button', { name: 'Add milestone' }));
    const f = screen.getByLabelText(/^At \(kg\)/);
    await user.type(f, '85.5');
    expect(f).toHaveValue('85.5');
  });

  it('invalid custom date range shows an error instead of doing nothing', async () => {
    const user = userEvent.setup();
    renderApp('#/trends');
    const from = await screen.findByLabelText('From');
    const to = screen.getByLabelText('To');
    await user.clear(from); await user.type(from, '2026-11-10');
    await user.clear(to); await user.type(to, '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Apply custom range' }));
    expect(await screen.findByText(/must be on or before/)).toBeInTheDocument();
  });
});
