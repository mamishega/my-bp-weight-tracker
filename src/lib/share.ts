// Live doctor share link.
//
// The patient's browser builds a snapshot of the chosen records, encrypts it
// with AES-256-GCM using a random key, and uploads only the ciphertext to the
// share relay (share-worker/). The key is placed in the link's #fragment,
// which browsers never send to any server, so the relay cannot read it.
// Whenever records change, the app re-encrypts and replaces the blob, so the
// same link always shows the latest data.

import type { AppData, ISODate, ShareConfig, ShareOptions } from '../types';
import { addDays, todayIn } from './time';
import { defaultSettings, emptyData } from './defaults';

export const SHARE_APP_ID = 'my-bp-weight-tracker-share';
export const SHARE_WINDOWS = [30, 90, 180, 365] as const;
export const SHARE_EXPIRY_DAYS = [30, 90, 180, 365] as const;

export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  windowDays: 90,
  displayName: '',
  sessionNotes: true,
  symptoms: true,
  lifestyle: false,
  doseNotes: true,
  questions: true,
  quality: true,
  weightNotes: false,
};

/** Base URL of the share relay, set at build time (VITE_SHARE_API_URL). Empty = not set up. */
export function shareApiBase(): string {
  const v = (import.meta.env.VITE_SHARE_API_URL as string | undefined) ?? '';
  return v.trim().replace(/\/+$/, '');
}

export function shareAvailable(): boolean {
  return !!shareApiBase() && typeof crypto !== 'undefined' && !!crypto.subtle;
}

// ---------- encoding ----------
function toB64(bytes: Uint8Array): string {
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
const toUrl = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl = (s: string) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return b + '='.repeat((4 - (b.length % 4)) % 4);
};

// ---------- crypto ----------
export async function generateShareKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return toUrl(toB64(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
}

async function importKey(k: string): Promise<CryptoKey> {
  const raw = fromB64(fromUrl(k));
  if (raw.length !== 32) throw new Error('Invalid key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface SealedShare { v: 1; iv: string; ct: string }

/** Encrypt; the share id is bound as associated data so blobs can't be swapped between links. */
export async function encryptSnapshot(snapshot: ShareSnapshot, keyB64: string, id: string): Promise<SealedShare> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, key, new TextEncoder().encode(JSON.stringify(snapshot)));
  return { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** The link's key doesn't open this data (incomplete or altered link). */
export class ShareDecryptError extends Error {
  constructor() {
    super('This link is incomplete or damaged.');
    this.name = 'ShareDecryptError';
  }
}

export async function decryptSnapshot(sealed: { iv: string; ct: string }, keyB64: string, id: string): Promise<ShareSnapshot> {
  let snap: ShareSnapshot;
  try {
    const key = await importKey(keyB64);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: new TextEncoder().encode(id) }, key, fromB64(sealed.ct));
    snap = JSON.parse(new TextDecoder().decode(pt)) as ShareSnapshot;
  } catch {
    throw new ShareDecryptError();
  }
  if (snap?.app !== SHARE_APP_ID || snap.version !== 1) throw new ShareDecryptError();
  return snap;
}

// ---------- snapshot ----------
export interface ShareSnapshot {
  app: typeof SHARE_APP_ID;
  version: 1;
  generatedAt: string;
  from: ISODate;
  to: ISODate;
  options: ShareOptions;
  data: AppData;
}

/**
 * Build the data the doctor will see: only the chosen time window, and only
 * the optional content the patient ticked. Reminders, habits, supply counts,
 * monitors, backup info and the share secrets are never included.
 */
export function buildShareSnapshot(data: AppData, options: ShareOptions, now = new Date()): ShareSnapshot {
  const tz = data.settings.timeZone;
  const to = todayIn(tz, now);
  const from = addDays(to, -((options.windowDays ?? 90) - 1));
  const inR = (d: string, lead = 0) => d >= addDays(from, -lead) && d <= to;
  const base = emptyData();
  const d0 = defaultSettings(data.settings.updatedAt);
  const snapData: AppData = {
    ...base,
    sessions: data.sessions.filter((s) => inR(s.date)).map((s) => (options.sessionNotes ? s : { ...s, notes: '', symptoms: '' })),
    // One day of lead so a dose taken just before the window still links to its after-medication reading.
    doses: data.doses.filter((d) => inR(d.date, 1)).map((d) => (options.doseNotes ? d : { ...d, notes: '' })),
    medications: data.medications.map((m) => ({ ...m })),
    // Six days of lead so the 7-day moving average at the start of the window is correct.
    weights: data.weights.filter((w) => inR(w.date, 6)).map((w) => (options.weightNotes ? w : { ...w, notes: '' })),
    symptoms: options.symptoms ? data.symptoms.filter((s) => inR(s.date)) : [],
    dailyLogs: options.lifestyle ? data.dailyLogs.filter((l) => inR(l.date)) : [],
    appointments: data.appointments.filter((a) => a.date >= to).map((a) => ({ ...a, notes: '', location: '' })),
    questions: options.questions ? data.questions.filter((q) => !q.resolved) : [],
    settings: {
      ...d0,
      timeZone: tz,
      weightUnit: data.settings.weightUnit,
      targets: data.settings.targets,
      weightGoal: data.settings.weightGoal,
      onboarded: true,
      share: null,
    },
    meta: { ...base.meta, createdAt: data.meta.createdAt },
  };
  return { app: SHARE_APP_ID, version: 1, generatedAt: now.toISOString(), from, to, options, data: snapData };
}

/** Content fingerprint ignoring the generation time, to skip uploads when nothing changed. */
export async function snapshotFingerprint(s: ShareSnapshot): Promise<string> {
  const text = JSON.stringify({ ...s, generatedAt: '' });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toB64(new Uint8Array(buf));
}

/** "5 minutes ago" style text. */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

// ---------- links ----------
export function buildShareLink(id: string, key: string, base = `${location.origin}${location.pathname}`): string {
  return `${base}#/shared/${id}?k=${key}`;
}

export function parseShareHash(hash: string): { id: string; key: string } | null {
  const m = hash.match(/^#\/shared\/([A-Za-z0-9_-]{22})\?(.*)$/);
  if (!m) return null;
  const key = new URLSearchParams(m[2]).get('k');
  if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return { id: m[1], key };
}

// ---------- API ----------
export class ShareHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ShareHttpError';
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${shareApiBase()}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) {
    let msg = `Share server error (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ShareHttpError(res.status, msg);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Create a new link and upload the first snapshot. */
export async function createShare(data: AppData, options: ShareOptions, expiresInDays: number): Promise<ShareConfig> {
  const key = await generateShareKey();
  // The id comes from the server, so encrypt a placeholder first, then upload the real snapshot bound to the id.
  const placeholder = await encryptSnapshot(buildShareSnapshot(emptyData(), options), key, 'pending');
  const created = await call<{ id: string; token: string; updatedAt: number; expiresAt: number }>('POST', '/v1/shares', { ...placeholder, expiresInDays });
  const config: ShareConfig = { id: created.id, token: created.token, key, createdAt: new Date(created.updatedAt).toISOString(), expiresAt: new Date(created.expiresAt).toISOString(), options };
  const snap = buildShareSnapshot(data, options);
  try {
    await call('PUT', `/v1/shares/${config.id}`, await encryptSnapshot(snap, key, config.id), config.token);
  } catch (e) {
    await call('DELETE', `/v1/shares/${config.id}`, undefined, config.token).catch(() => undefined);
    throw e;
  }
  rememberUpload(config.id, await snapshotFingerprint(snap));
  return config;
}

export async function deleteShare(config: ShareConfig): Promise<void> {
  try {
    await call('DELETE', `/v1/shares/${config.id}`, undefined, config.token);
  } catch (e) {
    if (!(e instanceof ShareHttpError && e.status === 404)) throw e; // already gone is fine
  }
  forgetUpload(config.id);
}

export async function fetchShared(id: string, key: string): Promise<{ snapshot: ShareSnapshot; updatedAt: number; expiresAt: number }> {
  const r = await call<{ v: 1; iv: string; ct: string; updatedAt: number; expiresAt: number }>('GET', `/v1/shares/${id}`);
  return { snapshot: await decryptSnapshot(r, key, id), updatedAt: r.updatedAt, expiresAt: r.expiresAt };
}

// ---------- background sync ----------
export type SyncState = 'idle' | 'uploading' | 'ok' | 'offline' | 'error' | 'gone';
export interface SyncStatus { state: SyncState; lastUploadedAt: number | null; message: string | null }

const MIN_INTERVAL_MS = 15_000;
const statusKey = (id: string) => `bpt-share-status:${id}`;
let status: SyncStatus = { state: 'idle', lastUploadedAt: null, message: null };
let statusId: string | null = null;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let queued: AppData | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function readStored(id: string): { hash: string | null; at: number | null } {
  try {
    const v = JSON.parse(localStorage.getItem(statusKey(id)) ?? 'null') as { hash?: string; at?: number } | null;
    return { hash: v?.hash ?? null, at: v?.at ?? null };
  } catch {
    return { hash: null, at: null };
  }
}
function rememberUpload(id: string, hash: string) {
  const at = Date.now();
  try {
    localStorage.setItem(statusKey(id), JSON.stringify({ hash, at }));
  } catch {
    /* ignore */
  }
  setStatus(id, { state: 'ok', lastUploadedAt: at, message: null });
}
function forgetUpload(id: string) {
  try {
    localStorage.removeItem(statusKey(id));
  } catch {
    /* ignore */
  }
  if (statusId === id) setStatus(id, { state: 'idle', lastUploadedAt: null, message: null });
}
function setStatus(id: string, s: SyncStatus) {
  statusId = id;
  status = s;
  listeners.forEach((l) => l());
}

/** Stable between changes (safe for useSyncExternalStore). */
export function getSyncStatus(id: string): SyncStatus {
  if (statusId !== id) {
    const st = readStored(id);
    statusId = id;
    status = { state: st.at ? 'ok' : 'idle', lastUploadedAt: st.at, message: null };
  }
  return status;
}
export function subscribeSync(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Upload the latest snapshot if it differs from the last upload. Calls are
 * coalesced: at most one request in flight, and at most one every 15 seconds.
 */
export function requestSync(data: AppData, opts: { force?: boolean } = {}): Promise<void> {
  const cfg = data.settings.share;
  if (!cfg) return Promise.resolve();
  queued = data;
  if (inFlight) return inFlight;
  const last = statusId === cfg.id ? status.lastUploadedAt : readStored(cfg.id).at;
  const wait = opts.force || !last ? 0 : Math.max(0, last + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) {
    if (!timer) timer = setTimeout(() => { timer = null; if (queued) void requestSync(queued); }, wait);
    return Promise.resolve();
  }
  inFlight = (async () => {
    try {
      while (queued) {
        const d = queued;
        queued = null;
        await uploadOnce(d, !!opts.force);
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function uploadOnce(data: AppData, force: boolean) {
  const cfg = data.settings.share;
  if (!cfg || !shareAvailable()) return;
  if (new Date(cfg.expiresAt).getTime() <= Date.now()) {
    setStatus(cfg.id, { ...getSyncStatus(cfg.id), state: 'gone', message: 'This link has expired.' });
    return;
  }
  const snap = buildShareSnapshot(data, cfg.options);
  const hash = await snapshotFingerprint(snap);
  if (!force && readStored(cfg.id).hash === hash) {
    if (statusId !== cfg.id || status.state !== 'ok') setStatus(cfg.id, getSyncStatus(cfg.id));
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus(cfg.id, { ...getSyncStatus(cfg.id), state: 'offline', message: 'Waiting for an internet connection.' });
    return;
  }
  setStatus(cfg.id, { ...getSyncStatus(cfg.id), state: 'uploading', message: null });
  try {
    await call('PUT', `/v1/shares/${cfg.id}`, await encryptSnapshot(snap, cfg.key, cfg.id), cfg.token);
    rememberUpload(cfg.id, hash);
  } catch (e) {
    const gone = e instanceof ShareHttpError && (e.status === 404 || e.status === 403);
    const offline = !(e instanceof ShareHttpError);
    setStatus(cfg.id, {
      ...getSyncStatus(cfg.id),
      state: gone ? 'gone' : offline ? 'offline' : 'error',
      message: gone ? 'This link has expired or was turned off.' : offline ? 'Could not reach the share server. It will retry when you are online.' : (e as Error).message,
    });
  }
}

/** Test helper. */
export function _resetSyncForTests() {
  status = { state: 'idle', lastUploadedAt: null, message: null };
  statusId = null;
  inFlight = null;
  queued = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
