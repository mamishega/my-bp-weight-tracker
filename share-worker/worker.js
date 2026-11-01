// Share relay for My BP & Weight Tracker (Cloudflare Worker + KV).
//
// It stores ONE encrypted blob per share link. Encryption happens in the
// patient's browser with a random key that lives only in the link's #fragment
// (never sent to any server), so this worker cannot read the health data.
//
//   POST   /v1/shares          create  -> { id, token, updatedAt, expiresAt }
//                              (the app may choose the id: it is derived from
//                              the link's secret so links can be short)
//   PUT    /v1/shares/:id      update  (Authorization: Bearer <token>). Only the
//                              device that last updated the link may update it
//                              (409), unless it sends takeover: true.
//   GET    /v1/shares/:id      read    -> { v, iv, ct, updatedAt, expiresAt }
//   DELETE /v1/shares/:id      stop sharing (Authorization: Bearer <token>)
//
// Environment: SHARES (KV namespace binding), ALLOWED_ORIGINS (comma-separated).

export const MAX_BODY_BYTES = 2_000_000;
export const ALLOWED_DAYS = [7, 30, 90, 180, 365];
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const WRITER_RE = /^[A-Za-z0-9_-]{8,40}$/;

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(n) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
  return m ? m[1] : null;
}

async function readBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY_BYTES) return { error: 413 };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: 413 };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: 400 };
  }
  if (!body || body.v !== 1 || typeof body.iv !== 'string' || typeof body.ct !== 'string') return { error: 400 };
  if (!B64_RE.test(body.iv) || body.iv.length > 32 || !B64_RE.test(body.ct)) return { error: 400 };
  if (body.writer !== undefined && (typeof body.writer !== 'string' || !WRITER_RE.test(body.writer))) return { error: 400 };
  if (body.id !== undefined && (typeof body.id !== 'string' || !ID_RE.test(body.id))) return { error: 400 };
  return { body };
}

export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const originOk = !!origin && allowed.includes(origin);
  const cors = originOk
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
  const json = (status, body) =>
    new Response(body == null ? null : JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
    });

  if (request.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });
  const m = url.pathname.match(/^\/v1\/shares(?:\/([^/]+))?\/?$/);
  if (!m) return json(404, { error: 'Not found' });
  const id = m[1];
  if (id !== undefined && !ID_RE.test(id)) return json(404, { error: 'Not found' });

  // Writes are only accepted from the app's own origin(s).
  if (request.method !== 'GET' && !originOk) return json(403, { error: 'Origin not allowed' });

  const load = async () => {
    const rec = await env.SHARES.get(`share:${id}`, 'json');
    if (!rec || rec.expiresAt <= now) return null;
    return rec;
  };

  if (request.method === 'POST' && id === undefined) {
    const { body, error } = await readBody(request);
    if (error) return json(error, { error: error === 413 ? 'Too large' : 'Bad request' });
    const days = ALLOWED_DAYS.includes(body.expiresInDays) ? body.expiresInDays : 90;
    const newId = body.id ?? randomToken(16);
    if (body.id !== undefined && (await env.SHARES.get(`share:${newId}`))) return json(409, { error: 'This link id is already in use.' });
    const token = randomToken(32);
    const rec = { iv: body.iv, ct: body.ct, updatedAt: now, expiresAt: now + days * 86_400_000, tokenHash: await sha256Hex(token), writer: body.writer ?? null };
    await env.SHARES.put(`share:${newId}`, JSON.stringify(rec), { expiration: Math.floor(rec.expiresAt / 1000) });
    return json(201, { id: newId, token, updatedAt: rec.updatedAt, expiresAt: rec.expiresAt });
  }

  if (id === undefined) return json(405, { error: 'Method not allowed' });

  if (request.method === 'GET') {
    const rec = await load();
    if (!rec) return json(404, { error: 'This link has been turned off or has expired.' });
    return json(200, { v: 1, iv: rec.iv, ct: rec.ct, updatedAt: rec.updatedAt, expiresAt: rec.expiresAt });
  }

  if (request.method === 'PUT' || request.method === 'DELETE') {
    const token = bearer(request);
    if (!token) return json(401, { error: 'Missing token' });
    const rec = await load();
    if (!rec) return json(404, { error: 'Not found' });
    if (!sameString(await sha256Hex(token), rec.tokenHash)) return json(403, { error: 'Wrong token' });
    if (request.method === 'DELETE') {
      await env.SHARES.delete(`share:${id}`);
      return json(204, null);
    }
    const { body, error } = await readBody(request);
    if (error) return json(error, { error: error === 413 ? 'Too large' : 'Bad request' });
    // One device at a time: a second device holding the same link (e.g. after
    // restoring a backup) must not overwrite newer data with older data.
    if (rec.writer && body.writer && body.writer !== rec.writer && body.takeover !== true) {
      return json(409, { error: 'Another device is updating this link.', code: 'other-device' });
    }
    const next = { ...rec, iv: body.iv, ct: body.ct, updatedAt: now, writer: body.writer ?? rec.writer ?? null };
    await env.SHARES.put(`share:${id}`, JSON.stringify(next), { expiration: Math.floor(rec.expiresAt / 1000) });
    return json(200, { id, updatedAt: next.updatedAt, expiresAt: next.expiresAt });
  }

  return json(405, { error: 'Method not allowed' });
}

export default {
  fetch(request, env) {
    return handle(request, env).catch(() => new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  },
};
