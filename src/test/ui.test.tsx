import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreProvider } from '../store/Store';
import { ToastProvider } from '../components/ui';
import { App } from '../App';
import { closeStore, DB_NAMES, loadAll, enableLock, lock } from '../db/db';
import { emptyData } from '../lib/defaults';

// jsdom lacks <dialog> methods
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

async function setHash(hash: string) {
  if (window.location.hash === hash) return;
  await new Promise<void>((r) => { window.addEventListener('hashchange', () => r(), { once: true }); window.location.hash = hash; });
}

async function renderApp(hash = '#/') {
  await setHash(hash);
  return render(<StoreProvider initialMode="real"><ToastProvider><App /></ToastProvider></StoreProvider>);
}

beforeEach(async () => {
  await closeStore('real');
  lock('real');
  for (const n of Object.values(DB_NAMES)) await new Promise((r) => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});

describe('accessible forms and navigation', () => {
  it('dashboard starts empty and navigation links are keyboard-reachable', async () => {
    await renderApp('#/');
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
    await renderApp('#/add?type=morning_pre');
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
    await renderApp('#/add?type=evening');
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
    await renderApp('#/symptoms');
    const urgent = await screen.findByRole('heading', { name: /Urgent symptoms\? Call Triple Zero \(000\) now/ });
    const field = screen.getByLabelText(/What are you experiencing/);
    expect(urgent.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('regressions found in review', () => {
  it('number settings can be cleared and retyped', async () => {
    const user = userEvent.setup();
    await renderApp('#/settings');
    const f = await screen.findByLabelText('Every (days)');
    await user.clear(f);
    await user.type(f, '14');
    expect(f).toHaveValue('14');
    await waitFor(async () => expect((await loadAll('real')).settings.reminders.backup.everyDays).toBe(14));
  });

  it('weight milestone accepts decimals while typing', async () => {
    const user = userEvent.setup();
    await renderApp('#/weight');
    await user.click(await screen.findByRole('button', { name: /Set goal/ }));
    await user.click(screen.getByRole('button', { name: 'Add milestone' }));
    const f = screen.getByLabelText(/^At \(kg\)/);
    await user.type(f, '85.5');
    expect(f).toHaveValue('85.5');
  });

  it('invalid custom date range shows an error instead of doing nothing', async () => {
    const user = userEvent.setup();
    await renderApp('#/trends');
    const from = await screen.findByLabelText('From');
    const to = screen.getByLabelText('To');
    await user.clear(from); await user.type(from, '2026-11-10');
    await user.clear(to); await user.type(to, '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Apply custom range' }));
    expect(await screen.findByText(/must be on or before/)).toBeInTheDocument();
  });
});

describe('unsaved changes guard', () => {
  it('asks before leaving a half-filled reading, and can stay or leave', async () => {
    const user = userEvent.setup();
    await renderApp('#/add?type=evening');
    const sys = (await screen.findAllByLabelText(/Systolic \(top\)/))[0];
    await user.type(sys, '133');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Weight' }));
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay and keep editing' }));
    expect(sys).toHaveValue('133');
    expect(window.location.hash).toContain('/add');
    await user.click(within(nav).getByRole('link', { name: 'Weight' }));
    await user.click(await screen.findByRole('button', { name: 'Leave and discard' }));
    await waitFor(() => expect(window.location.hash).toBe('#/weight'));
  });

  it('does not ask after a successful save', async () => {
    const user = userEvent.setup();
    await renderApp('#/add?type=evening');
    await user.click(await screen.findByRole('button', { name: /Single reading/ }));
    await user.type(screen.getByLabelText(/Systolic \(top\)/), '128');
    await user.type(screen.getByLabelText(/Diastolic \(bottom\)/), '80');
    await user.click(screen.getByRole('button', { name: 'Save reading' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(screen.queryByText('Leave without saving?')).not.toBeInTheDocument();
  });
});

describe('passcode lock screen', () => {
  it('shows the lock screen with urgent help, rejects a wrong passcode and unlocks', async () => {
    await enableLock('real', 'blue kettle', emptyData());
    lock('real');
    const user = userEvent.setup();
    await renderApp('#/');
    expect(await screen.findByRole('heading', { name: /Enter passcode/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Urgent symptoms\? Call Triple Zero/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passcode'), 'wrong one');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText(/not correct/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passcode'), 'blue kettle');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText(/your dashboard is empty/i, {}, { timeout: 5000 })).toBeInTheDocument();
  }, 20000);
});

describe('medication taken several times a day', () => {
  it('adds a twice-a-day medicine and records each dose separately', async () => {
    const user = userEvent.setup();
    await renderApp('#/medication');
    await screen.findByRole('heading', { level: 1, name: /Medication/ });
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Medication name'), 'Tablet Two');
    await user.selectOptions(within(dialog).getByLabelText(/How many times a day/), '2');
    await user.type(within(dialog).getByLabelText('Dose 1 time'), '08:00');
    await user.type(within(dialog).getByLabelText('Dose 2 time'), '20:00');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/2 times a day: 8:00 am, 8:00 pm/)).toBeInTheDocument();
    expect(screen.getByText('0 of 2 taken')).toBeInTheDocument();

    // Record the second dose directly.
    await user.click(screen.getByRole('button', { name: 'Record taken: Dose 2 (8:00 pm)' }));
    const form = await screen.findByRole('dialog');
    expect(within(form).getByRole('radio', { name: /Dose 2 \(8:00 pm\)/ })).toBeChecked();
    await user.click(within(form).getByRole('button', { name: 'Save dose record' }));
    expect(await screen.findByText('1 of 2 taken')).toBeInTheDocument();

    const saved = await loadAll('real');
    expect(saved.medications[0]).toMatchObject({ timesPerDay: 2, doseTimes: ['08:00', '20:00'], usualTime: '08:00' });
    expect(saved.doses).toHaveLength(1);
    expect(saved.doses[0]).toMatchObject({ doseIndex: 1, scheduledTime: '20:00', status: 'taken' });
    // The first dose can still be recorded.
    expect(screen.getByRole('button', { name: 'Record taken: Dose 1 (8:00 am)' })).toBeInTheDocument();
  }, 20000);
});

describe('medicine taken only when needed', () => {
  it('has no "not recorded" days and records doses whenever taken', async () => {
    const user = userEvent.setup();
    await renderApp('#/medication');
    await screen.findByRole('heading', { level: 1, name: /Medication/ });
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Medication name'), 'Reliever');
    await user.selectOptions(within(dialog).getByLabelText('How often?'), 'as_needed');
    expect(within(dialog).queryByLabelText(/How many times/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/^Only when needed ·/)).toBeInTheDocument();
    expect(screen.getByText('None recorded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record a dose' }));
    const form = await screen.findByRole('dialog');
    expect(within(form).getByText(/Taken only when needed/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Save dose record' }));
    expect(await screen.findByText('taken 1 time')).toBeInTheDocument();
    const saved = await loadAll('real');
    expect(saved.medications[0].frequency).toEqual({ kind: 'as_needed' });
    expect(saved.doses[0]).toMatchObject({ doseIndex: null, status: 'taken' });
  }, 20000);
});

describe('7-day measurement week', () => {
  it('starts a week and shows progress on the page and the dashboard', async () => {
    const user = userEvent.setup();
    await renderApp('#/week');
    await screen.findByRole('heading', { level: 1, name: /Measurement week/ });
    await user.click(screen.getByRole('button', { name: 'Start measurement week' }));
    expect(await screen.findByText(/Day 1 of 7/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add morning reading/ })).toHaveAttribute('href', '#/add?type=morning_pre');
    expect(screen.getByText(/0 of 7/)).toBeInTheDocument();
    const saved = await loadAll('real');
    expect(saved.settings.measurementWeeks).toHaveLength(1);
  }, 20000);
});
