// Relay for My BP & Weight Tracker (Cloudflare Worker + KV).
//
// Everything stored here is either end-to-end encrypted in the patient's
// browser (doctor links, cloud backup) or contains no health data at all
// (push reminder times). Keys never reach this worker.
//
// Doctor links
//   POST   /v1/shares               create (app chooses the id: hash of the link secret)
//   PUT    /v1/shares/:id           update (Bearer token; one device at a time, 409 unless takeover)
//   GET    /v1/shares/:id           read   (X-Share-Proof when the link has a PIN)
//   GET    /v1/shares/:id/status    owner status: last viewed, views, PIN on/off (Bearer token)
//   DELETE /v1/shares/:id           stop sharing (Bearer token)
// Encrypted backup / sync ("vault")
//   GET    /v1/vault/:id            read   (X-Vault-Proof)
//   PUT    /v1/vault/:id            write  (X-Vault-Proof; baseVersion must match, else 409)
//   DELETE /v1/vault/:id            delete (X-Vault-Proof)
// Push reminders (no health data: only times and a time zone)
//   PUT    /v1/push/:id             subscribe / update schedule (Bearer token chosen by the app)
//   POST   /v1/push/:id/test        send one push now (Bearer token)
//   DELETE /v1/push/:id             unsubscribe (Bearer token)
//   cron (every 5 min)              sends a payload-less push at each scheduled time
//
// Environment: SHARES (KV), ALLOWED_ORIGINS, optional RATE_LIMITER (rate-limit
// binding), VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT for push.

export const MAX_BODY_BYTES = 2_000_000;
export const MAX_VAULT_BYTES = 10_000_000;
export const ALLOWED_DAYS = [7, 30, 90, 180, 365];
export const PIN_MAX_FAILS = 10;
export const PIN_LOCK_MS = 60 * 60_000;
export const VIEW_RECORD_MS = 15 * 60_000;
const VAULT_TTL_S = 400 * 86_400; // a backup untouched for 400 days expires
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const WRITER_RE = /^[A-Za-z0-9_-]{8,40}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const PROOF_RE = /^[A-Za-z0-9_-]{20,100}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
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
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
  return m ? m[1] : null;
}
async function readJson(request, max) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > max) return { error: 413 };
  const text = await request.text();
  if (text.length > max) return { error: 413 };
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? { body } : { error: 400 };
  } catch {
    return { error: 400 };
  }
}
function sealedOk(body) {
  return body.v === 1 && typeof body.iv === 'string' && typeof body.ct === 'string' && B64_RE.test(body.iv) && body.iv.length <= 32 && B64_RE.test(body.ct);
}

/** Optional Cloudflare rate-limit binding; requests are never blocked if it isn't configured. */
async function rateLimited(env, key) {
  if (!env.RATE_LIMITER) return false;
  try {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const originOk = !!origin && allowed.includes(origin);
  const cors = originOk
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Share-Proof, X-Share-Preview, X-Vault-Proof',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
  const json = (status, body, extra = {}) =>
    new Response(body == null ? null : JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra },
    });

  if (request.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });
  // Writes are only accepted from the app's own origin(s).
  if (request.method !== 'GET' && !originOk) return json(403, { error: 'Origin not allowed' });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await rateLimited(env, `ip:${ip}`)) return json(429, { error: 'Too many requests. Please wait a minute.' }, { 'Retry-After': '60' });

  let m;
  if ((m = url.pathname.match(/^\/v1\/shares(?:\/([^/]+))?(\/status)?\/?$/))) return shares(request, env, now, json, m[1], !!m[2]);
  if ((m = url.pathname.match(/^\/v1\/vault\/([^/]+)\/?$/))) return vault(request, env, now, json, m[1]);
  if ((m = url.pathname.match(/^\/v1\/push\/([^/]+?)(\/test)?\/?$/))) return push(request, env, now, json, m[1], !!m[2]);
  return json(404, { error: 'Not found' });
}

// ---------------------------------------------------------------- doctor links
async function shares(request, env, now, json, id, isStatus) {
  if (id !== undefined && !ID_RE.test(id)) return json(404, { error: 'Not found' });
  const load = async () => {
    const rec = await env.SHARES.get(`share:${id}`, 'json');
    return !rec || rec.expiresAt <= now ? null : rec;
  };
  const badBody = (b) => !sealedOk(b) || (b.writer !== undefined && (typeof b.writer !== 'string' || !WRITER_RE.test(b.writer))) || (b.readHash !== undefined && b.readHash !== null && !HEX64_RE.test(b.readHash));

  if (request.method === 'POST' && id === undefined) {
    const { body, error } = await readJson(request, MAX_BODY_BYTES);
    if (error) return json(error, { error: error === 413 ? 'Too large' : 'Bad request' });
    if (badBody(body) || (body.id !== undefined && (typeof body.id !== 'string' || !ID_RE.test(body.id)))) return json(400, { error: 'Bad request' });
    const days = ALLOWED_DAYS.includes(body.expiresInDays) ? body.expiresInDays : 90;
    const newId = body.id ?? randomToken(16);
    if (body.id !== undefined && (await env.SHARES.get(`share:${newId}`))) return json(409, { error: 'This link id is already in use.' });
    const token = randomToken(32);
    const rec = { iv: body.iv, ct: body.ct, updatedAt: now, expiresAt: now + days * 86_400_000, tokenHash: await sha256Hex(token), writer: body.writer ?? null, readHash: body.readHash ?? null };
    await env.SHARES.put(`share:${newId}`, JSON.stringify(rec), { expiration: Math.floor(rec.expiresAt / 1000) });
    return json(201, { id: newId, token, updatedAt: rec.updatedAt, expiresAt: rec.expiresAt });
  }
  if (id === undefined) return json(405, { error: 'Method not allowed' });

  if (request.method === 'GET' && !isStatus) {
    const rec = await load();
    if (!rec) return json(404, { error: 'This link has been turned off or has expired.' });
    if (rec.readHash) {
      const pinKey = `pin:${id}`;
      const fails = (await env.SHARES.get(pinKey, 'json')) || { count: 0, until: 0 };
      if (fails.until > now) return json(429, { error: 'Too many wrong PINs. Try again later.', code: 'pin-locked', retryAt: fails.until });
      const proof = request.headers.get('X-Share-Proof');
      if (!proof) return json(401, { error: 'This link needs a PIN.', code: 'pin-required' });
      if (!PROOF_RE.test(proof) || !sameString(await sha256Hex(proof), rec.readHash)) {
        const count = fails.count + 1;
        const next = count >= PIN_MAX_FAILS ? { count: 0, until: now + PIN_LOCK_MS } : { count, until: 0 };
        await env.SHARES.put(pinKey, JSON.stringify(next), { expiration: Math.floor(rec.expiresAt / 1000) });
        return json(403, { error: 'Wrong PIN.', code: 'pin-wrong', remaining: next.until ? 0 : PIN_MAX_FAILS - count });
      }
      if (fails.count) await env.SHARES.delete(pinKey);
    }
    // "Last viewed" (time only), kept apart from the data so a view can never overwrite an update.
    if (request.headers.get('X-Share-Preview') !== '1') {
      const viewKey = `view:${id}`;
      const v = (await env.SHARES.get(viewKey, 'json')) || { last: 0, views: 0 };
      if (now - v.last > VIEW_RECORD_MS) await env.SHARES.put(viewKey, JSON.stringify({ last: now, views: v.views + 1 }), { expiration: Math.floor(rec.expiresAt / 1000) });
    }
    return json(200, { v: 1, iv: rec.iv, ct: rec.ct, updatedAt: rec.updatedAt, expiresAt: rec.expiresAt });
  }

  const token = bearer(request);
  if (!token) return json(401, { error: 'Missing token' });
  const rec = await load();
  if (!rec) return json(404, { error: 'Not found' });
  if (!sameString(await sha256Hex(token), rec.tokenHash)) return json(403, { error: 'Wrong token' });

  if (request.method === 'GET' && isStatus) {
    const v = (await env.SHARES.get(`view:${id}`, 'json')) || { last: 0, views: 0 };
    return json(200, { updatedAt: rec.updatedAt, expiresAt: rec.expiresAt, lastViewedAt: v.last || null, views: v.views, pin: !!rec.readHash });
  }
  if (isStatus) return json(405, { error: 'Method not allowed' });
  if (request.method === 'DELETE') {
    await Promise.all([env.SHARES.delete(`share:${id}`), env.SHARES.delete(`view:${id}`), env.SHARES.delete(`pin:${id}`)]);
    return json(204, null);
  }
  if (request.method === 'PUT') {
    const { body, error } = await readJson(request, MAX_BODY_BYTES);
    if (error) return json(error, { error: error === 413 ? 'Too large' : 'Bad request' });
    if (badBody(body)) return json(400, { error: 'Bad request' });
    // One device at a time: a second device holding the same link (e.g. after
    // restoring a backup) must not overwrite newer data with older data.
    if (rec.writer && body.writer && body.writer !== rec.writer && body.takeover !== true) {
      return json(409, { error: 'Another device is updating this link.', code: 'other-device' });
    }
    const next = { ...rec, iv: body.iv, ct: body.ct, updatedAt: now, writer: body.writer ?? rec.writer ?? null, readHash: body.readHash === undefined ? rec.readHash ?? null : body.readHash };
    await env.SHARES.put(`share:${id}`, JSON.stringify(next), { expiration: Math.floor(rec.expiresAt / 1000) });
    if (next.readHash !== rec.readHash) await env.SHARES.delete(`pin:${id}`);
    return json(200, { id, updatedAt: next.updatedAt, expiresAt: next.expiresAt });
  }
  return json(405, { error: 'Method not allowed' });
}

// ------------------------------------------------------ encrypted backup / sync
async function vault(request, env, now, json, id) {
  if (!ID_RE.test(id)) return json(404, { error: 'Not found' });
  const proof = request.headers.get('X-Vault-Proof');
  if (!proof || !PROOF_RE.test(proof)) return json(401, { error: 'Missing proof' });
  const key = `vault:${id}`;
  const rec = await env.SHARES.get(key, 'json');
  const proofHash = await sha256Hex(proof);
  if (rec && !sameString(proofHash, rec.proofHash)) return json(403, { error: 'Wrong recovery key' });

  if (request.method === 'GET') {
    if (!rec) return json(404, { error: 'No cloud backup found for this recovery key.' });
    return json(200, { v: 1, iv: rec.iv, ct: rec.ct, version: rec.version, updatedAt: rec.updatedAt });
  }
  if (request.method === 'DELETE') {
    if (rec) await env.SHARES.delete(key);
    return json(204, null);
  }
  if (request.method === 'PUT') {
    const { body, error } = await readJson(request, MAX_VAULT_BYTES);
    if (error) return json(error, { error: error === 413 ? 'Too large' : 'Bad request' });
    if (!sealedOk(body) || !Number.isInteger(body.baseVersion)) return json(400, { error: 'Bad request' });
    const current = rec ? rec.version : 0;
    // Compare-and-swap: a device must have merged the latest copy before writing.
    if (body.baseVersion !== current) return json(409, { error: 'The cloud copy changed. Merge and try again.', code: 'conflict', version: current });
    const next = { iv: body.iv, ct: body.ct, version: current + 1, updatedAt: now, proofHash };
    await env.SHARES.put(key, JSON.stringify(next), { expirationTtl: VAULT_TTL_S });
    return json(200, { version: next.version, updatedAt: now });
  }
  return json(405, { error: 'Method not allowed' });
}

// --------------------------------------------------------------- push reminders
export function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return false;
  try {
    const u = new URL(sub.endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validSchedule(list) {
  return Array.isArray(list) && list.length <= 24 && list.every((x) => x && TIME_RE.test(x.t)
    && (x.d == null || (Array.isArray(x.d) && x.d.length > 0 && x.d.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)))
    && (x.n == null || (Number.isInteger(x.n) && x.n >= 2 && x.n <= 90 && DATE_RE.test(x.s)))
    && (x.u == null || DATE_RE.test(x.u)));
}

/** Compact form kept in KV metadata: "HH:MM[@days][~N~YYYYMMDD][!YYYYMMDD]". */
export function encodeEntry(x) {
  return `${x.t}${x.d ? `@${x.d.join('')}` : ''}${x.n ? `~${x.n}~${x.s.replace(/-/g, '')}` : ''}${x.u ? `!${x.u.replace(/-/g, '')}` : ''}`;
}

async function push(request, env, now, json, id, isTest = false) {
  if (!ID_RE.test(id)) return json(404, { error: 'Not found' });
  const token = bearer(request);
  if (!token) return json(401, { error: 'Missing token' });
  const key = `push:${id}`;
  const existing = await env.SHARES.getWithMetadata(key, 'json');
  const tokenHash = await sha256Hex(token);
  if (existing.value && !sameString(tokenHash, existing.value.tokenHash)) return json(403, { error: 'Wrong token' });
  if (request.method === 'DELETE') {
    await env.SHARES.delete(key);
    return json(204, null);
  }
  if (isTest) {
    if (request.method !== 'POST' || !existing.value) return json(404, { error: 'Not subscribed' });
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return json(503, { error: 'Push is not configured on the server.' });
    const res = await fetch(existing.value.endpoint, { method: 'POST', headers: { TTL: '600', Urgency: 'high', Authorization: await vapidHeader(env, existing.value.endpoint, now), 'Content-Length': '0' } });
    if (res.status === 404 || res.status === 410) {
      await env.SHARES.delete(key);
      return json(410, { error: 'This device is no longer subscribed. Turn reminders off and on again.' });
    }
    return res.ok ? json(200, { ok: true }) : json(502, { error: `The push service answered ${res.status}.` });
  }
  if (request.method !== 'PUT') return json(405, { error: 'Method not allowed' });
  const { body, error } = await readJson(request, 10_000);
  if (error) return json(error, { error: 'Bad request' });
  let tzOk = false;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: body.tz });
    tzOk = typeof body.tz === 'string';
  } catch {
    tzOk = false;
  }
  if (!validSubscription(body.subscription) || !tzOk || !validSchedule(body.schedule)) return json(400, { error: 'Bad request' });
  // The schedule lives in the key's metadata so the cron job needs one list call, not one read per device.
  const metadata = { tz: body.tz, s: body.schedule.map(encodeEntry) };
  await env.SHARES.put(key, JSON.stringify({ endpoint: body.subscription.endpoint, tokenHash, updatedAt: now }), { metadata, expirationTtl: 400 * 86_400 });
  return json(200, { ok: true });
}

function localNow(tz, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), day: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000 };
}
const dayNo = (yyyymmdd) => Date.UTC(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8))) / 86_400_000;

/** Is any scheduled time within the last 5 minutes (inclusive of now)? */
export function isDue(metadata, now) {
  if (!metadata || !Array.isArray(metadata.s)) return false;
  let local;
  try {
    local = localNow(metadata.tz, now);
  } catch {
    return false;
  }
  return metadata.s.some((entry) => {
    const m = String(entry).match(/^(\d{2}):(\d{2})(?:@(\d+))?(?:~(\d+)~(\d{8}))?(?:!(\d{8}))?$/);
    if (!m) return false;
    const diff = (local.minutes - (Number(m[1]) * 60 + Number(m[2])) + 1440) % 1440;
    if (diff > 4) return false;
    const crossed = diff > local.minutes; // scheduled just before midnight
    const weekday = crossed ? (local.weekday + 6) % 7 : local.weekday;
    const day = crossed ? local.day - 1 : local.day;
    if (m[3] && !m[3].includes(String(weekday))) return false;
    if (m[4] && ((day - dayNo(m[5])) < 0 || (day - dayNo(m[5])) % Number(m[4]) !== 0)) return false;
    if (m[6] && day > dayNo(m[6])) return false;
    return true;
  });
}

async function vapidHeader(env, endpoint, now) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const header = enc({ typ: 'JWT', alg: 'ES256' });
  const claims = enc({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://my-bp-weight-tracker.pages.dev' });
  const pub = fromB64url(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(new Uint8Array(sig))}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Cron: send an empty push to every device with a reminder due now. The app's service worker shows it. */
export async function sendDuePushes(env, now = Date.now(), fetcher = fetch) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { sent: 0, removed: 0 };
  let cursor;
  let sent = 0;
  let removed = 0;
  do {
    const page = await env.SHARES.list({ prefix: 'push:', cursor });
    for (const k of page.keys) {
      if (!isDue(k.metadata, now)) continue;
      const rec = await env.SHARES.get(k.name, 'json');
      if (!rec) continue;
      try {
        const res = await fetcher(rec.endpoint, { method: 'POST', headers: { TTL: '3600', Urgency: 'normal', Authorization: await vapidHeader(env, rec.endpoint, now), 'Content-Length': '0' } });
        if (res.status === 404 || res.status === 410) {
          await env.SHARES.delete(k.name);
          removed++;
        } else if (res.ok) sent++;
      } catch {
        /* try again next time */
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { sent, removed };
}

export default {
  fetch(request, env) {
    return handle(request, env).catch(() => new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDuePushes(env));
  },
};
