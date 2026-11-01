import { useEffect, useRef } from 'react';
import { useStore } from '../store/Store';
import { requestSync, shareAvailable } from '../lib/share';

/**
 * Keeps the doctor's live link current: a few seconds after records change
 * (and when the connection comes back), re-encrypts and uploads the snapshot.
 * Never runs in demo mode or while the passcode lock is closed.
 */
export function ShareSync() {
  const { data, mode, locked, loading } = useStore();
  const active = mode === 'real' && !locked && !loading && !!data.settings.share && shareAvailable();
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void requestSync(dataRef.current), 3000);
    return () => clearTimeout(t);
  }, [active, data]);

  useEffect(() => {
    if (!active) return;
    const kick = () => void requestSync(dataRef.current);
    const onVis = () => document.visibilityState === 'visible' && kick();
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active]);

  return null;
}
