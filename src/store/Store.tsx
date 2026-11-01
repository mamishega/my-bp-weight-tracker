import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData, CollectionName, Collections, DataMode, Meta, Settings } from '../types';
import * as db from '../db/db';
import { emptyData } from '../lib/defaults';
import { buildDemoData } from '../lib/demo';
import { deviceTimeZone } from '../lib/time';

const MODE_KEY = 'bpt-data-mode';

export function readMode(): DataMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'real';
  } catch {
    return 'real';
  }
}

interface StoreValue {
  data: AppData;
  mode: DataMode;
  loading: boolean;
  error: string | null;
  put: <K extends CollectionName>(name: K, record: Collections[K]) => Promise<void>;
  putMany: <K extends CollectionName>(name: K, records: Collections[K][]) => Promise<void>;
  remove: (name: CollectionName, id: string) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  saveMeta: (m: Meta) => Promise<void>;
  replaceAll: (d: AppData) => Promise<void>;
  setMode: (m: DataMode) => Promise<void>;
  resetDemo: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children, initialMode }: { children: ReactNode; initialMode?: DataMode }) {
  const [mode, setModeState] = useState<DataMode>(initialMode ?? readMode());
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const load = useCallback(async (m: DataMode) => {
    try {
      let d = await db.loadAll(m);
      if (m === 'demo' && d.sessions.length === 0 && d.weights.length === 0) {
        d = buildDemoData(deviceTimeZone());
        await db.replaceAll('demo', d);
      }
      if (modeRef.current === m) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError(`Could not open browser storage: ${(e as Error).message}. Private browsing or blocked storage can cause this.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(mode);
  }, [mode, load]);

  // Keep several open tabs consistent.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('bpt-sync');
    ch.onmessage = (e) => {
      if (e.data?.mode === modeRef.current) void load(modeRef.current);
    };
    channel.current = ch;
    return () => ch.close();
  }, [load]);

  const notify = () => channel.current?.postMessage({ mode: modeRef.current });

  const put = useCallback(async <K extends CollectionName>(name: K, record: Collections[K]) => {
    await db.putRecord(modeRef.current, name, record);
    setData((d) => {
      const list = d[name] as Collections[K][];
      const i = list.findIndex((r) => (r as { id: string }).id === (record as { id: string }).id);
      const next = i >= 0 ? list.map((r, j) => (j === i ? record : r)) : [...list, record];
      return { ...d, [name]: next };
    });
    notify();
  }, []);

  const putMany = useCallback(async <K extends CollectionName>(name: K, records: Collections[K][]) => {
    await db.putRecords(modeRef.current, name, records);
    setData((d) => {
      const map = new Map((d[name] as Collections[K][]).map((r) => [(r as { id: string }).id, r]));
      for (const r of records) map.set((r as { id: string }).id, r);
      return { ...d, [name]: [...map.values()] };
    });
    notify();
  }, []);

  const remove = useCallback(async (name: CollectionName, id: string) => {
    await db.deleteRecord(modeRef.current, name, id);
    setData((d) => ({ ...d, [name]: (d[name] as { id: string }[]).filter((r) => r.id !== id) }));
    notify();
  }, []);

  const saveSettings = useCallback(async (s: Settings) => {
    const next = { ...s, updatedAt: new Date().toISOString() };
    await db.putKV(modeRef.current, next);
    setData((d) => ({ ...d, settings: next }));
    notify();
  }, []);

  const saveMeta = useCallback(async (m: Meta) => {
    await db.putKV(modeRef.current, m);
    setData((d) => ({ ...d, meta: m }));
    notify();
  }, []);

  const replaceAll = useCallback(async (d: AppData) => {
    await db.replaceAll(modeRef.current, d);
    setData(d);
    notify();
  }, []);

  const setMode = useCallback(async (m: DataMode) => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
    setData(emptyData());
    setModeState(m);
  }, []);

  const resetDemo = useCallback(async () => {
    if (modeRef.current !== 'demo') return;
    const d = buildDemoData(deviceTimeZone());
    await db.replaceAll('demo', d);
    setData(d);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({ data, mode, loading, error, put, putMany, remove, saveSettings, saveMeta, replaceAll, setMode, resetDemo, reload: () => load(modeRef.current) }),
    [data, mode, loading, error, put, putMany, remove, saveSettings, saveMeta, replaceAll, setMode, resetDemo, load],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
