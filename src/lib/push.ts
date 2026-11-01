// Reminders that arrive when the app is closed (Web Push).
//
// The relay stores only this device's push address, its time zone and the
// reminder times; it sends an EMPTY push at each time. The service worker then
// shows the matching generic reminder from a small list kept on this device
// (no medication names or health data). On iPhone/iPad this works only for the
// app added to the Home Screen.
import type { AppData } from '../types';
import { reminderEvents } from './ics';
import { shareApiBase } from './share';

const STATE_KEY = 'bpt-push';
const META_CACHE = 'bpt-push-meta';

export interface PushItem { t: string; d?: number[]; n?: number; s?: string; u?: string; title: string; body: string; url: string }
interface PushState { id: string; token: string; sent: string | null }

export function vapidPublicKey(): string {
  return ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();
}
export function pushConfigured(): boolean {
  return !!vapidPublicKey() && !!shareApiBase();
}
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function isIos(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
}
export function isStandalone(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
}

const URLS: Record<string, string> = { 'morning-pre': '#/add?type=morning_pre', evening: '#/add?type=evening', weight: '#/weight' };

/** The reminder times this device should be woken for (same events as the calendar export). */
export function pushSchedule(d: AppData): PushItem[] {
  return reminderEvents(d).map((e) => ({
    t: e.time,
    ...(e.byDay ? { d: e.byDay } : {}),
    ...(e.everyDays && e.startDate ? { n: e.everyDays, s: e.startDate } : {}),
    ...(e.until ? { u: e.until } : {}),
    title: e.title,
    body: e.description,
    url: URLS[e.uid] ?? (e.uid.startsWith('medication') ? '#/medication' : '#/'),
  }));
}

function readState(): PushState | null {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as PushState | null;
  } catch {
    return null;
  }
}
function writeState(s: PushState | null) {
  try {
    if (s) localStorage.setItem(STATE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}
export function pushEnabledHere(): boolean {
  return !!readState();
}

function rand(n: number): string {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(n))) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${shareApiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!res.ok) {
    let msg = `Reminder server error (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

/** Keep the generic reminder list where the service worker can read it. */
async function writeMeta(reg: ServiceWorkerRegistration, d: AppData, items: PushItem[]) {
  const cache = await caches.open(META_CACHE);
  await cache.put(new URL('push-schedule.json', reg.scope).href, new Response(JSON.stringify({ tz: d.settings.timeZone, items }), { headers: { 'Content-Type': 'application/json' } }));
}

async function sendSchedule(state: PushState, sub: PushSubscription, d: AppData, force = false) {
  const items = pushSchedule(d);
  const schedule = items.map(({ t, d: days, n, s, u }) => ({ t, ...(days ? { d: days } : {}), ...(n ? { n, s } : {}), ...(u ? { u } : {}) }));
  const payload = { subscription: { endpoint: sub.endpoint }, tz: d.settings.timeZone, schedule };
  const fingerprint = JSON.stringify(payload);
  if (!force && fingerprint === state.sent) return;
  await api('PUT', `/v1/push/${state.id}`, state.token, payload);
  writeState({ ...state, sent: fingerprint });
}

export async function enablePush(d: AppData): Promise<void> {
  if (!pushConfigured()) throw new Error('Reminders when the app is closed aren’t set up for this copy of the app.');
  if (!pushSupported()) throw new Error('This browser can’t receive reminders when the app is closed.');
  if (isIos() && !isStandalone()) throw new Error('On iPhone and iPad, add the app to your Home Screen first (Share → Add to Home Screen), then turn this on from there.');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications weren’t allowed. You can allow them in your browser’s site settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey()) }));
  const state: PushState = readState() ?? { id: rand(16), token: rand(32), sent: null };
  await sendSchedule(state, sub, d, true);
  await writeMeta(reg, d, pushSchedule(d));
}

export async function disablePush(): Promise<void> {
  const state = readState();
  writeState(null);
  try {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    await caches.delete(META_CACHE);
  } catch {
    /* ignore */
  }
  if (state) await api('DELETE', `/v1/push/${state.id}`, state.token).catch(() => undefined);
}

/** Send changed reminder times (called when settings or medicines change). */
export async function syncPush(d: AppData): Promise<void> {
  const state = readState();
  if (!state || !pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return writeState(null); // the browser dropped it; the user can turn it on again
  await writeMeta(reg, d, pushSchedule(d));
  await sendSchedule(state, sub, d);
}

export async function testPush(): Promise<void> {
  const state = readState();
  if (!state) throw new Error('Turn on reminders when the app is closed first.');
  await api('POST', `/v1/push/${state.id}/test`, state.token);
}
