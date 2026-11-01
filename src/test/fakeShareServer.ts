// In-memory stand-in for the Cloudflare KV namespace, plus a fetch() that
// routes requests to the real share-worker code (as a browser would, with
// an Origin header).
// @ts-expect-error plain JS worker module
import { handle } from '../../share-worker/worker.js';

export class FakeKV {
  map = new Map<string, { value: string; expiration?: number; metadata?: unknown }>();
  async get(k: string, type?: 'json') {
    const e = this.map.get(k);
    if (!e) return null;
    return type === 'json' ? JSON.parse(e.value) : e.value;
  }
  async getWithMetadata(k: string, type?: 'json') {
    const e = this.map.get(k);
    return { value: e ? (type === 'json' ? JSON.parse(e.value) : e.value) : null, metadata: e?.metadata ?? null };
  }
  async put(k: string, value: string, opts?: { expiration?: number; expirationTtl?: number; metadata?: unknown }) {
    this.map.set(k, { value, expiration: opts?.expiration, metadata: opts?.metadata });
  }
  async delete(k: string) {
    this.map.delete(k);
  }
  async list({ prefix = '' }: { prefix?: string; cursor?: string } = {}) {
    const keys = [...this.map.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata ?? null }));
    return { keys, list_complete: true, cursor: undefined };
  }
}

export const TEST_ORIGIN = 'https://app.example';
export const TEST_API = 'https://share.example';

export function installFakeShareServer() {
  const env = { SHARES: new FakeKV(), ALLOWED_ORIGINS: TEST_ORIGIN };
  const calls: { method: string; url: string }[] = [];
  const original = globalThis.fetch;
  let offline = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline) throw new TypeError('Failed to fetch');
    const url = String(input);
    const headers = new Headers(init?.headers);
    headers.set('Origin', TEST_ORIGIN);
    calls.push({ method: init?.method ?? 'GET', url });
    return handle(new Request(url, { method: init?.method, headers, body: init?.body }), env);
  }) as typeof fetch;
  return {
    env,
    calls,
    setOffline(v: boolean) { offline = v; },
    restore() { globalThis.fetch = original; },
  };
}
