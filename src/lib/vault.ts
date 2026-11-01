// Encrypted cloud backup and sync between devices.
//
// A 32-character recovery key (160 random bits) is created on the first
// device. Everything is derived from it with HKDF: the record id on the relay,
// a proof that lets a device read/write that record, and the AES-256-GCM key.
// Only ciphertext is uploaded, so the relay (and Cloudflare) can't read it.
//
// Sync = download the cloud copy, merge it with this device's records (newest
// edit wins per record; deletions are kept as tombstones so they don't come
// back), save the result here, and upload it if it differs. Uploads use a
// version number so two devices can never overwrite each other's changes.
import { COLLECTIONS, type AppData, type CollectionName, type Settings, type Tombstone, type VaultConfig } from '../types';
import { shareApiBase } from './share';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const enc = new TextEncoder();
const VERSION = 1;

// ---------------------------------------------------------------- recovery key
export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** Accepts the key typed with spaces, dashes, lower case, and O/I/L mistakes. Null if invalid. */
export function normaliseRecoveryKey(input: string): string | null {
  const k = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{32}$/.test(k) ? k : null;
}

/** "ABCD-EFGH-…" for display and saving. */
export function formatRecoveryKey(k: string): string {
  return k.match(/.{1,4}/g)!.join('-');
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface Derived { id: string; proof: string; key: CryptoKey }
const derivedCache = new Map<string, Promise<Derived>>();

export function deriveVault(recoveryKey: string): Promise<Derived> {
  let p = derivedCache.get(recoveryKey);
  if (!p) {
    p = (async () => {
      const base = await crypto.subtle.importKey('raw', enc.encode(recoveryKey), 'HKDF', false, ['deriveBits', 'deriveKey']);
      const salt = enc.encode('my-bp-weight-tracker-vault-v1');
      const bits = async (info: string, n: number) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, n));
      const id = url(b64(await bits('id', 128))).slice(0, 22);
      const proof = url(b64(await bits('proof', 256)));
      const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('aes-256-gcm') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return { id, proof, key };
    })();
    derivedCache.set(recoveryKey, p);
  }
  return p;
}

// ---------------------------------------------------------------- payload
/** What is synced: every record collection, settings, and deletions. */
export interface VaultPayload {
  app: 'my-bp-weight-tracker-vault';
  version: 1;
  savedAt: string;
  data: Omit<AppData, 'meta'>;
  tombstones: Tombstone[];
}

async function gzip(text: string): Promise<{ bytes: Uint8Array; z: boolean }> {
  if (typeof CompressionStream === 'undefined') return { bytes: enc.encode(text), z: false };
  const stream = new Response(enc.encode(text)).body!.pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), z: true };
}
async function gunzip(bytes: Uint8Array<ArrayBuffer>, z: boolean): Promise<string> {
  if (!z) return new TextDecoder().decode(bytes);
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function sealPayload(p: VaultPayload, d: Derived): Promise<{ v: 1; iv: string; ct: string }> {
  const { bytes, z } = await gzip(JSON.stringify(p));
  const framed = new Uint8Array(bytes.length + 1);
  framed[0] = z ? 1 : 0;
  framed.set(bytes, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(d.id) }, d.key, framed));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

export class VaultKeyError extends Error {
  constructor() {
    super('This recovery key doesn’t open the cloud backup.');
    this.name = 'VaultKeyError';
  }
}

export async function openPayload(s: { iv: string; ct: string }, d: Derived): Promise<VaultPayload> {
  let framed: Uint8Array<ArrayBuffer>;
  try {
    framed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv), additionalData: enc.encode(d.id) }, d.key, fromB64(s.ct)));
  } catch {
    throw new VaultKeyError();
  }
  const p = JSON.parse(await gunzip(framed.slice(1), framed[0] === 1)) as VaultPayload;
  if (p?.app !== 'my-bp-weight-tracker-vault' || p.version !== VERSION) throw new VaultKeyError();
  return p;
}

// ---------------------------------------------------------------- merge
type Rec = { id: string; updatedAt?: string; createdAt?: string };
const stamp = (r: Rec) => r.updatedAt ?? r.createdAt ?? '';

function mergeTombstones(a: Tombstone[], b: Tombstone[]): Tombstone[] {
  const m = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const k = `${t.c}|${t.id}`;
    const cur = m.get(k);
    if (!cur || t.at > cur.at) m.set(k, t);
  }
  const cutoff = new Date(Date.now() - 400 * 86_400_000).toISOString();
  return [...m.values()].filter((t) => t.at > cutoff);
}

/**
 * Merge two copies. Per record, the newest edit wins; a record deleted after
 * its last edit stays deleted. Settings: the newer copy wins, except what
 * belongs to this device (its sync choice and notification permission).
 */
export function mergeData(local: AppData, remote: VaultPayload): AppData {
  const tombstones = mergeTombstones(local.meta.tombstones ?? [], remote.tombstones ?? []);
  const dead = new Map(tombstones.map((t) => [`${t.c}|${t.id}`, t.at]));
  const out = { ...local } as AppData;
  for (const c of COLLECTIONS) {
    const map = new Map<string, Rec>();
    for (const r of [...((remote.data[c] as Rec[] | undefined) ?? []), ...(local[c] as Rec[])]) {
      const cur = map.get(r.id);
      if (!cur || stamp(r) > stamp(cur)) map.set(r.id, r);
    }
    (out as unknown as Record<CollectionName, Rec[]>)[c] = [...map.values()].filter((r) => {
      const at = dead.get(`${c}|${r.id}`);
      return !at || stamp(r) > at;
    });
  }
  const rs = remote.data.settings as Settings | undefined;
  out.settings = rs ? mergeSettings(local.settings, rs) : local.settings;
  out.meta = { ...local.meta, tombstones };
  return out;
}

const DEVICE_ONLY = new Set(['id', 'updatedAt', 'fieldTimes', 'vault', 'notificationsEnabled']);

/**
 * Merge settings one setting at a time: for each one, the copy changed most
 * recently wins (older data without per-setting times falls back to when the
 * settings were last saved). This device keeps its own sync choice and
 * notification permission.
 */
export function mergeSettings(local: Settings, remote: Settings): Settings {
  const out: Record<string, unknown> = { ...local };
  const times: Record<string, string> = { ...(local.fieldTimes ?? {}) };
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)].filter((k) => !DEVICE_ONLY.has(k)));
  for (const k of keys) {
    const lt = local.fieldTimes?.[k] ?? local.updatedAt;
    const rt = remote.fieldTimes?.[k] ?? remote.updatedAt;
    if (rt > lt && k in remote) {
      out[k] = (remote as unknown as Record<string, unknown>)[k];
      times[k] = rt;
    }
  }
  out.fieldTimes = times;
  out.updatedAt = remote.updatedAt > local.updatedAt ? remote.updatedAt : local.updatedAt;
  out.vault = local.vault ?? null;
  out.notificationsEnabled = local.notificationsEnabled;
  return out as unknown as Settings;
}

/** Stamp the settings that changed (used when saving settings). */
export function stampSettings(prev: Settings, next: Settings, now: string): Settings {
  const times: Record<string, string> = { ...(prev.fieldTimes ?? {}), ...(next.fieldTimes ?? {}) };
  for (const k of Object.keys(next)) {
    if (DEVICE_ONLY.has(k)) continue;
    // Settings without a time yet keep the time of the previous save, not "now".
    if (!times[k]) times[k] = prev.updatedAt;
    if (JSON.stringify((prev as unknown as Record<string, unknown>)[k]) !== JSON.stringify((next as unknown as Record<string, unknown>)[k])) times[k] = now;
  }
  return { ...next, fieldTimes: times, updatedAt: now };
}

export function toPayload(d: AppData): VaultPayload {
  const { meta, ...rest } = d;
  return { app: 'my-bp-weight-tracker-vault', version: 1, savedAt: new Date().toISOString(), data: { ...rest, settings: { ...rest.settings, vault: null } }, tombstones: meta.tombstones ?? [] };
}

/** Stable fingerprint of what is synced (order of records doesn't matter). */
export function syncFingerprint(d: Pick<AppData, CollectionName | 'settings'> & { meta?: AppData['meta'] }, tombstones = d.meta?.tombstones ?? []): string {
  const parts: unknown[] = COLLECTIONS.map((c) => [...(d[c] as Rec[])].sort((a, b) => a.id.localeCompare(b.id)));
  const { vault: _v, notificationsEnabled: _n, ...settings } = d.settings;
  void _v;
  void _n;
  parts.push(settings, [...tombstones].sort((a, b) => `${a.c}${a.id}`.localeCompare(`${b.c}${b.id}`)));
  return JSON.stringify(parts);
}

// ---------------------------------------------------------------- relay calls
export class VaultHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'VaultHttpError';
  }
}

async function call<T>(method: string, d: Derived, body?: unknown): Promise<T | null> {
  const res = await fetch(`${shareApiBase()}/v1/vault/${d.id}`, {
    method,
    headers: { 'X-Vault-Proof': d.proof, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    let msg = `Cloud backup error (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new VaultHttpError(res.status, msg);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export interface Remote { payload: VaultPayload; version: number; updatedAt: number }

export async function fetchRemote(recoveryKey: string): Promise<Remote | null> {
  const d = await deriveVault(recoveryKey);
  const r = await call<{ iv: string; ct: string; version: number; updatedAt: number }>('GET', d);
  if (!r) return null;
  return { payload: await openPayload(r, d), version: r.version, updatedAt: r.updatedAt };
}

export async function deleteRemote(recoveryKey: string): Promise<void> {
  await call('DELETE', await deriveVault(recoveryKey));
}

// ---------------------------------------------------------------- sync
export type VaultState = 'idle' | 'syncing' | 'ok' | 'offline' | 'error';
export interface VaultStatus { state: VaultState; lastSyncAt: number | null; message: string | null }

const STATUS_KEY = 'bpt-vault-status';
let status: VaultStatus = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(STATUS_KEY) ?? 'null') as { at?: number } | null;
    return { state: s?.at ? 'ok' : 'idle', lastSyncAt: s?.at ?? null, message: null } as VaultStatus;
  } catch {
    return { state: 'idle', lastSyncAt: null, message: null } as VaultStatus;
  }
})();
const listeners = new Set<() => void>();
function setStatus(s: VaultStatus) {
  status = s;
  if (s.state === 'ok' && s.lastSyncAt) {
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify({ at: s.lastSyncAt }));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}
export const getVaultStatus = () => status;
export function subscribeVault(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let running: Promise<void> | null = null;

/**
 * One sync round. `getLocal` returns the newest local data at the moment it's
 * called, and `apply` saves merged data locally (only called when it changed).
 */
export function syncVault(getLocal: () => AppData, apply: (d: AppData) => Promise<void>): Promise<void> {
  if (running) return running;
  running = (async () => {
    const cfg: VaultConfig | null | undefined = getLocal().settings.vault;
    if (!cfg || !shareApiBase()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus({ ...status, state: 'offline', message: 'Waiting for an internet connection.' });
      return;
    }
    setStatus({ ...status, state: 'syncing', message: null });
    try {
      const d = await deriveVault(cfg.key);
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await call<{ iv: string; ct: string; version: number }>('GET', d);
        const payload = remote ? await openPayload(remote, d) : null;
        const local = getLocal();
        if (!local.settings.vault) return; // turned off meanwhile
        const merged = payload ? mergeData(local, payload) : local;
        if (syncFingerprint(merged) !== syncFingerprint(local)) await apply(merged);
        const remoteFp = payload ? syncFingerprint({ ...payload.data, meta: undefined } as never, payload.tombstones) : null;
        if (remoteFp !== syncFingerprint(merged)) {
          try {
            await call('PUT', d, { ...(await sealPayload(toPayload(merged), d)), baseVersion: remote?.version ?? 0 });
          } catch (e) {
            if (e instanceof VaultHttpError && e.status === 409) continue; // another device saved first: merge again
            throw e;
          }
        }
        lastSynced = syncFingerprint(merged);
        setStatus({ state: 'ok', lastSyncAt: Date.now(), message: null });
        return;
      }
      throw new Error('Another device keeps saving at the same time. It will try again shortly.');
    } catch (e) {
      const offline = !(e instanceof VaultHttpError) && !(e instanceof VaultKeyError) && (e as Error).name === 'TypeError';
      setStatus({ ...status, state: offline ? 'offline' : 'error', message: offline ? 'Couldn’t reach the cloud backup. It will try again.' : (e as Error).message });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * A device joining an existing cloud backup: records are merged, and the
 * cloud copy's settings are used (this device's defaults must not win just
 * because they were saved a moment ago).
 */
export function joinData(local: AppData, remote: VaultPayload, cfg: VaultConfig): AppData {
  const merged = mergeData(local, remote);
  return { ...merged, settings: { ...remote.data.settings, vault: cfg, notificationsEnabled: local.settings.notificationsEnabled } };
}

/** Local fingerprint at the last successful sync (to skip rounds when nothing changed here). */
let lastSynced: string | null = null;
export function changedSinceSync(d: AppData): boolean {
  return syncFingerprint(d) !== lastSynced;
}

/** Test helper. */
export function _resetVaultForTests() {
  lastSynced = null;
  status = { state: 'idle', lastSyncAt: null, message: null };
  running = null;
  derivedCache.clear();
}
