// Service worker registration and update handling. Updates are never applied
// automatically: the user chooses when, and is warned if a form is unsaved.

type Listener = (waiting: ServiceWorker | null) => void;
let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();
let registration: ServiceWorkerRegistration | null = null;

function setWaiting(w: ServiceWorker | null) {
  waiting = w;
  listeners.forEach((l) => l(w));
}

export function onUpdateAvailable(l: Listener): () => void {
  listeners.add(l);
  l(waiting);
  return () => listeners.delete(l);
}

export function getRegistration() {
  return registration;
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(sw);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    // Check for updates periodically and when returning to the app.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}

export function applyUpdate() {
  waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export async function showSystemNotification(title: string, body: string, tag: string): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    if (registration) {
      await registration.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
    } else {
      new Notification(title, { body, tag });
    }
    return true;
  } catch {
    return false;
  }
}
