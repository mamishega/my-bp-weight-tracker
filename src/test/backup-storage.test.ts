import { describe, it, expect, beforeEach } from 'vitest';
import { buildBackup, validateBackup, planImport, applyMerge, applyReplace } from '../lib/backup';
import { emptyData } from '../lib/defaults';
import { buildDemoData } from '../lib/demo';
import { loadAll, putRecord, replaceAll, deleteRecord, closeStore, DB_NAMES } from '../db/db';
import { readingsCsv, csvCell } from '../lib/csv';
import { dueReminders } from '../lib/reminders';
import { mkSession } from './bp.test';
import { mkDose, mkMed } from './medication.test';
import type { AppData } from '../types';

function sample(): AppData {
  const d = emptyData();
  d.settings.timeZone = 'Australia/Sydney';
  d.medications = [mkMed()];
  d.doses = [mkDose({ id: 'dose1' })];
  d.sessions = [mkSession({ id: 's1', readings: [[141, 90, 70], [136, 87, 66]] }), mkSession({ id: 's2', sessionType: 'morning_post', readings: [[125, 80]], measuredAt: '2026-11-01T22:00:00.000Z', linkedDoseIds: ['dose1'] })];
  return d;
}

describe('backup and restore', () => {
  it('round-trips ids, timestamps, time zones, settings and medication history', () => {
    const d = sample();
    d.medications[0].history.push({ effectiveFrom: '2026-11-01T00:00:00.000Z', name: 'Medicine A', dose: '20 mg', usualTime: '07:30', instructions: '' });
    const file = JSON.parse(JSON.stringify(buildBackup(d, 'real')));
    const v = validateBackup(file, 'real');
    expect(v.ok).toBe(true);
    const restored = v.backup!.data;
    expect(restored.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(restored.sessions[0].readings[1].measuredAt).toBe(d.sessions[0].readings[1].measuredAt);
    expect(restored.sessions[0].timeZone).toBe('Australia/Sydney');
    expect(restored.settings.timeZone).toBe('Australia/Sydney');
    expect(restored.medications[0].history).toHaveLength(2);
    expect(file.exportedTimeZone).toBe('Australia/Sydney');
  });
  it('rejects files that are not valid backups', () => {
    expect(validateBackup({ hello: 1 }, 'real').ok).toBe(false);
    const bad = JSON.parse(JSON.stringify(buildBackup(sample(), 'real')));
    bad.data.sessions[0].readings = [];
    const v = validateBackup(bad, 'real');
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/1 or 2 readings/);
  });
  it('blocks demo backups from personal records and vice versa', () => {
    const demo = JSON.parse(JSON.stringify(buildBackup(sample(), 'demo')));
    expect(validateBackup(demo, 'real').ok).toBe(false);
    const real = JSON.parse(JSON.stringify(buildBackup(sample(), 'real')));
    expect(validateBackup(real, 'demo').ok).toBe(false);
  });
  it('merge: identical skipped, new added, conflicts and duplicates follow options', () => {
    const current = sample();
    const incoming = sample();
    incoming.sessions[0] = { ...incoming.sessions[0], notes: 'changed' }; // same id, different content
    incoming.sessions.push(mkSession({ id: 's3', readings: [[120, 75]], measuredAt: '2026-11-03T20:00:00.000Z', date: '2026-11-04' })); // new
    incoming.sessions.push({ ...current.sessions[0], id: 'copy-of-s1' }); // possible duplicate (different id, same content)
    const b = validateBackup(JSON.parse(JSON.stringify(buildBackup(incoming, 'real'))), 'real').backup!;
    const plan = planImport(current, b);
    const sp = plan.stores.find((s) => s.name === 'sessions')!;
    expect(sp.identical).toBe(1);
    expect(sp.conflicts).toHaveLength(1);
    expect(sp.newRecords).toHaveLength(1);
    expect(sp.possibleDuplicates).toHaveLength(1);
    const keep = applyMerge(current, b, plan, { conflicts: 'keep_current', possibleDuplicates: 'skip', settings: 'keep_current' });
    expect(keep.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(keep.sessions.find((s) => s.id === 's1')!.notes).toBe('');
    const take = applyMerge(current, b, plan, { conflicts: 'use_backup', possibleDuplicates: 'import', settings: 'keep_current' });
    expect(take.sessions).toHaveLength(4);
    expect(take.sessions.find((s) => s.id === 's1')!.notes).toBe('changed');
  });
  it('replace uses only the backup but keeps the device backup indicator', () => {
    const current = sample();
    current.meta.lastBackupAt = '2026-10-30T00:00:00.000Z';
    const other = emptyData();
    other.weights = [{ id: 'w1', date: '2026-11-01', measuredAt: null, timeZone: 'UTC', utcOffsetMinutes: null, kg: 80, enteredValue: 80, enteredUnit: 'kg', notes: '', createdAt: '', updatedAt: '' }];
    const b = validateBackup(JSON.parse(JSON.stringify(buildBackup(other, 'real'))), 'real').backup!;
    const r = applyReplace(current, b);
    expect(r.sessions).toHaveLength(0);
    expect(r.weights).toHaveLength(1);
    expect(r.meta.lastBackupAt).toBe('2026-10-30T00:00:00.000Z');
  });
});

describe('CSV export', () => {
  it('has one row per original reading', () => {
    const lines = readingsCsv(sample()).trim().split('\r\n');
    expect(lines).toHaveLength(1 + 3);
    expect(lines[1]).toContain(',141,90,70,');
    expect(lines[2]).toContain(',136,87,66,');
  });
  it('escapes and neutralises formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('IndexedDB persistence and demo separation', () => {
  beforeEach(async () => {
    await closeStore('real');
    await closeStore('demo');
    for (const n of Object.values(DB_NAMES)) await new Promise((r) => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
  });
  it('persists records across reopen', async () => {
    await putRecord('real', 'sessions', mkSession({ id: 'p1', readings: [[130, 80]] }));
    await closeStore('real');
    const d = await loadAll('real');
    expect(d.sessions.map((s) => s.id)).toEqual(['p1']);
    await deleteRecord('real', 'sessions', 'p1');
    expect((await loadAll('real')).sessions).toHaveLength(0);
  });
  it('starts empty for personal records', async () => {
    const d = await loadAll('real');
    expect(d.sessions.length + d.weights.length + d.medications.length).toBe(0);
  });
  it('demo data never appears in personal records', async () => {
    await replaceAll('demo', buildDemoData('Australia/Sydney'));
    await putRecord('real', 'sessions', mkSession({ id: 'mine', readings: [[130, 80]] }));
    const real = await loadAll('real');
    const demo = await loadAll('demo');
    expect(real.sessions.map((s) => s.id)).toEqual(['mine']);
    expect(demo.sessions.length).toBeGreaterThan(50);
    expect(demo.sessions.some((s) => s.id === 'mine')).toBe(false);
    expect(demo.medications[0].name).toMatch(/SAMPLE/);
  });
});

describe('reminders', () => {
  it('snooze and dismiss hide reminders without creating records', () => {
    const d = sample();
    d.sessions = [];
    d.settings.reminders.evening = { enabled: true, time: '19:00' };
    const now = new Date('2026-11-02T09:00:00.000Z'); // 8 pm Sydney
    expect(dueReminders(d, now).map((r) => r.kind)).toContain('evening');
    const key = dueReminders(d, now).find((r) => r.kind === 'evening')!.key;
    d.reminderStates = [{ id: key, status: 'snoozed', snoozeUntil: '2026-11-02T09:15:00.000Z', updatedAt: '' }];
    expect(dueReminders(d, now).map((r) => r.kind)).not.toContain('evening');
    expect(dueReminders(d, new Date('2026-11-02T09:16:00.000Z')).map((r) => r.kind)).toContain('evening');
    d.reminderStates = [{ id: key, status: 'dismissed', snoozeUntil: null, updatedAt: '' }];
    expect(dueReminders(d, now).map((r) => r.kind)).not.toContain('evening');
    expect(d.sessions).toHaveLength(0);
  });
  it('after-medication reminder uses actual dose time + clinician interval', () => {
    const d = sample();
    d.sessions = [];
    d.settings.reminders.postDose = { enabled: true };
    d.medications[0].postDoseReminderMinutes = 120;
    d.doses = [mkDose({ id: 'x', date: '2026-11-02', takenAt: '2026-11-01T21:10:00.000Z' })];
    expect(dueReminders(d, new Date('2026-11-01T23:05:00.000Z')).some((r) => r.kind === 'postDose')).toBe(false);
    expect(dueReminders(d, new Date('2026-11-01T23:10:00.000Z')).some((r) => r.kind === 'postDose')).toBe(true);
  });
  it('no after-medication reminder without a clinician interval', () => {
    const d = sample();
    d.settings.reminders.postDose = { enabled: true };
    d.sessions = [];
    expect(dueReminders(d, new Date('2026-11-02T05:00:00.000Z')).some((r) => r.kind === 'postDose')).toBe(false);
  });
});
