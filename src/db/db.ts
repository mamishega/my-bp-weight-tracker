// IndexedDB storage. Real records and demo records live in two completely
// separate databases so sample data can never mix with personal records.
// When a passcode lock is set, every record and the settings are stored
// encrypted ({ id, enc }); only the record id, the backup date (meta) and the
// lock parameters (salt, iteration count, verifier) are stored in the clear.

import { openDB, type IDBPDatabase } from 'idb';
import { COLLECTIONS, type AppData, type CollectionName, type Collections, type DataMode, type Meta, type Settings } from '../types';
import { defaultMeta, normaliseSettings } from '../lib/defaults';
import { createLock, open, seal, unlockWith, type LockRecord, type Sealed } from '../lib/crypto';

export const DB_NAMES: Record<DataMode, string> = {
  real: 'my-bp-weight-tracker',
  demo: 'my-bp-weight-tracker-DEMO',
};
const DB_VERSION = 1;

export class LockedError extends Error {
  constructor() {
    super('Records are locked with a passcode.');
    this.name = 'LockedError';
  }
}

const cache = new Map<DataMode, Promise<IDBPDatabase>>();
const keys = new Map<DataMode, CryptoKey>();

export function openStore(mode: DataMode): Promise<IDBPDatabase> {
  let p = cache.get(mode);
  if (!p) {
    p = openDB(DB_NAMES[mode], DB_VERSION, {
      upgrade(db) {
        for (const name of COLLECTIONS) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'id' });
      },
      blocking(_current, _blocked, event) {
        // Another tab (a newer app version) wants to upgrade: close our
        // connection so its upgrade can proceed instead of being blocked.
        (event.target as IDBDatabase).close();
        cache.delete(mode);
      },
    });
    cache.set(mode, p);
  }
  return p;
}

export async function closeStore(mode: DataMode): Promise<void> {
  const p = cache.get(mode);
  if (p) {
    (await p).close();
    cache.delete(mode);
  }
}

// ---- lock helpers ----
async function getLock(mode: DataMode): Promise<LockRecord | undefined> {
  return (await (await openStore(mode)).get('kv', 'lock')) as LockRecord | undefined;
}

export async function isLockEnabled(mode: DataMode): Promise<boolean> {
  return !!(await getLock(mode));
}

export function isUnlocked(mode: DataMode): boolean {
  return keys.has(mode);
}

/** Try a passcode. Returns true and keeps the key in memory if correct. */
export async function unlock(mode: DataMode, passcode: string): Promise<boolean> {
  const lock = await getLock(mode);
  if (!lock) return true;
  const key = await unlockWith(lock, passcode);
  if (!key) return false;
  keys.set(mode, key);
  return true;
}

/** Forget the key; the app must ask for the passcode again. */
export function lock(mode: DataMode) {
  keys.delete(mode);
}

type Wrapped = { id: string; enc: Sealed };
function isWrapped(r: unknown): r is Wrapped {
  return !!r && typeof r === 'object' && 'enc' in (r as object) && Object.keys(r as object).length === 2;
}

async function wrap<T extends { id: string }>(key: CryptoKey | undefined, r: T): Promise<T | Wrapped> {
  return key ? { id: r.id, enc: await seal(key, r) } : r;
}
async function unwrap<T>(key: CryptoKey | undefined, r: unknown): Promise<T> {
  if (!isWrapped(r)) return r as T;
  if (!key) throw new LockedError();
  return open<T>(key, r.enc);
}

async function activeKey(mode: DataMode): Promise<CryptoKey | undefined> {
  const k = keys.get(mode);
  if (k) return k;
  if (await getLock(mode)) throw new LockedError();
  return undefined;
}

export async function loadAll(mode: DataMode): Promise<AppData> {
  const db = await openStore(mode);
  const key = await activeKey(mode);
  const out: Partial<AppData> = {};
  for (const name of COLLECTIONS) {
    const raw = await db.getAll(name);
    (out as Record<string, unknown>)[name] = await Promise.all(raw.map((r) => unwrap(key, r)));
  }
  const settingsRaw = await db.get('kv', 'settings');
  const settings = settingsRaw ? await unwrap<Settings>(key, settingsRaw) : undefined;
  const meta = (await db.get('kv', 'meta')) as Meta | undefined;
  out.settings = normaliseSettings(settings);
  out.meta = meta ?? defaultMeta();
  if (!meta) await db.put('kv', out.meta);
  if (!settingsRaw) await db.put('kv', await wrap(key, out.settings));
  return out as AppData;
}

export async function putRecord<K extends CollectionName>(mode: DataMode, name: K, record: Collections[K]): Promise<void> {
  const db = await openStore(mode);
  const key = await activeKey(mode);
  await db.put(name, await wrap(key, record as { id: string }));
}

export async function putRecords<K extends CollectionName>(mode: DataMode, name: K, records: Collections[K][]): Promise<void> {
  const db = await openStore(mode);
  const key = await activeKey(mode);
  const wrapped = await Promise.all(records.map((r) => wrap(key, r as { id: string })));
  const tx = db.transaction(name, 'readwrite');
  await Promise.all([...wrapped.map((r) => tx.store.put(r)), tx.done]);
}

export async function deleteRecord(mode: DataMode, name: CollectionName, id: string): Promise<void> {
  const db = await openStore(mode);
  await db.delete(name, id);
}

export async function putKV(mode: DataMode, value: Settings | Meta): Promise<void> {
  const db = await openStore(mode);
  if (value.id === 'meta') return void (await db.put('kv', value));
  const key = await activeKey(mode);
  await db.put('kv', await wrap(key, value));
}

/** Atomically replace every store with the given data (used by restore-replace and delete-all). */
export async function replaceAll(mode: DataMode, data: AppData, opts: { lock?: LockRecord | null } = {}): Promise<void> {
  const db = await openStore(mode);
  const existingLock = await getLock(mode);
  const lockToWrite = opts.lock === undefined ? existingLock : opts.lock ?? undefined;
  const key = lockToWrite ? keys.get(mode) : undefined;
  if (lockToWrite && !key) throw new LockedError();
  // Encrypt before opening the transaction (async crypto would let it auto-commit).
  const prepared: Record<string, unknown[]> = {};
  for (const name of COLLECTIONS) prepared[name] = await Promise.all((data[name] as { id: string }[]).map((r) => wrap(key, r)));
  const settings = await wrap(key, data.settings);
  const tx = db.transaction([...COLLECTIONS, 'kv'], 'readwrite');
  for (const name of COLLECTIONS) {
    const store = tx.objectStore(name);
    await store.clear();
    for (const r of prepared[name]) await store.put(r);
  }
  const kv = tx.objectStore('kv');
  await kv.clear();
  await kv.put(settings);
  await kv.put(data.meta);
  if (lockToWrite) await kv.put(lockToWrite);
  await tx.done;
}

/** Turn on the passcode lock: re-writes every record encrypted. */
export async function enableLock(mode: DataMode, passcode: string, data: AppData): Promise<void> {
  const { lock: rec, key } = await createLock(passcode);
  keys.set(mode, key);
  try {
    await replaceAll(mode, data, { lock: rec });
  } catch (e) {
    keys.delete(mode);
    throw e;
  }
}

/** Turn off the lock: re-writes every record unencrypted. Requires the current passcode. */
export async function disableLock(mode: DataMode, passcode: string, data: AppData): Promise<boolean> {
  if (!(await unlock(mode, passcode))) return false;
  keys.delete(mode);
  await replaceAll(mode, data, { lock: null });
  return true;
}

/** Forgotten passcode: permanently erase everything in this mode's database. */
export async function eraseDatabase(mode: DataMode): Promise<void> {
  await closeStore(mode);
  keys.delete(mode);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAMES[mode]);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** Ask the browser to keep this site's storage (reduces eviction risk; not a guarantee). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return null;
}
