import { useEffect, useRef } from 'react';
import { useStore } from '../store/Store';
import { pushEnabledHere, pushSchedule, syncPush } from '../lib/push';

/** Keeps this device's reminder times on the reminder server in step with Settings and medicines. */
export function PushSync() {
  const { data, mode, locked, loading } = useStore();
  const active = mode === 'real' && !locked && !loading && pushEnabledHere();
  const key = JSON.stringify([data.settings.timeZone, active ? pushSchedule(data) : null]);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void syncPush(dataRef.current).catch(() => undefined), 2000);
    return () => clearTimeout(t);
  }, [active, key]);
  return null;
}
