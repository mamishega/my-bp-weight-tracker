// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error plain JS worker module
import { handle, MAX_BODY_BYTES } from '../../share-worker/worker.js';
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
