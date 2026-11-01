// Live doctor share link.
//
// The patient's browser builds a snapshot of the chosen records, encrypts it
// with AES-256-GCM, and uploads only the ciphertext to the share relay
// (share-worker/). Links carry a short random secret (96 bits) in the
// #fragment, which browsers never send to any server. The AES key and the
// relay's record id are both derived from that secret (HKDF / SHA-256), so the
// relay cannot read the data and the link stays short:
//   https://…/#/d/sam-citizen/Xk3pQ9rT2mWv8bLc   (the name is only a label)
// Older links (#/shared/<id>?k=<43-char key>) keep working.
// Whenever records change, the app re-encrypts and replaces the blob, so the
// same link always shows the latest data.

import type { AppData, ISODate, ShareConfig, ShareOptions } from '../types';
import { addDays, todayIn } from './time';
import { DEFAULT_SHARE_OPTIONS, defaultSettings, emptyData } from './defaults';
import { getVaultStatus } from './vault';

export const SHARE_APP_ID = 'my-bp-weight-tracker-share';
export const SHARE_WINDOWS = [30, 90, 180, 365] as const;
export const SHARE_EXPIRY_DAYS = [30, 90, 180, 365] as const;

export { DEFAULT_SHARE_OPTIONS };

/** Base URL of the share relay, set at build time (VITE_SHARE_API_URL). Empty = not set up. */
export function shareApiBase(): string {
  const v = (import.meta.env.VITE_SHARE_API_URL as string | undefined) ?? '';
  return v.trim().replace(/\/+$/, '');
}

/**
 * Address used at the start of doctor links (VITE_SHARE_LINK_BASE), so links
 * can use a neutral host instead of the one the patient's app runs on (e.g. a
 * GitHub Pages address that contains an account name). Defaults to this app.
 */
export function shareLinkBase(): string {
  const v = ((import.meta.env.VITE_SHARE_LINK_BASE as string | undefined) ?? '').trim();
  if (v) return v.endsWith('/') ? v : `${v}/`;
  return typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
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

export const SECRET_RE = /^[A-Za-z0-9_-]{16}$/;
const enc = new TextEncoder();

/** 96-bit random link secret, 16 URL-safe characters. */
export function generateShareSecret(): string {
  return toUrl(toB64(crypto.getRandomValues(new Uint8Array(12))));
}

/** The relay's record id for a short link: a one-way hash of the secret. */
export async function shareIdFromSecret(secret: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`my-bp-weight-tracker-share:id:${secret}`));
  return toUrl(toB64(new Uint8Array(buf))).slice(0, 22);
}

export const PIN_RE = /^\d{4,8}$/;

async function importKey(k: string, pin?: string | null): Promise<CryptoKey> {
  if (SECRET_RE.test(k)) {
    const base = await crypto.subtle.importKey('raw', fromB64(fromUrl(k)), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('my-bp-weight-tracker-share-v2'), info: enc.encode(pin ? `aes-256-gcm:pin:${pin}` : 'aes-256-gcm') },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }
  const raw = fromB64(fromUrl(k));
  if (raw.length !== 32) throw new Error('Invalid key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface SealedShare { v: 1; iv: string; ct: string }

/**
 * Proof that the viewer knows the PIN, sent to the relay, which only stores
 * its SHA-256 hash and releases the encrypted data only for a matching proof
 * (10 wrong tries lock the link for an hour).
 */
export async function pinProof(secret: string, pin: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', fromB64(fromUrl(secret)), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('my-bp-weight-tracker-share-v2'), info: enc.encode(`read-proof:${pin}`) }, base, 256);
  return toUrl(toB64(new Uint8Array(bits)));
}
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function readHashFor(cfg: Pick<ShareConfig, 'key' | 'pin'>): Promise<string | null> {
  return cfg.pin && SECRET_RE.test(cfg.key) ? sha256Hex(await pinProof(cfg.key, cfg.pin)) : null;
}

/** Encrypt; the share id is bound as associated data so blobs can't be swapped between links. */
export async function encryptSnapshot(snapshot: ShareSnapshot, keyB64: string, id: string, pin?: string | null): Promise<SealedShare> {
  const key = await importKey(keyB64, pin);
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

export async function decryptSnapshot(sealed: { iv: string; ct: string }, keyB64: string, id: string, pin?: string | null): Promise<ShareSnapshot> {
  let snap: ShareSnapshot;
  try {
    const key = await importKey(keyB64, pin);
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
      measurementWeeks: (data.settings.measurementWeeks ?? []).filter((w) => w.startDate <= to && addDays(w.startDate, w.days - 1) >= from),
      onboarded: true,
      share: null,
    },
    meta: { ...base.meta, createdAt: data.meta.createdAt },
  };
  return { app: SHARE_APP_ID, version: 1, generatedAt: now.toISOString(), from, to, options, data: snapData };
}

/** Content fingerprint ignoring the generation time, to skip uploads when nothing changed. */
export async function snapshotFingerprint(s: ShareSnapshot, pin: string | null = null): Promise<string> {
  const text = JSON.stringify({ ...s, generatedAt: '', pin });
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
/** "Sam Citizen" → "sam-citizen". Letters in any alphabet are kept. */
export function slugifyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export function isSharedHash(hash: string): boolean {
  return hash.startsWith('#/d/') || hash.startsWith('#/shared/');
}

export function buildShareLink(cfg: Pick<ShareConfig, 'id' | 'key' | 'linkName'>, base = shareLinkBase()): string {
  if (SECRET_RE.test(cfg.key)) {
    const name = slugifyName(cfg.linkName ?? '');
    return `${base}#/d/${name ? `${encodeURIComponent(name)}/` : ''}${cfg.key}`;
  }
  return `${base}#/shared/${cfg.id}?k=${cfg.key}`;
}

export interface ParsedShareLink { id: string | null; key: string; name: string | null; preview?: boolean }

/** Parse a link's #fragment. Short links need resolveShareId() for the id. */
export function parseShareHash(hash: string): ParsedShareLink | null {
  const short = hash.match(/^#\/d\/(?:([^/?]*)\/)?([A-Za-z0-9_-]{16})[.,;:!)\]]*(?:\?([^#]*))?$/);
  if (short) {
    const preview = new URLSearchParams(short[3] ?? '').has('preview');
    let name: string | null = null;
    try {
      name = short[1] ? decodeURIComponent(short[1]) : null;
    } catch {
      name = short[1] ?? null;
    }
    return { id: null, key: short[2], name, ...(preview ? { preview } : {}) };
  }
  const m = hash.match(/^#\/shared\/([A-Za-z0-9_-]{22})\?(.*)$/);
  if (!m) return null;
  const key = new URLSearchParams(m[2]).get('k');
  if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return { id: m[1], key, name: null };
}

export async function resolveShareId(p: ParsedShareLink): Promise<string> {
  return p.id ?? shareIdFromSecret(p.key);
}

// ---------- this device ----------
const DEVICE_KEY = 'bpt-device-id';
let memoryDeviceId: string | null = null;
/** Random id for this browser, so only one device updates a link at a time. */
export function deviceId(): string {
  try {
    let v = localStorage.getItem(DEVICE_KEY);
    if (!v) {
      v = generateShareSecret();
      localStorage.setItem(DEVICE_KEY, v);
    }
    return v;
  } catch {
    return (memoryDeviceId ??= generateShareSecret());
  }
}

// ---------- API ----------
export class ShareHttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public info: { remaining?: number; retryAt?: number } = {}) {
    super(message);
    this.name = 'ShareHttpError';
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${shareApiBase()}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) {
    let msg = `Share server error (${res.status})`;
    let info: { error?: string; code?: string; remaining?: number; retryAt?: number } = {};
    try {
      info = (await res.json()) as typeof info;
      msg = info.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ShareHttpError(res.status, msg, info.code, info);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Create a new short link and upload the first snapshot. */
export async function createShare(data: AppData, options: ShareOptions, expiresInDays: number, linkName = '', pin: string | null = null): Promise<ShareConfig> {
  const secret = generateShareSecret();
  const id = await shareIdFromSecret(secret);
  const snap = buildShareSnapshot(data, options);
  const p = pin && PIN_RE.test(pin) ? pin : null;
  const created = await call<{ id: string; token: string; updatedAt: number; expiresAt: number }>('POST', '/v1/shares', { ...(await encryptSnapshot(snap, secret, id, p)), id, expiresInDays, writer: deviceId(), readHash: await readHashFor({ key: secret, pin: p }) });
  const config: ShareConfig = { id, token: created.token, key: secret, linkName: slugifyName(linkName), pin: p, createdAt: new Date(created.updatedAt).toISOString(), expiresAt: new Date(created.expiresAt).toISOString(), options };
  rememberUpload(config.id, await snapshotFingerprint(snap, p));
  return config;
}

export interface ShareStatus { updatedAt: number; expiresAt: number; lastViewedAt: number | null; views: number; pin: boolean }
/** Owner-only: when the link was last opened (not counting previews) and how often. */
export async function fetchShareStatus(cfg: ShareConfig): Promise<ShareStatus> {
  return call<ShareStatus>('GET', `/v1/shares/${cfg.id}/status`, undefined, cfg.token);
}

export async function deleteShare(config: ShareConfig): Promise<void> {
  // Make sure no queued or in-flight update for this link can reach the
  // server after the delete (it would otherwise be re-created or race it).
  deletedIds.add(config.id);
  if (timer) clearTimeout(timer);
  timer = null;
  queued = null;
  lastRequested = null;
  if (inFlight) await inFlight.catch(() => undefined);
  try {
    await call('DELETE', `/v1/shares/${config.id}`, undefined, config.token);
  } catch (e) {
    if (!(e instanceof ShareHttpError && e.status === 404)) throw e; // already gone is fine
  }
  forgetUpload(config.id);
}

export async function fetchShared(id: string, key: string, opts: { pin?: string | null; preview?: boolean } = {}): Promise<{ snapshot: ShareSnapshot; updatedAt: number; expiresAt: number }> {
  const headers: Record<string, string> = {};
  if (opts.pin && SECRET_RE.test(key)) headers['X-Share-Proof'] = await pinProof(key, opts.pin);
  if (opts.preview) headers['X-Share-Preview'] = '1';
  const r = await call<{ v: 1; iv: string; ct: string; updatedAt: number; expiresAt: number }>('GET', `/v1/shares/${id}`, undefined, undefined, headers);
  return { snapshot: await decryptSnapshot(r, key, id, opts.pin), updatedAt: r.updatedAt, expiresAt: r.expiresAt };
}

// ---------- background sync ----------
export type SyncState = 'idle' | 'uploading' | 'ok' | 'offline' | 'error' | 'gone' | 'other-device';
export interface SyncStatus { state: SyncState; lastUploadedAt: number | null; message: string | null }

const MIN_INTERVAL_MS = 15_000;
const statusKey = (id: string) => `bpt-share-status:${id}`;
let status: SyncStatus = { state: 'idle', lastUploadedAt: null, message: null };
let statusId: string | null = null;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let queued: AppData | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Latest data handed to requestSync, used to retry after a failure. */
let lastRequested: AppData | null = null;
/** Links turned off in this session: never upload to them again. */
const deletedIds = new Set<string>();
const RETRY_MS = 60_000;

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
export function requestSync(data: AppData, opts: { force?: boolean; takeover?: boolean } = {}): Promise<void> {
  const cfg = data.settings.share;
  if (!cfg || deletedIds.has(cfg.id)) return Promise.resolve();
  queued = data;
  lastRequested = data;
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
        await uploadOnce(d, !!opts.force, !!opts.takeover);
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function uploadOnce(data: AppData, force: boolean, takeover = false) {
  const cfg = data.settings.share;
  if (!cfg || deletedIds.has(cfg.id) || !shareAvailable()) return;
  if (new Date(cfg.expiresAt).getTime() <= Date.now()) {
    setStatus(cfg.id, { ...getSyncStatus(cfg.id), state: 'gone', message: 'This link has expired.' });
    return;
  }
  const snap = buildShareSnapshot(data, cfg.options);
  const pin = cfg.pin && SECRET_RE.test(cfg.key) ? cfg.pin : null;
  const hash = await snapshotFingerprint(snap, pin);
  if (!force && readStored(cfg.id).hash === hash) {
    if (statusId !== cfg.id || status.state !== 'ok') setStatus(cfg.id, getSyncStatus(cfg.id));
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus(cfg.id, { ...getSyncStatus(cfg.id), state: 'offline', message: 'Waiting for an internet connection.' });
    scheduleRetry();
    return;
  }
  setStatus(cfg.id, { ...getSyncStatus(cfg.id), state: 'uploading', message: null });
  try {
    await call('PUT', `/v1/shares/${cfg.id}`, { ...(await encryptSnapshot(snap, cfg.key, cfg.id, pin)), readHash: await readHashFor({ key: cfg.key, pin }), writer: deviceId(), ...(takeover ? { takeover: true } : {}) }, cfg.token);
    rememberUpload(cfg.id, hash);
  } catch (e) {
    if (e instanceof ShareHttpError && e.status === 409) {
      // With cloud sync working, this device has the same records as the other one,
      // so it can safely take over updating the link instead of stopping.
      const v = getVaultStatus();
      if (!takeover && data.settings.vault && v.state === 'ok' && v.lastSyncAt && Date.now() - v.lastSyncAt < 10 * 60_000) {
        return uploadOnce(data, true, true);
      }
      setStatus(cfg.id, { ...getSyncStatus(cfg.id), state: 'other-device', message: 'Another device is now updating this link, so this device has stopped, to avoid replacing newer records with older ones.' });
      return;
    }
    const gone = e instanceof ShareHttpError && (e.status === 404 || e.status === 403);
    const offline = !(e instanceof ShareHttpError);
    setStatus(cfg.id, {
      ...getSyncStatus(cfg.id),
      state: gone ? 'gone' : offline ? 'offline' : 'error',
      message: gone ? 'This link has expired or was turned off.' : offline ? 'Could not reach the share server. It will try again shortly.' : (e as Error).message,
    });
    if (!gone) scheduleRetry();
  }
}

/** Try again in a minute after a network or server failure. */
function scheduleRetry() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (lastRequested) void requestSync(lastRequested);
  }, RETRY_MS);
}

/** Test helper. */
export function _resetSyncForTests() {
  status = { state: 'idle', lastUploadedAt: null, message: null };
  statusId = null;
  inFlight = null;
  queued = null;
  lastRequested = null;
  deletedIds.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}
