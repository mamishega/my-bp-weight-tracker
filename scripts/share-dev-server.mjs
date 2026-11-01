// Local stand-in for the Cloudflare share relay: runs share-worker/worker.js
// in Node with an in-memory KV. For development and testing only.
//   npm run share:dev            (listens on http://localhost:8787)
//   VITE_SHARE_API_URL=http://localhost:8787 npm run dev
import { createServer } from 'node:http';
import { handle } from '../share-worker/worker.js';

const PORT = Number(process.env.PORT || 8787);
const store = new Map();
const env = {
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173,http://127.0.0.1:4173',
  SHARES: {
    async get(k, type) {
      const e = store.get(k);
      if (!e || (e.expiration && e.expiration * 1000 <= Date.now())) return null;
      return type === 'json' ? JSON.parse(e.value) : e.value;
    },
    async put(k, value, opts = {}) {
      store.set(k, { value, expiration: opts.expiration });
    },
    async delete(k) {
      store.delete(k);
    },
  },
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const out = await handle(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, () => console.log(`Share dev server on http://localhost:${PORT} (allowed: ${env.ALLOWED_ORIGINS})`));
