import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildDemoData } from '../lib/demo';
import { applyMerge, applyReplace, buildBackup, planImport } from '../lib/backup';
import { emptyData, normaliseSettings, normaliseShare } from '../lib/defaults';
import {
  DEFAULT_SHARE_OPTIONS, _resetSyncForTests, buildShareLink, buildShareSnapshot, createShare, decryptSnapshot, deleteShare,
  encryptSnapshot, fetchShared, generateShareKey, generateShareSecret, getSyncStatus, parseShareHash, relativeTime, requestSync, resolveShareId, ShareHttpError,
  shareIdFromSecret, slugifyName,
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

  it('builds short links: name label + 16-character secret, all in the #fragment', async () => {
    const secret = generateShareSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const id = await shareIdFromSecret(secret);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id).not.toContain(secret);
    const link = buildShareLink({ id, key: secret, linkName: 'sam-citizen' }, 'https://x.example/app/');
    expect(link).toBe(`https://x.example/app/#/d/sam-citizen/${secret}`);
    expect(new URL(link).search).toBe('');
    const parsed = parseShareHash(new URL(link).hash)!;
    expect(parsed).toEqual({ id: null, key: secret, name: 'sam-citizen' });
    expect(await resolveShareId(parsed)).toBe(id);
    // No name, a pasted trailing full stop, and a changed name all still work.
    expect(buildShareLink({ id, key: secret, linkName: '' }, 'https://x.example/')).toBe(`https://x.example/#/d/${secret}`);
    expect(parseShareHash(`#/d/${secret}.`)?.key).toBe(secret);
    expect(parseShareHash(`#/d/someone-else/${secret}`)?.key).toBe(secret);
    expect(parseShareHash('#/d/sam/short')).toBeNull();
    // Non-Latin names are kept (percent-encoded in the link).
    const arabic = buildShareLink({ id, key: secret, linkName: slugifyName('محمد شريف') }, 'https://x.example/');
    expect(parseShareHash(new URL(arabic).hash)?.name).toBe('محمد-شريف');
  });

  it('turns names into tidy link labels', () => {
    expect(slugifyName('Sam Citizen')).toBe('sam-citizen');
    expect(slugifyName('  Zoë  O’Brien-Smith!! ')).toBe('zoe-o-brien-smith');
    expect(slugifyName('')).toBe('');
    expect(slugifyName('a'.repeat(80)).length).toBe(40);
  });

  it('short-link secrets encrypt and decrypt (key derived with HKDF)', async () => {
    const secret = generateShareSecret();
    const id = await shareIdFromSecret(secret);
    const snap = buildShareSnapshot(realData(), DEFAULT_SHARE_OPTIONS, NOW);
    const sealed = await encryptSnapshot(snap, secret, id);
    expect(await decryptSnapshot(sealed, secret, id)).toEqual(snap);
    await expect(decryptSnapshot(sealed, generateShareSecret(), id)).rejects.toThrow();
  });

  it('still parses older long links', () => {
    const id = 'A'.repeat(22);
    const key = 'b'.repeat(43);
    const link = buildShareLink({ id, key, linkName: 'ignored' }, 'https://x.example/app/');
    expect(link).toBe(`https://x.example/app/#/shared/${id}?k=${key}`);
    expect(new URL(link).search).toBe('');
    expect(parseShareHash(new URL(link).hash)).toEqual({ id, key, name: null });
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
    data.settings.share = { id: 'X'.repeat(22), token: 'SECRET-TOKEN', key: 'SECRET-KEY', linkName: 'secret-name', createdAt: '', expiresAt: '', options: DEFAULT_SHARE_OPTIONS };
    const snap = buildShareSnapshot(data, { ...DEFAULT_SHARE_OPTIONS, sessionNotes: true, symptoms: true, lifestyle: true, questions: true }, NOW);
    const text = JSON.stringify(snap);
    expect(text).not.toContain('SECRET-TOKEN');
    expect(text).not.toContain('SECRET-KEY');
    expect(text).not.toContain('secret-name');
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
    const cfg = await createShare(data, DEFAULT_SHARE_OPTIONS, 30, 'Sam Citizen');
    expect(cfg.linkName).toBe('sam-citizen');
    expect(cfg.key).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(cfg.id).toBe(await shareIdFromSecret(cfg.key));
    data = { ...data, settings: { ...data.settings, share: cfg } };
    // The relay holds only ciphertext.
    const stored = server.env.SHARES.map.get(`share:${cfg.id}`)!.value;
    expect(stored).not.toContain('session note');
    expect(stored).not.toContain(cfg.key);
    expect(stored).not.toContain('sam-citizen');

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

  it('a queued update can never reach the server after the link is turned off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      let data = realData();
      const cfg = await createShare(data, DEFAULT_SHARE_OPTIONS, 30);
      data = { ...data, settings: { ...data.settings, share: cfg }, weights: data.weights.slice(2) };
      await requestSync(data); // just uploaded, so this waits for the 15 s throttle
      await deleteShare(cfg);
      await requestSync(data, { force: true });
      await vi.advanceTimersByTimeAsync(120_000);
      const lastDelete = server.calls.map((c) => c.method).lastIndexOf('DELETE');
      expect(server.calls.slice(lastDelete + 1).filter((c) => c.method === 'PUT')).toEqual([]);
      expect(server.env.SHARES.map.has(`share:${cfg.id}`)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries by itself after the server could not be reached', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      let data = realData();
      const cfg = await createShare(data, DEFAULT_SHARE_OPTIONS, 30);
      data = { ...data, settings: { ...data.settings, share: cfg }, weights: data.weights.slice(3) };
      server.setOffline(true);
      await requestSync(data, { force: true });
      expect(getSyncStatus(cfg.id).state).toBe('offline');
      server.setOffline(false);
      await vi.advanceTimersByTimeAsync(61_000);
      await vi.waitFor(() => expect(getSyncStatus(cfg.id).state).toBe('ok'));
      const got = await fetchShared(cfg.id, cfg.key);
      expect(got.snapshot.data.weights.length).toBe(buildShareSnapshot(data, cfg.options).data.weights.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('only one device updates a link; another device can take over on request', async () => {
    let data = realData();
    const cfg = await createShare(data, DEFAULT_SHARE_OPTIONS, 30, 'Sam');
    data = { ...data, settings: { ...data.settings, share: cfg } };
    // A second device (e.g. after restoring a backup) with fewer records.
    const original = localStorage.getItem('bpt-device-id');
    localStorage.setItem('bpt-device-id', 'second-device-0001');
    const older = { ...data, sessions: data.sessions.slice(0, 3) };
    await requestSync(older, { force: true });
    expect(getSyncStatus(cfg.id).state).toBe('other-device');
    expect((await fetchShared(cfg.id, cfg.key)).snapshot.data.sessions.length).toBe(buildShareSnapshot(data, cfg.options).data.sessions.length);
    // The user chooses to update from the second device.
    await requestSync(older, { force: true, takeover: true });
    expect(getSyncStatus(cfg.id).state).toBe('ok');
    expect((await fetchShared(cfg.id, cfg.key)).snapshot.data.sessions.length).toBe(3);
    // Now the first device is the one that is refused.
    localStorage.setItem('bpt-device-id', original!);
    await requestSync(data, { force: true });
    expect(getSyncStatus(cfg.id).state).toBe('other-device');
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
    const share = { id: 'L'.repeat(22), token: 't', key: 'k', linkName: '', createdAt: '', expiresAt: '', options: DEFAULT_SHARE_OPTIONS };
    const current = { ...emptyData(), settings: { ...emptyData().settings, share } };
    const backup = buildBackup({ ...realData(), settings: { ...realData().settings, share: null } }, 'real');
    expect(applyReplace(current, backup).settings.share).toEqual(share);
    const merged = applyMerge(current, backup, planImport(current, backup), { conflicts: 'keep_current', possibleDuplicates: 'skip', settings: 'use_backup' });
    expect(merged.settings.share).toEqual(share);
  });

  it('ignores an incomplete share entry from storage or a backup, and fills in missing options', () => {
    expect(normaliseShare(undefined)).toBeNull();
    expect(normaliseShare({ id: 'x' })).toBeNull();
    expect(normaliseShare({ id: 'x', token: 't', key: 'k', expiresAt: 'not a date' })).toBeNull();
    const n = normaliseShare({ id: 'x', token: 't', key: 'k', expiresAt: '2027-01-01T00:00:00Z', options: { symptoms: false, windowDays: 12, displayName: 5 } });
    expect(n?.options).toEqual({ ...DEFAULT_SHARE_OPTIONS, symptoms: false });
    expect(normaliseSettings({ share: { broken: true } } as never).share).toBeNull();
  });

  it('formats relative times', () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});
