// IndexedDB storage. Real records and demo records live in two completely
// separate databases so sample data can never mix with personal records.

import { openDB, type IDBPDatabase } from 'idb';
import { COLLECTIONS, type AppData, type CollectionName, type Collections, type DataMode, type Meta, type Settings } from '../types';
import { defaultMeta, normaliseSettings } from '../lib/defaults';

export const DB_NAMES: Record<DataMode, string> = {
  real: 'my-bp-weight-tracker',
  demo: 'my-bp-weight-tracker-DEMO',
};
const DB_VERSION = 1;

const cache = new Map<DataMode, Promise<IDBPDatabase>>();

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
      blocking() {
        // Another tab wants to upgrade; close so it can proceed.
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

export async function loadAll(mode: DataMode): Promise<AppData> {
  const db = await openStore(mode);
  const out: Partial<AppData> = {};
  for (const name of COLLECTIONS) {
    (out as Record<string, unknown>)[name] = await db.getAll(name);
  }
  const settings = (await db.get('kv', 'settings')) as Settings | undefined;
  const meta = (await db.get('kv', 'meta')) as Meta | undefined;
  out.settings = normaliseSettings(settings);
  out.meta = meta ?? defaultMeta();
  if (!meta) await db.put('kv', out.meta);
  if (!settings) await db.put('kv', out.settings);
  return out as AppData;
}

export async function putRecord<K extends CollectionName>(mode: DataMode, name: K, record: Collections[K]): Promise<void> {
  const db = await openStore(mode);
  await db.put(name, record);
}

export async function putRecords<K extends CollectionName>(mode: DataMode, name: K, records: Collections[K][]): Promise<void> {
  const db = await openStore(mode);
  const tx = db.transaction(name, 'readwrite');
  await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
}

export async function deleteRecord(mode: DataMode, name: CollectionName, id: string): Promise<void> {
  const db = await openStore(mode);
  await db.delete(name, id);
}

export async function putKV(mode: DataMode, value: Settings | Meta): Promise<void> {
  const db = await openStore(mode);
  await db.put('kv', value);
}

/** Atomically replace every store with the given data (used by restore-replace and delete-all). */
export async function replaceAll(mode: DataMode, data: AppData): Promise<void> {
  const db = await openStore(mode);
  const names = [...COLLECTIONS, 'kv'] as const;
  const tx = db.transaction(names as unknown as string[], 'readwrite');
  for (const name of COLLECTIONS) {
    const store = tx.objectStore(name);
    await store.clear();
    for (const r of data[name] as { id: string }[]) await store.put(r);
  }
  const kv = tx.objectStore('kv');
  await kv.clear();
  await kv.put(data.settings);
  await kv.put(data.meta);
  await tx.done;
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
