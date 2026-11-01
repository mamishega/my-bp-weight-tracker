// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error plain JS worker module
import { handle, isDue, MAX_BODY_BYTES, sendDuePushes } from '../../share-worker/worker.js';
import { FakeKV } from './fakeShareServer';

const ORIGIN = 'https://app.example';
const BASE = 'https://share.example/v1/shares';
const blob = { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVydGV4dA==' };

let env: { SHARES: FakeKV; ALLOWED_ORIGINS: string };
beforeEach(() => {
  env = { SHARES: new FakeKV(), ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:5173` };
});

function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
}

async function create(extra: Record<string, unknown> = {}, now = Date.now()) {
  const res = await handle(req('POST', BASE, { ...blob, expiresInDays: 30, ...extra }), env, now);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; token: string; updatedAt: number; expiresAt: number };
}

describe('share relay worker', () => {
  it('creates a link, serves it, and lets only the token holder update or delete it', async () => {
    const now = 1_800_000_000_000;
    const c = await create({}, now);
    expect(c.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(c.expiresAt).toBe(now + 30 * 86_400_000);
    // Stored data never contains the token itself, and KV expiry is set.
    const stored = env.SHARES.map.get(`share:${c.id}`)!;
    expect(stored.value).not.toContain(c.token);
    expect(stored.expiration).toBe(Math.floor(c.expiresAt / 1000));

    const got = await handle(req('GET', `${BASE}/${c.id}`), env, now);
    expect(got.status).toBe(200);
    expect(got.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(got.headers.get('Cache-Control')).toBe('no-store');
    expect(await got.json()).toMatchObject({ v: 1, iv: blob.iv, ct: blob.ct });

    const bad = await handle(req('PUT', `${BASE}/${c.id}`, { ...blob, ct: 'bmV3' }, { Authorization: 'Bearer wrongwrongwrongwrongwrong' }), env, now);
    expect(bad.status).toBe(403);
    const none = await handle(req('PUT', `${BASE}/${c.id}`, { ...blob, ct: 'bmV3' }), env, now);
    expect(none.status).toBe(401);

    const ok = await handle(req('PUT', `${BASE}/${c.id}`, { ...blob, ct: 'bmV3' }, { Authorization: `Bearer ${c.token}` }), env, now + 5000);
    expect(ok.status).toBe(200);
    const after = await (await handle(req('GET', `${BASE}/${c.id}`), env, now + 6000)).json();
    expect(after.ct).toBe('bmV3');
    expect(after.updatedAt).toBe(now + 5000);
    expect(after.expiresAt).toBe(c.expiresAt); // updates never extend the expiry

    const del = await handle(req('DELETE', `${BASE}/${c.id}`, undefined, { Authorization: `Bearer ${c.token}` }), env, now);
    expect(del.status).toBe(204);
    expect((await handle(req('GET', `${BASE}/${c.id}`), env, now)).status).toBe(404);
  });

  it('accepts an app-chosen id once, and refuses to reuse it', async () => {
    const id = 'Z'.repeat(22);
    const first = await handle(req('POST', BASE, { ...blob, id }), env);
    expect(first.status).toBe(201);
    expect((await first.json()).id).toBe(id);
    expect((await handle(req('POST', BASE, { ...blob, id }), env)).status).toBe(409);
    expect((await handle(req('POST', BASE, { ...blob, id: 'bad id' }), env)).status).toBe(400);
  });

  it('lets only the last device update a link unless it takes over', async () => {
    const res = await handle(req('POST', BASE, { ...blob, writer: 'device-aaaa' }), env);
    const c = await res.json();
    const put = (writer: string, extra = {}) => handle(req('PUT', `${BASE}/${c.id}`, { ...blob, writer, ...extra }, { Authorization: `Bearer ${c.token}` }), env);
    expect((await put('device-aaaa')).status).toBe(200);
    const refused = await put('device-bbbb');
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('other-device');
    expect((await put('device-bbbb', { takeover: true })).status).toBe(200);
    expect((await put('device-aaaa')).status).toBe(409);
    // Older app versions that don't send a device id are still accepted.
    expect((await handle(req('PUT', `${BASE}/${c.id}`, blob, { Authorization: `Bearer ${c.token}` }), env)).status).toBe(200);
    // A device id never lets someone without the token in.
    expect((await handle(req('PUT', `${BASE}/${c.id}`, { ...blob, writer: 'device-bbbb', takeover: true }, { Authorization: 'Bearer wrongwrongwrongwrongwrong' }), env)).status).toBe(403);
  });

  it('treats expired links as gone even before KV removes them', async () => {
    const now = 1_800_000_000_000;
    const c = await create({ expiresInDays: 7 }, now);
    expect((await handle(req('GET', `${BASE}/${c.id}`), env, now + 8 * 86_400_000)).status).toBe(404);
  });

  it('only accepts allowed expiry lengths (default 90 days)', async () => {
    const now = 1_800_000_000_000;
    const c = await create({ expiresInDays: 9999 }, now);
    expect(c.expiresAt).toBe(now + 90 * 86_400_000);
  });

  it('refuses writes from other origins and without an origin', async () => {
    const foreign = await handle(req('POST', BASE, blob, { Origin: 'https://evil.example' }), env);
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const noOrigin = await handle(new Request(BASE, { method: 'POST', body: JSON.stringify(blob) }), env);
    expect(noOrigin.status).toBe(403);
    expect(env.SHARES.map.size).toBe(0);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    expect((await handle(req('OPTIONS', BASE), env)).status).toBe(204);
    expect((await handle(req('OPTIONS', BASE, undefined, { Origin: 'https://evil.example' }), env)).status).toBe(403);
  });

  it('rejects malformed, oversized and unknown requests', async () => {
    expect((await handle(req('POST', BASE, '{not json'), env)).status).toBe(400);
    expect((await handle(req('POST', BASE, { v: 2, iv: 'a', ct: 'b' }), env)).status).toBe(400);
    expect((await handle(req('POST', BASE, { ...blob, ct: 'not base64!' }), env)).status).toBe(400);
    expect((await handle(req('POST', BASE, { ...blob, ct: 'A'.repeat(MAX_BODY_BYTES) }), env)).status).toBe(413);
    expect((await handle(req('GET', `${BASE}/short`), env)).status).toBe(404);
    expect((await handle(req('GET', 'https://share.example/other'), env)).status).toBe(404);
    expect((await handle(req('DELETE', BASE), env)).status).toBe(405);
  });
});

describe('doctor link PIN, last viewed and status', () => {
  async function hex(s: string) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  it('requires the PIN proof, locks after 10 wrong tries, and never releases data without it', async () => {
    const proof = 'p'.repeat(43);
    const c = await (await handle(req('POST', BASE, { ...blob, readHash: await hex(proof) }), env)).json();
    const get = (h: Record<string, string> = {}, t = Date.now()) => handle(req('GET', `${BASE}/${c.id}`, undefined, h), env, t);
    const missing = await get();
    expect(missing.status).toBe(401);
    expect((await missing.json()).code).toBe('pin-required');
    expect((await get({ 'X-Share-Proof': proof })).status).toBe(200);
    const t = Date.now();
    for (let i = 0; i < 9; i++) expect((await get({ 'X-Share-Proof': 'w'.repeat(43) }, t)).status).toBe(403);
    expect((await get({ 'X-Share-Proof': 'w'.repeat(43) }, t)).status).toBe(403); // 10th: locks
    const locked = await get({ 'X-Share-Proof': proof }, t + 1000);
    expect(locked.status).toBe(429);
    expect((await locked.json()).ct).toBeUndefined();
    expect((await get({ 'X-Share-Proof': proof }, t + 61 * 60_000)).status).toBe(200);
  });

  it('records the last view (not previews) separately from the data, and reports it to the owner', async () => {
    const t0 = 1_800_000_000_000;
    const c = await (await handle(req('POST', BASE, blob), env, t0)).json();
    await handle(req('GET', `${BASE}/${c.id}`, undefined, { 'X-Share-Preview': '1' }), env, t0 + 1000);
    const status = () => handle(req('GET', `${BASE}/${c.id}/status`, undefined, { Authorization: `Bearer ${c.token}` }), env, t0 + 5000).then((r: Response) => r.json());
    expect(await status()).toMatchObject({ lastViewedAt: null, views: 0, pin: false });
    await handle(req('GET', `${BASE}/${c.id}`), env, t0 + 2000);
    await handle(req('GET', `${BASE}/${c.id}`), env, t0 + 3000); // within 15 min: not a new view
    expect(await status()).toMatchObject({ lastViewedAt: t0 + 2000, views: 1 });
    expect(JSON.parse(env.SHARES.map.get(`share:${c.id}`)!.value).ct).toBe(blob.ct);
    expect((await handle(req('GET', `${BASE}/${c.id}/status`), env)).status).toBe(401);
  });

  it('turning a PIN on and off goes through the owner’s update', async () => {
    const c = await (await handle(req('POST', BASE, blob), env)).json();
    const put = (b: Record<string, unknown>) => handle(req('PUT', `${BASE}/${c.id}`, { ...blob, ...b }, { Authorization: `Bearer ${c.token}` }), env);
    await put({ readHash: await hex('q'.repeat(43)) });
    expect((await handle(req('GET', `${BASE}/${c.id}`), env)).status).toBe(401);
    await put({}); // unchanged when not sent
    expect((await handle(req('GET', `${BASE}/${c.id}`), env)).status).toBe(401);
    await put({ readHash: null });
    expect((await handle(req('GET', `${BASE}/${c.id}`), env)).status).toBe(200);
  });
});

describe('encrypted cloud backup (vault)', () => {
  const VAULT = 'https://share.example/v1/vault/' + 'V'.repeat(22);
  const proof = 'v'.repeat(43);
  const put = (base: number, p = proof) => handle(req('PUT', VAULT, { ...blob, baseVersion: base }, { 'X-Vault-Proof': p }), env);
  it('creates, reads and updates with compare-and-swap versions', async () => {
    expect((await handle(req('GET', VAULT, undefined, { 'X-Vault-Proof': proof }), env)).status).toBe(404);
    expect((await put(0)).status).toBe(200);
    const stale = await put(0);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'conflict', version: 1 });
    expect((await put(1)).status).toBe(200);
    const got = await (await handle(req('GET', VAULT, undefined, { 'X-Vault-Proof': proof }), env)).json();
    expect(got).toMatchObject({ v: 1, version: 2, ct: blob.ct });
  });
  it('refuses the wrong recovery proof, and needs one', async () => {
    await put(0);
    expect((await put(1, 'x'.repeat(43))).status).toBe(403);
    expect((await handle(req('GET', VAULT, undefined, { 'X-Vault-Proof': 'x'.repeat(43) }), env)).status).toBe(403);
    expect((await handle(req('GET', VAULT), env)).status).toBe(401);
    expect((await handle(req('DELETE', VAULT, undefined, { 'X-Vault-Proof': 'x'.repeat(43) }), env)).status).toBe(403);
    expect((await handle(req('DELETE', VAULT, undefined, { 'X-Vault-Proof': proof }), env)).status).toBe(204);
  });
});

describe('push reminders', () => {
  const PUSH = 'https://share.example/v1/push/' + 'P'.repeat(22);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } };
  const tok = { Authorization: `Bearer ${'t'.repeat(32)}` };
  it('stores only times and a time zone, owned by a token', async () => {
    const ok = await handle(req('PUT', PUSH, { subscription: sub, tz: 'Australia/Sydney', schedule: [{ t: '07:00' }, { t: '07:30', d: [1] }] }, tok), env);
    expect(ok.status).toBe(200);
    const stored = env.SHARES.map.get('push:' + 'P'.repeat(22))!;
    expect(stored.metadata).toEqual({ tz: 'Australia/Sydney', s: ['07:00', '07:30@1'] });
    await handle(req('PUT', PUSH, { subscription: sub, tz: 'UTC', schedule: [{ t: '09:00', n: 2, s: '2026-11-01', u: '2026-12-01' }] }, tok), env);
    expect(env.SHARES.map.get('push:' + 'P'.repeat(22))!.metadata).toEqual({ tz: 'UTC', s: ['09:00~2~20261101!20261201'] });
    expect(stored.value).not.toContain('t'.repeat(32));
    expect((await handle(req('PUT', PUSH, { subscription: sub, tz: 'Australia/Sydney', schedule: [] }, { Authorization: `Bearer ${'u'.repeat(32)}` }), env)).status).toBe(403);
  });
  it('rejects unknown push services, bad times and bad zones', async () => {
    expect((await handle(req('PUT', PUSH, { subscription: { endpoint: 'https://evil.example/x' }, tz: 'UTC', schedule: [] }, tok), env)).status).toBe(400);
    expect((await handle(req('PUT', PUSH, { subscription: sub, tz: 'Mars/Base', schedule: [] }, tok), env)).status).toBe(400);
    expect((await handle(req('PUT', PUSH, { subscription: sub, tz: 'UTC', schedule: [{ t: '25:00' }] }, tok), env)).status).toBe(400);
  });
  it('knows when a reminder is due (5-minute window, weekdays, midnight)', () => {
    const at = (iso: string) => Date.parse(iso);
    // 07:02 in Sydney (UTC+11) on Mon 2 Nov 2026 = 20:02 UTC Sun 1 Nov.
    expect(isDue({ tz: 'Australia/Sydney', s: ['07:00'] }, at('2026-11-01T20:02:00Z'))).toBe(true);
    expect(isDue({ tz: 'Australia/Sydney', s: ['07:00'] }, at('2026-11-01T20:06:00Z'))).toBe(false);
    expect(isDue({ tz: 'Australia/Sydney', s: ['07:00@1'] }, at('2026-11-01T20:02:00Z'))).toBe(true);
    expect(isDue({ tz: 'Australia/Sydney', s: ['07:00@2'] }, at('2026-11-01T20:02:00Z'))).toBe(false);
    expect(isDue({ tz: 'UTC', s: ['23:58'] }, at('2026-11-02T00:01:00Z'))).toBe(true);
    expect(isDue({ tz: 'UTC', s: ['23:58@0'] }, at('2026-11-02T00:01:00Z'))).toBe(true); // Sunday's reminder, sent just after midnight
    // Every 3 days from 1 Nov; and a course ending 2 Nov.
    expect(isDue({ tz: 'UTC', s: ['07:00~3~20261101'] }, at('2026-11-04T07:01:00Z'))).toBe(true);
    expect(isDue({ tz: 'UTC', s: ['07:00~3~20261101'] }, at('2026-11-03T07:01:00Z'))).toBe(false);
    expect(isDue({ tz: 'UTC', s: ['07:00~3~20261101'] }, at('2026-10-29T07:01:00Z'))).toBe(false);
    expect(isDue({ tz: 'UTC', s: ['07:00!20261102'] }, at('2026-11-02T07:01:00Z'))).toBe(true);
    expect(isDue({ tz: 'UTC', s: ['07:00!20261102'] }, at('2026-11-03T07:01:00Z'))).toBe(false);
    expect(isDue({ tz: 'UTC', s: ['garbage'] }, at('2026-11-03T07:01:00Z'))).toBe(false);
  });
  it('sends a signed, empty push to due devices and forgets expired ones', async () => {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
    const pub = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const e = { ...env, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: jwk.d! };
    await handle(req('PUT', PUSH, { subscription: sub, tz: 'UTC', schedule: [{ t: '07:00' }] }, tok), env);
    await handle(req('PUT', 'https://share.example/v1/push/' + 'Q'.repeat(22), { subscription: { ...sub, endpoint: 'https://fcm.googleapis.com/gone' }, tz: 'UTC', schedule: [{ t: '07:00' }] }, tok), env);
    await handle(req('PUT', 'https://share.example/v1/push/' + 'R'.repeat(22), { subscription: sub, tz: 'UTC', schedule: [{ t: '12:00' }] }, tok), env);
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: url.endsWith('gone') ? 410 : 201 }); };
    const out = await sendDuePushes(e, Date.parse('2026-11-02T07:01:00Z'), fetcher as typeof fetch);
    expect(out).toEqual({ sent: 1, removed: 1 });
    expect(calls).toHaveLength(2);
    const auth = (calls[0].init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    // The signature verifies with the public key.
    const [h, c, sig] = auth.slice(8, auth.indexOf(',')).split('.');
    const fromUrl = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (x) => x.charCodeAt(0));
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, fromUrl(sig), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
    expect(JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ aud: 'https://fcm.googleapis.com' });
    expect(calls[0].init.body).toBeUndefined();
    expect(env.SHARES.map.has('push:' + 'Q'.repeat(22))).toBe(false);
  });
});

describe('rate limiting', () => {
  it('returns 429 when the rate-limit binding says so, and works without one', async () => {
    const limited = { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await handle(req('GET', `${BASE}/${'A'.repeat(22)}`), limited)).status).toBe(429);
    expect((await handle(req('GET', `${BASE}/${'A'.repeat(22)}`), env)).status).toBe(404);
  });
});
