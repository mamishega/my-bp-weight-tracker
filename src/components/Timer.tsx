import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** Optional countdown timer. Never blocks entry or editing. */
export function Timer({ seconds, label, doneText }: { seconds: number; label: string; doneText: string }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const endAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const remain = Math.max(0, Math.round(((endAt.current ?? 0) - Date.now()) / 1000));
      setLeft(remain);
      if (remain === 0) {
        setRunning(false);
        setDone(true);
        try {
          navigator.vibrate?.(300);
        } catch {
          /* ignore */
        }
      }
    }, 250);
    return () => clearInterval(t);
  }, [running]);

  const start = () => {
    endAt.current = Date.now() + left * 1000;
    setDone(false);
    setRunning(true);
  };
  const reset = () => {
    setRunning(false);
    setDone(false);
    setLeft(seconds);
  };
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-white p-2">
      <span className="font-medium">{label}</span>
      <span className="min-w-14 text-2xl font-bold tabular-nums" aria-hidden="true">{mm}:{ss}</span>
      <span className="sr-only">{running ? `${mm} minutes ${ss} seconds remaining` : ''}</span>
      {running ? (
        <Button onClick={() => { setRunning(false); }}>Pause</Button>
      ) : (
        <Button onClick={start}>{left === seconds ? 'Start' : 'Resume'}</Button>
      )}
      <Button variant="ghost" onClick={reset}>Reset</Button>
      <span role="status" className="w-full text-sm font-medium text-emerald-900">{done ? `✅ ${doneText}` : ''}</span>
    </div>
  );
}
