import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { DB_NAMES, closeStore, disableLock, enableLock, eraseDatabase, isLockEnabled, loadAll, lock, LockedError, putRecord, unlock, putKV } from '../db/db';
import { emptyData } from '../lib/defaults';
import { passcodeProblem } from '../lib/crypto';
import { mkSession } from './bp.test';

async function rawDump(): Promise<string> {
  const db = await openDB(DB_NAMES.real);
  const out: unknown[] = [];
  for (const name of Array.from(db.objectStoreNames)) out.push(await db.getAll(name));
  db.close();
  return JSON.stringify(out);
}

beforeEach(async () => {
  await closeStore('real');
  lock('real');
  await new Promise((r) => { const q = indexedDB.deleteDatabase(DB_NAMES.real); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});

describe('passcode lock (at-rest encryption)', () => {
  it('encrypts records and settings so nothing readable is stored', async () => {
    await putRecord('real', 'sessions', mkSession({ id: 's1', readings: [[187, 111]], notes: 'secret note' } as never));
    const d = await loadAll('real');
    d.settings.targets.source = 'Dr Example';
    await putKV('real', d.settings);
    expect(await rawDump()).toContain('187');
    await enableLock('real', 'correct horse', await loadAll('real'));
    const raw = await rawDump();
    expect(raw).not.toContain('187');
    expect(raw).not.toContain('secret note');
    expect(raw).not.toContain('Dr Example');
    expect(await isLockEnabled('real')).toBe(true);
  }, 20000);

  it('requires the passcode after locking; wrong passcode is rejected', async () => {
    await putRecord('real', 'sessions', mkSession({ id: 's1', readings: [[130, 80]] }));
    await enableLock('real', 'correct horse', await loadAll('real'));
    lock('real');
    await expect(loadAll('real')).rejects.toBeInstanceOf(LockedError);
    await expect(putRecord('real', 'sessions', mkSession({ id: 's2', readings: [[1, 1]] }))).rejects.toBeInstanceOf(LockedError);
    expect(await unlock('real', 'wrong pass')).toBe(false);
    expect(await unlock('real', 'correct horse')).toBe(true);
    const d = await loadAll('real');
    expect(d.sessions[0].readings[0].systolic).toBe(130);
  }, 20000);

  it('new records written while unlocked are encrypted and readable after unlock', async () => {
    await enableLock('real', 'correct horse', emptyData());
    await putRecord('real', 'sessions', mkSession({ id: 'n1', readings: [[142, 91]] }));
    expect(await rawDump()).not.toContain('142');
    lock('real');
    await unlock('real', 'correct horse');
    expect((await loadAll('real')).sessions.map((s) => s.id)).toEqual(['n1']);
  }, 20000);

  it('turning the lock off decrypts everything; wrong passcode leaves it on', async () => {
    await putRecord('real', 'sessions', mkSession({ id: 's1', readings: [[133, 84]] }));
    await enableLock('real', 'correct horse', await loadAll('real'));
    const data = await loadAll('real');
    expect(await disableLock('real', 'nope nope', data)).toBe(false);
    expect(await isLockEnabled('real')).toBe(true);
    expect(await disableLock('real', 'correct horse', data)).toBe(true);
    expect(await isLockEnabled('real')).toBe(false);
    expect(await rawDump()).toContain('133');
    lock('real');
    expect((await loadAll('real')).sessions).toHaveLength(1);
  }, 20000);

  it('erasing a locked database starts fresh', async () => {
    await enableLock('real', 'correct horse', emptyData());
    lock('real');
    await eraseDatabase('real');
    expect(await isLockEnabled('real')).toBe(false);
    expect((await loadAll('real')).sessions).toHaveLength(0);
  }, 20000);

  it('rejects weak passcodes', () => {
    expect(passcodeProblem('12345')).toMatch(/at least 6/);
    expect(passcodeProblem('111111')).toBeTruthy();
    expect(passcodeProblem('blue kettle')).toBeNull();
  });
});
