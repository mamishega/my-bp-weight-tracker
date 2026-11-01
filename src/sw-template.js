/* My BP & Weight Tracker service worker. Generated at build time.
 * Precaches the app shell so the app opens offline after one successful load.
 * Health records live in IndexedDB and are never touched or sent anywhere by
 * this worker. */
const BUILD_ID = '__BUILD_ID__';
const CACHE = `bpt-shell-${BUILD_ID}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))),
  );
  // Do not skipWaiting automatically: the page asks the user first.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bpt-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // App shell: serve the cached version for this build (consistent with its assets).
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match('./').then((hit) => hit || fetch(req).catch(() => cache.match('./'))),
      ),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Reminders when the app is closed. Pushes carry no data: the reminder shown
// is looked up in a small list of generic reminder titles kept on this device.
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let title = 'Reminder from My BP & Weight';
      let body = 'Open the app to see what’s due.';
      let url = './';
      try {
        const cache = await caches.open('bpt-push-meta');
        const res = await cache.match(new URL('push-schedule.json', self.registration.scope).href);
        if (res) {
          const meta = await res.json();
          const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: meta.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
          const mins = Number(p.hour) * 60 + Number(p.minute);
          const due = (meta.items || []).filter((x) => {
            const [h, m] = x.t.split(':').map(Number);
            return (mins - (h * 60 + m) + 1440) % 1440 <= 6;
          });
          if (due.length === 1) ({ title, body, url } = due[0]);
          else if (due.length > 1) {
            title = due.map((x) => x.title).join(' · ');
            body = 'Open My BP & Weight to record them.';
            url = due[0].url;
          }
        }
      } catch (e) {
        /* fall back to the generic reminder */
      }
      await self.registration.showNotification(title, { body, tag: 'bpt-reminder', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url } });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(target).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
