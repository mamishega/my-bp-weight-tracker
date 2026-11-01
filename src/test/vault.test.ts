import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildDemoData } from '../lib/demo';
import { emptyData } from '../lib/defaults';
import {
  _resetVaultForTests, deriveVault, fetchRemote, formatRecoveryKey, generateRecoveryKey, getVaultStatus, joinData, mergeData, normaliseRecoveryKey,
  openPayload, sealPayload, syncVault, toPayload, VaultKeyError,
} from '../lib/vault';
import type { AppData, BPSession } from '../types';
import { installFakeShareServer, TEST_API } from './fakeShareServer';

const NOW = new Date('2026-11-01T01:00:00Z');
const session = (id: string, updatedAt: string, sys = 130): BPSession => ({
  id, sessionType: 'evening', date: '2026-11-01', measuredAt: updatedAt, timeZone: 'UTC', utcOffsetMinutes: 0, readings: [{ systolic: sys, diastolic: 80, pulse: null, measuredAt: updatedAt }],
  arm: null, monitorId: null, monitorLabel: null, conditionFlags: [], symptoms: '', notes: '', linkedDoseIds: [], unusualConfirmed: false, createdAt: updatedAt, updatedAt,
});

describe('recovery key', () => {
  it('is 32 characters, readable, and forgiving when typed back', () => {
    const k = generateRecoveryKey();
    expect(k).toMatch(/^[0-9A-HJKMNP-TV-Z]{32}$/);
    expect(formatRecoveryKey(k)).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(normaliseRecoveryKey(formatRecoveryKey(k).toLowerCase().replace(/-/g, ' '))).toBe(k);
    expect(normaliseRecoveryKey('0O1IL'.padEnd(32, 'A'))).toBe('00111'.padEnd(32, 'A'));
    expect(normaliseRecoveryKey('too short')).toBeNull();
  });

  it('derives the same id, proof and key every time, and different ones for another key', async () => {
    const k = generateRecoveryKey();
    const a = await deriveVault(k);
    _resetVaultForTests();
    const b = await deriveVault(k);
    expect(a.id).toBe(b.id);
    expect(a.proof).toBe(b.proof);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await deriveVault(generateRecoveryKey())).id).not.toBe(a.id);
    expect(a.proof).not.toContain(k);
  });

  it('encrypts (compressed) and only the right key opens it', async () => {
    const d = buildDemoData('Australia/Sydney', NOW);
    const k = await deriveVault(generateRecoveryKey());
    const sealed = await sealPayload(toPayload(d), k);
    expect(sealed.ct).not.toContain('SAMPLE');
    expect(JSON.stringify(sealed).length).toBeLessThan(JSON.stringify(d).length); // gzip
    const opened = await openPayload(sealed, k);
    expect(opened.data.sessions).toEqual(d.sessions);
    await expect(openPayload(sealed, await deriveVault(generateRecoveryKey()))).rejects.toBeInstanceOf(VaultKeyError);
  });
});

describe('merging two devices', () => {
  const base = (): AppData => ({ ...emptyData(), settings: { ...emptyData().settings, updatedAt: '2026-10-01T00:00:00Z' } });
  it('keeps records from both and the newest edit of each', () => {
    const local = { ...base(), sessions: [session('a', '2026-11-01T01:00:00Z', 120), session('both', '2026-11-01T02:00:00Z', 140)] };
    const remoteData = { ...base(), sessions: [session('b', '2026-11-01T01:00:00Z'), session('both', '2026-11-01T03:00:00Z', 150)] };
    const m = mergeData(local, toPayload(remoteData));
    expect(m.sessions.map((s) => s.id).sort()).toEqual(['a', 'b', 'both']);
    expect(m.sessions.find((s) => s.id === 'both')!.readings[0].systolic).toBe(150);
  });

  it('a deletion wins over older copies, but not over a later edit', () => {
    const local = { ...base(), sessions: [session('x', '2026-11-01T01:00:00Z'), session('y', '2026-11-01T05:00:00Z')], meta: { ...base().meta, tombstones: [] } };
    const remote = toPayload({ ...base(), sessions: [], meta: { ...base().meta, tombstones: [{ c: 'sessions', id: 'x', at: '2026-11-01T02:00:00Z' }, { c: 'sessions', id: 'y', at: '2026-11-01T04:00:00Z' }] } });
    const m = mergeData(local, remote);
    expect(m.sessions.map((s) => s.id)).toEqual(['y']);
    expect(m.meta.tombstones).toHaveLength(2);
  });

  it('newer settings win, but this device keeps its own sync choice and notification permission', () => {
    const vault = { key: 'A'.repeat(32), enabledAt: '' };
    const local = { ...base(), settings: { ...base().settings, vault, notificationsEnabled: true, targets: { ...base().settings.targets, systolic: 140 } } };
    const remote = toPayload({ ...base(), settings: { ...base().settings, updatedAt: '2026-10-05T00:00:00Z', notificationsEnabled: false, targets: { ...base().settings.targets, systolic: 135 } } });
    const m = mergeData(local, remote);
    expect(m.settings.targets.systolic).toBe(135);
    expect(m.settings.vault).toEqual(vault);
    expect(m.settings.notificationsEnabled).toBe(true);
    // The recovery key is never put in the uploaded copy.
    expect(JSON.stringify(toPayload(local))).not.toContain('A'.repeat(32));
  });

  it('a device joining takes the cloud copy’s settings, not its own fresh defaults', () => {
    const fresh = { ...base(), settings: { ...base().settings, updatedAt: '2026-11-01T09:00:00Z' } };
    const remote = toPayload({ ...base(), settings: { ...base().settings, targets: { ...base().settings.targets, systolic: 130 } }, sessions: [session('r', '2026-11-01T01:00:00Z')] });
    const j = joinData(fresh, remote, { key: 'K'.repeat(32), enabledAt: '' });
    expect(j.settings.targets.systolic).toBe(130);
    expect(j.settings.vault?.key).toBe('K'.repeat(32));
    expect(j.sessions).toHaveLength(1);
  });
});

describe('sync through the relay (two devices)', () => {
  let server: ReturnType<typeof installFakeShareServer>;
  beforeEach(() => {
    vi.stubEnv('VITE_SHARE_API_URL', TEST_API);
    server = installFakeShareServer();
    _resetVaultForTests();
  });
  afterEach(() => {
    server.restore();
    vi.unstubAllEnvs();
  });

  function device(initial: AppData) {
    let d = initial;
    return {
      get: () => d,
      set: (n: AppData) => { d = n; },
      sync: () => syncVault(() => d, async (n) => { d = n; }),
    };
  }

  it('records added on either device reach the other; deletions too; nothing readable is stored', async () => {
    const key = generateRecoveryKey();
    const vault = { key, enabledAt: '' };
    const base = emptyData();
    const A = device({ ...base, settings: { ...base.settings, vault }, sessions: [session('from-A', '2026-11-01T01:00:00Z')] });
    await A.sync();
    expect(getVaultStatus().state).toBe('ok');
    const stored = [...server.env.SHARES.map.entries()].find(([k]) => k.startsWith('vault:'))![1].value;
    expect(stored).not.toContain('from-A');
    expect(stored).not.toContain(key);

    // Device B joins with the recovery key.
    const remote = await fetchRemote(key);
    const B = device(joinData({ ...base, sessions: [session('from-B', '2026-11-01T02:00:00Z')] }, remote!.payload, vault));
    await B.sync();
    await A.sync();
    expect(A.get().sessions.map((s) => s.id).sort()).toEqual(['from-A', 'from-B']);
    expect(B.get().sessions.map((s) => s.id).sort()).toEqual(['from-A', 'from-B']);

    // A deletes a record (as the Store does: removal + tombstone).
    const a = A.get();
    A.set({ ...a, sessions: a.sessions.filter((s) => s.id !== 'from-B'), meta: { ...a.meta, tombstones: [{ c: 'sessions', id: 'from-B', at: new Date().toISOString() }] } });
    await A.sync();
    await B.sync();
    expect(B.get().sessions.map((s) => s.id)).toEqual(['from-A']);
  });

  it('two devices saving at the same time: the second merges and retries (no lost changes)', async () => {
    const key = generateRecoveryKey();
    const vault = { key, enabledAt: '' };
    const base = { ...emptyData(), settings: { ...emptyData().settings, vault } };
    const A = device({ ...base, sessions: [session('a1', '2026-11-01T01:00:00Z')] });
    await A.sync();
    const B = device(joinData(emptyData(), (await fetchRemote(key))!.payload, vault));
    await B.sync();
    // Both change something, then A saves first; B's write hits a version conflict and merges.
    A.set({ ...A.get(), sessions: [...A.get().sessions, session('a2', '2026-11-01T03:00:00Z')] });
    B.set({ ...B.get(), sessions: [...B.get().sessions, session('b2', '2026-11-01T04:00:00Z')] });
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.get().sessions.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'b2']);
    expect(B.get().sessions.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'b2']);
    const puts = server.calls.filter((c) => c.method === 'PUT' && c.url.includes('/v1/vault/'));
    expect(puts.length).toBeGreaterThanOrEqual(3);
  });

  it('a wrong recovery key gets nothing', async () => {
    const A = device({ ...emptyData(), settings: { ...emptyData().settings, vault: { key: generateRecoveryKey(), enabledAt: '' } } });
    await A.sync();
    expect(await fetchRemote(generateRecoveryKey())).toBeNull();
  });

  it('reports offline and keeps local data when the relay can’t be reached', async () => {
    const A = device({ ...emptyData(), settings: { ...emptyData().settings, vault: { key: generateRecoveryKey(), enabledAt: '' } }, sessions: [session('keep', '2026-11-01T01:00:00Z')] });
    server.setOffline(true);
    await A.sync();
    expect(getVaultStatus().state).toBe('offline');
    expect(A.get().sessions).toHaveLength(1);
  });
});

describe('settings merge one setting at a time', () => {
  const base = () => ({ ...emptyData().settings, updatedAt: '2026-10-01T00:00:00Z' });
  it('a measurement week started on one device survives a reminder change on another', async () => {
    const { stampSettings, mergeSettings } = await import('../lib/vault');
    const start = base();
    // Phone starts a week at 09:00; computer changes the evening reminder at 10:00.
    const phone = stampSettings(start, { ...start, measurementWeeks: [{ id: 'w', startDate: '2026-11-02', days: 7, createdAt: '' }] }, '2026-11-01T09:00:00Z');
    const computer = stampSettings(start, { ...start, reminders: { ...start.reminders, evening: { enabled: true, time: '20:15' } } }, '2026-11-01T10:00:00Z');
    for (const m of [mergeSettings(phone, computer), mergeSettings(computer, phone)]) {
      expect(m.measurementWeeks).toHaveLength(1);
      expect(m.reminders.evening).toEqual({ enabled: true, time: '20:15' });
    }
  });
  it('the later change to the same setting wins; unchanged settings keep their old time', async () => {
    const { stampSettings, mergeSettings } = await import('../lib/vault');
    const start = base();
    const a = stampSettings(start, { ...start, targets: { ...start.targets, systolic: 140 } }, '2026-11-01T09:00:00Z');
    const b = stampSettings(start, { ...start, targets: { ...start.targets, systolic: 135 } }, '2026-11-01T11:00:00Z');
    expect(mergeSettings(a, b).targets.systolic).toBe(135);
    expect(mergeSettings(b, a).targets.systolic).toBe(135);
    expect(b.fieldTimes?.reminders).toBe('2026-10-01T00:00:00Z');
  });
});
