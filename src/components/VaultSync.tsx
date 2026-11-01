import { useEffect, useRef } from 'react';
import { useStore } from '../store/Store';
import { changedSinceSync, syncVault } from '../lib/vault';
import { shareAvailable } from '../lib/share';

/**
 * Keeps this device and the encrypted cloud copy in step: a few seconds after
 * local changes, when the app is opened or comes back online, and every two
 * minutes while it's visible (to pick up changes from other devices).
 */
export function VaultSync() {
  const { data, mode, locked, loading, applySync } = useStore();
  const active = mode === 'real' && !locked && !loading && !!data.settings.vault && shareAvailable();
  const dataRef = useRef(data);
  dataRef.current = data;
  const run = useRef(() => {});
  run.current = () => void syncVault(() => dataRef.current, (d) => applySync(d));

  useEffect(() => {
    if (!active || !changedSinceSync(data)) return;
    const t = setTimeout(() => run.current(), 4000);
    return () => clearTimeout(t);
  }, [active, data]);

  useEffect(() => {
    if (!active) return;
    run.current();
    const onVis = () => document.visibilityState === 'visible' && run.current();
    const t = setInterval(() => document.visibilityState === 'visible' && run.current(), 120_000);
    window.addEventListener('online', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', onVis);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active]);
  return null;
}
