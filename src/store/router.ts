// Tiny hash router with an unsaved-changes guard. If a form has unsaved
// changes, in-app navigation (links, back button, navigate()) is held until
// the user chooses to stay or leave.
import { useEffect, useState } from 'react';
import { hasUnsavedForm } from './dirty';

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '') || '/';
  const [path, q] = h.split('?');
  return { path: path || '/', params: new URLSearchParams(q ?? '') };
}

let currentHash = typeof window !== 'undefined' ? window.location.hash : '';
let pendingHash: string | null = null;
let bypass = false;
const routeListeners = new Set<() => void>();
const guardListeners = new Set<(pending: string | null) => void>();

function emitRoute() {
  routeListeners.forEach((l) => l());
}
function emitGuard() {
  guardListeners.forEach((l) => l(pendingHash));
}

function onHashChange() {
  const next = window.location.hash;
  if (next === currentHash) return;
  if (!bypass && hasUnsavedForm()) {
    // Put the address back without adding history, and ask the user.
    pendingHash = next;
    history.replaceState(history.state, '', currentHash || '#/');
    emitGuard();
    return;
  }
  bypass = false;
  currentHash = next;
  emitRoute();
}

if (typeof window !== 'undefined') window.addEventListener('hashchange', onHashChange);

export function useRoute(): Route {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    routeListeners.add(l);
    return () => {
      routeListeners.delete(l);
    };
  }, []);
  // The route only ever changes inside the hashchange handler, so the
  // unsaved-changes guard cannot be bypassed by a re-render racing the event.
  return parseHash(currentHash);
}

export function navigate(href: string) {
  window.location.hash = href.replace(/^#/, '');
}

/** Subscribe to blocked navigations (for the "unsaved changes" dialog). */
export function onBlockedNavigation(l: (pending: string | null) => void): () => void {
  guardListeners.add(l);
  return () => guardListeners.delete(l);
}

export function confirmLeave() {
  const target = pendingHash;
  pendingHash = null;
  emitGuard();
  if (target == null) return;
  bypass = true;
  window.location.hash = target.replace(/^#/, '');
}

export function cancelLeave() {
  pendingHash = null;
  emitGuard();
}

/** Let the next navigation through even if a form is dirty (used right after
 * a successful save or delete, before React has cleared the dirty flag). */
export function allowNextNavigation() {
  bypass = true;
  setTimeout(() => { bypass = false; }, 1000);
}
