import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { StoreProvider, useStore } from '../store/Store';
import { closeStore, DB_NAMES, loadAll, lock, replaceAll } from '../db/db';
import { emptyData } from '../lib/defaults';
import { buildBackup, applyReplace, applyMerge, planImport } from '../lib/backup';
import { buildShareSnapshot, DEFAULT_SHARE_OPTIONS } from '../lib/share';
import type { AppData, BPSession } from '../types';

const s = (id: string, at: string, sys = 130): BPSession => ({
  id, sessionType: 'evening', date: '2026-11-01', measuredAt: at, timeZone: 'UTC', utcOffsetMinutes: 0, readings: [{ systolic: sys, diastolic: 80, pulse: null, measuredAt: at }],
  arm: null, monitorId: null, monitorLabel: null, conditionFlags: [], symptoms: '', notes: '', linkedDoseIds: [], unusualConfirmed: false, createdAt: at, updatedAt: at,
});

let store: ReturnType<typeof useStore>;
function Grab() {
  store = useStore();
  return null;
}

beforeEach(async () => {
  await closeStore('real');
  lock('real');
  await new Promise((r) => { const q = indexedDB.deleteDatabase(DB_NAMES.real); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});

describe('applying a sync result never loses work saved meanwhile', () => {
  it('keeps a record added, and an edit made, after the merge was computed', async () => {
    await replaceAll('real', { ...emptyData(), sessions: [s('old', '2026-11-01T01:00:00Z'), s('edited', '2026-11-01T01:00:00Z', 120), s('gone', '2026-11-01T01:00:00Z')] });
    render(<StoreProvider initialMode="real"><Grab /></StoreProvider>);
    await waitFor(() => expect(store.data.sessions).toHaveLength(3));
    // The merge result (computed from an earlier snapshot) adds a remote record, has an older copy of
    // 'edited', and a remote deletion of 'gone'.
    const target: AppData = { ...store.data, sessions: [s('old', '2026-11-01T01:00:00Z'), s('edited', '2026-11-01T01:00:00Z', 120), s('remote', '2026-11-01T02:00:00Z')],
      meta: { ...store.data.meta, tombstones: [{ c: 'sessions', id: 'gone', at: '2026-11-01T03:00:00Z' }] } };
    // Meanwhile the user adds a reading and edits one.
    await store.put('sessions', s('new-local', '2026-11-01T04:00:00Z'));
    await store.put('sessions', s('edited', '2026-11-01T05:00:00Z', 155));
    await store.applySync(target);
    const ids = (d: AppData) => d.sessions.map((x) => x.id).sort();
    await waitFor(() => expect(ids(store.data)).toEqual(['edited', 'new-local', 'old', 'remote']));
    expect(store.data.sessions.find((x) => x.id === 'edited')!.readings[0].systolic).toBe(155);
    const saved = await loadAll('real');
    expect(ids(saved)).toEqual(['edited', 'new-local', 'old', 'remote']);
    expect(saved.sessions.find((x) => x.id === 'edited')!.readings[0].systolic).toBe(155);
    expect(saved.meta.tombstones?.map((t) => t.id)).toContain('gone');
  });

  it('keeps this device’s sync setting when newer settings arrive', async () => {
    const vault = { key: 'A'.repeat(32), enabledAt: '' };
    await replaceAll('real', { ...emptyData(), settings: { ...emptyData().settings, vault, updatedAt: '2026-10-01T00:00:00Z' } });
    render(<StoreProvider initialMode="real"><Grab /></StoreProvider>);
    await waitFor(() => expect(store.data.settings.vault).toEqual(vault));
    await store.applySync({ ...store.data, settings: { ...store.data.settings, vault: null, updatedAt: '2026-10-09T00:00:00Z', targets: { ...store.data.settings.targets, systolic: 133 } } });
    await waitFor(() => expect(store.data.settings.targets.systolic).toBe(133));
    expect(store.data.settings.vault).toEqual(vault);
    expect((await loadAll('real')).settings.vault).toEqual(vault);
  });
});

describe('the cloud recovery key stays private', () => {
  const vault = { key: 'Z'.repeat(32), enabledAt: '' };
  const withKey: AppData = { ...emptyData(), settings: { ...emptyData().settings, vault } };
  it('is not written into backup files', () => {
    expect(JSON.stringify(buildBackup(withKey, 'real'))).not.toContain('Z'.repeat(32));
  });
  it('restoring a backup keeps cloud sync on for this device', () => {
    const backup = buildBackup({ ...emptyData(), sessions: [s('b', '2026-11-01T01:00:00Z')] }, 'real');
    expect(applyReplace(withKey, backup).settings.vault).toEqual(vault);
    expect(applyMerge(withKey, backup, planImport(withKey, backup), { conflicts: 'keep_current', possibleDuplicates: 'skip', settings: 'use_backup' }).settings.vault).toEqual(vault);
  });
  it('is never in the doctor’s snapshot', () => {
    expect(JSON.stringify(buildShareSnapshot(withKey, DEFAULT_SHARE_OPTIONS))).not.toContain('Z'.repeat(32));
  });
});
