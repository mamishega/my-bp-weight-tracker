import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildDemoData } from '../lib/demo';
import { applyMerge, applyReplace, buildBackup, planImport } from '../lib/backup';
import { emptyData } from '../lib/defaults';
import {
  DEFAULT_SHARE_OPTIONS, _resetSyncForTests, buildShareLink, buildShareSnapshot, createShare, decryptSnapshot, deleteShare,
  encryptSnapshot, fetchShared, generateShareKey, getSyncStatus, parseShareHash, relativeTime, requestSync, ShareHttpError,
} from '../lib/share';
import type { AppData, ShareOptions } from '../types';
import { installFakeShareServer, TEST_API } from './fakeShareServer';

const NOW = new Date('2026-11-01T01:00:00Z'); // 1 Nov, 12:00 in Sydney

function realData(): AppData {
  const d = buildDemoData('Australia/Sydney', NOW);
  // Give every record optional text so we can check it is removed when not chosen.
  return {
    ...d,
    sessions: d.sessions.map((s) => ({ ...s, notes: 'session note', symptoms: 'session symptom' })),
    doses: d.doses.map((x) => ({ ...x, notes: 'dose note' })),
    weights: d.weights.map((w) => ({ ...w, notes: 'weight note' })),
    appointments: [{ id: 'a1', date: '2026-11-20', time: '10:00', clinician: 'Dr Lee', location: 'Clinic, 1 Main St', purpose: 'Review', notes: 'private', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    settings: { ...d.settings, timeZone: 'Australia/Sydney', notificationsEnabled: true, monitors: [{ id: 'mon', label: 'Home monitor', model: 'X1', cuffSize: 'M', notes: '' }] as AppData['settings']['monitors'] },
  };
}

describe('share encryption', () => {
  it('round-trips a snapshot and binds it to the link id', async () => {
    const key = await generateShareKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const snap = buildShareSnapshot(realData(), DEFAULT_SHARE_OPTIONS, NOW);
    const sealed = await encryptSnapshot(snap, key, 'id-one');
    expect(sealed.ct).not.toContain('session note');
    expect(await decryptSnapshot(sealed, key, 'id-one')).toEqual(snap);
    await expect(decryptSnapshot(sealed, key, 'id-two')).rejects.toThrow();
    await expect(decryptSnapshot(sealed, await generateShareKey(), 'id-one')).rejects.toThrow();
  });

  it('builds and parses links with the key only in the #fragment', () => {
    const id = 'A'.repeat(22);
    const key = 'b'.repeat(43);
    const link = buildShareLink(id, key, 'https://x.example/app/');
    expect(link).toBe(`https://x.example/app/#/shared/${id}?k=${key}`);
    expect(new URL(link).search).toBe('');
    expect(parseShareHash(new URL(link).hash)).toEqual({ id, key });
    expect(parseShareHash(`#/shared/${id}?k=short`)).toBeNull();
    expect(parseShareHash(`#/shared/${id}`)).toBeNull();
  });
});

describe('share snapshot contents', () => {
  it('includes only the chosen window and the chosen optional content', () => {
    const data = realData();
    const opts: ShareOptions = { ...DEFAULT_SHARE_OPTIONS, windowDays: 30, sessionNotes: false, doseNotes: false, symptoms: false, lifestyle: false, questions: false };
    const snap = buildShareSnapshot(data, opts, NOW);
    expect(snap.to).toBe('2026-11-01');
    expect(snap.from).toBe('2026-10-03');
    expect(snap.data.sessions.length).toBeGreaterThan(0);
    expect(snap.data.sessions.every((s) => s.date >= snap.from && s.date <= snap.to)).toBe(true);
    expect(snap.data.sessions.length).toBeLessThan(data.sessions.length);
    const text = JSON.stringify(snap);
    expect(text).not.toContain('session note');
    expect(text).not.toContain('session symptom');
    expect(text).not.toContain('dose note');
    expect(text).not.toContain('weight note');
    expect(snap.data.symptoms).toEqual([]);
    expect(snap.data.dailyLogs).toEqual([]);
    expect(snap.data.questions).toEqual([]);
  });

  it('never includes reminders, habits, supply, monitors, appointment notes or share secrets', () => {
    const data = realData();
    data.settings.share = { id: 'X'.repeat(22), token: 'SECRET-TOKEN', key: 'SECRET-KEY', createdAt: '', expiresAt: '', options: DEFAULT_SHARE_OPTIONS };
    const snap = buildShareSnapshot(data, { ...DEFAULT_SHARE_OPTIONS, sessionNotes: true, symptoms: true, lifestyle: true, questions: true }, NOW);
    const text = JSON.stringify(snap);
    expect(text).not.toContain('SECRET-TOKEN');
    expect(text).not.toContain('SECRET-KEY');
    expect(snap.data.reminderStates).toEqual([]);
    expect(snap.data.habits).toEqual([]);
    expect(snap.data.habitChecks).toEqual([]);
    expect(snap.data.stock).toEqual([]);
    expect(snap.data.settings.monitors).toEqual([]);
    expect(snap.data.settings.notificationsEnabled).toBe(false);
    expect(snap.data.appointments[0]).toMatchObject({ date: '2026-11-20', clinician: 'Dr Lee', notes: '', location: '' });
    expect(text).toContain('session note'); // chosen content is included
    expect(snap.data.settings.targets).toEqual(data.settings.targets);
  });

  it('keeps 6 days of weight before the window so the 7-day average is right', () => {
    const snap = buildShareSnapshot(realData(), { ...DEFAULT_SHARE_OPTIONS, windowDays: 30 }, NOW);
    const earliest = snap.data.weights.map((w) => w.date).sort()[0];
    expect(earliest < snap.from).toBe(true);
    expect(earliest >= '2026-09-27').toBe(true);
  });
});

describe('live link with the share relay', () => {
  let server: ReturnType<typeof installFakeShareServer>;
  beforeEach(() => {
    vi.stubEnv('VITE_SHARE_API_URL', TEST_API);
    server = installFakeShareServer();
    _resetSyncForTests();
    localStorage.clear();
  });
  afterEach(() => {
    server.restore();
    vi.unstubAllEnvs();
  });

  it('the same link shows changes after the patient edits records', async () => {
    let data = realData();
    const cfg = await createShare(data, DEFAULT_SHARE_OPTIONS, 30);
    data = { ...data, settings: { ...data.settings, share: cfg } };
    // The relay holds only ciphertext.
    const stored = server.env.SHARES.map.get(`share:${cfg.id}`)!.value;
    expect(stored).not.toContain('session note');
    expect(stored).not.toContain(cfg.key);

    const first = await fetchShared(cfg.id, cfg.key);
    expect(first.snapshot.data.sessions.length).toBe(buildShareSnapshot(data, cfg.options).data.sessions.length);

    // Patient adds a reading → same link, new content.
    const extra = { ...data.sessions[data.sessions.length - 1], id: 'new-one', notes: 'added later' };
    data = { ...data, sessions: [...data.sessions, extra] };
    await requestSync(data, { force: true });
    const second = await fetchShared(cfg.id, cfg.key);
    expect(second.snapshot.data.sessions.some((s) => s.id === 'new-one' && s.notes === 'added later')).toBe(true);
    expect(getSyncStatus(cfg.id).state).toBe('ok');
  });

  it('skips the upload when nothing changed', async () => {
    let data = realData();
    const cfg = await createShare(data, DEFAULT_SHARE_OPTIONS, 30);
    data = { ...data, settings: { ...data.settings, share: cfg } };
    const before = server.calls.length;
    await requestSync(data, { force: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(server.calls.filter((c) => c.method === 'PUT').length).toBe(server.calls.slice(0, before).filter((c) => c.method === 'PUT').length);
  });

  it('reports offline and keeps the link when the server can’t be reached', async () => {
    let data = realData();
    const cfg = await createShare(data, DEFAULT_SHARE_OPTIONS, 30);
    data = { ...data, settings: { ...data.settings, share: cfg }, weights: data.weights.slice(1) };
    server.setOffline(true);
    await requestSync(data, { force: true });
    expect(getSyncStatus(cfg.id).state).toBe('offline');
    server.setOffline(false);
    await requestSync(data, { force: true });
    expect(getSyncStatus(cfg.id).state).toBe('ok');
  });

  it('turning sharing off makes the link stop working', async () => {
    const cfg = await createShare(realData(), DEFAULT_SHARE_OPTIONS, 30);
    await deleteShare(cfg);
    await expect(fetchShared(cfg.id, cfg.key)).rejects.toMatchObject({ status: 404 });
    await expect(fetchShared(cfg.id, cfg.key)).rejects.toBeInstanceOf(ShareHttpError);
    await deleteShare(cfg); // already gone is not an error
  });
});

describe('share settings and backups', () => {
  it('restoring a backup keeps the link active on this device', () => {
    const share = { id: 'L'.repeat(22), token: 't', key: 'k', createdAt: '', expiresAt: '', options: DEFAULT_SHARE_OPTIONS };
    const current = { ...emptyData(), settings: { ...emptyData().settings, share } };
    const backup = buildBackup({ ...realData(), settings: { ...realData().settings, share: null } }, 'real');
    expect(applyReplace(current, backup).settings.share).toEqual(share);
    const merged = applyMerge(current, backup, planImport(current, backup), { conflicts: 'keep_current', possibleDuplicates: 'skip', settings: 'use_backup' });
    expect(merged.settings.share).toEqual(share);
  });

  it('formats relative times', () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});
