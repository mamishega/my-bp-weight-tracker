// Read-only view a doctor sees when opening a live share link. It never
// touches the viewer's own app storage: the snapshot is fetched, decrypted
// in memory with the key from the link's #fragment, and refreshed regularly.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ISODate, SessionType } from '../types';
import { Button, Notice, TextField } from '../components/ui';
import { Logo } from '../components/Icon';
import { BPChart, WeightChart } from '../components/Charts';
import { DoctorDashboard } from '../components/DoctorDashboard';
import { ReportBody } from './Report';
import { ShareDecryptError, ShareHttpError, fetchShared, relativeTime, resolveShareId, shareApiBase, type ParsedShareLink, type ShareSnapshot } from '../lib/share';
import { addDays } from '../lib/time';

const REFRESH_MS = 60_000;
const ALL: Record<SessionType, boolean> = { morning_pre: true, morning_post: true, evening: true };

type State =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string; retry: boolean }
  | { kind: 'pin'; message: string | null; locked: boolean }
  | { kind: 'ready'; snapshot: ShareSnapshot; updatedAt: number; expiresAt: number; fetchedAt: number; refreshError: boolean };

export function SharedView({ link }: { link: ParsedShareLink }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [days, setDays] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  const pinKey = `bpt-share-pin:${link.key}`;
  const pinRef = useRef<string | null>((() => {
    try {
      return sessionStorage.getItem(pinKey);
    } catch {
      return null;
    }
  })());

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!shareApiBase()) throw new ShareHttpError(0, 'not configured');
      const id = await resolveShareId(link);
      const r = await fetchShared(id, link.key, { pin: pinRef.current, preview: link.preview });
      setState({ kind: 'ready', ...r, fetchedAt: Date.now(), refreshError: false });
    } catch (e) {
      if (e instanceof ShareHttpError && (e.code === 'pin-required' || e.code === 'pin-wrong' || e.code === 'pin-locked')) {
        const hadPin = !!pinRef.current;
        pinRef.current = null;
        try {
          sessionStorage.removeItem(pinKey);
        } catch {
          /* ignore */
        }
        const message = e.code === 'pin-locked'
          ? `Too many wrong PINs. Try again after ${new Date(e.info.retryAt ?? Date.now()).toLocaleTimeString('en-AU', { timeStyle: 'short' })}.`
          : e.code === 'pin-wrong'
            ? `That PIN isn’t right.${e.info.remaining != null ? ` ${e.info.remaining} ${e.info.remaining === 1 ? 'try' : 'tries'} left before the link locks for an hour.` : ''}`
            : hadPin ? 'The PIN for this link has changed. Ask the patient for the new PIN.' : null;
        setState({ kind: 'pin', message, locked: e.code === 'pin-locked' });
        return;
      }
      setState((prev) => {
        if (prev.kind === 'ready' && !(e instanceof ShareHttpError && e.status === 404)) return { ...prev, refreshError: true };
        if (e instanceof ShareHttpError && e.status === 404) return { kind: 'error', title: 'This link has been turned off or has expired', detail: 'Ask the patient to send a new link.', retry: false };
        if (e instanceof ShareHttpError && e.status === 0) return { kind: 'error', title: 'Sharing isn’t available on this copy of the app', detail: 'The link may have been made with a different version of the app.', retry: false };
        if (e instanceof ShareHttpError) return { kind: 'error', title: 'The share server had a problem', detail: e.message, retry: true };
        if (e instanceof ShareDecryptError) return { kind: 'error', title: 'This link is incomplete or damaged', detail: 'Check that the whole link was copied, including everything after the # sign.', retry: false };
        return { kind: 'error', title: 'Couldn’t load the shared records', detail: 'Check your internet connection and try again.', retry: true };
      });
    } finally {
      busy.current = false;
    }
  }, [link, pinKey]);

  const submitPin = (pin: string) => {
    pinRef.current = pin;
    try {
      sessionStorage.setItem(pinKey, pin);
    } catch {
      /* ignore */
    }
    setState({ kind: 'loading' });
    void load();
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
    };
  }, [load]);

  useEffect(() => {
    document.title = 'Shared BP & weight records (read-only)';
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 sm:px-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        {state.kind === 'loading' && <p role="status" className="p-10 text-center text-slate-600">Loading shared records…</p>}
        {state.kind === 'error' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-600"><Logo className="h-7 w-7" /> My BP &amp; Weight Tracker</div>
            <h1 className="mb-3 text-xl font-bold">Shared records</h1>
            <Notice tone="warn" role="alert" title={state.title}>{state.detail}</Notice>
            {state.retry && <div className="mt-3"><Button icon="refresh" onClick={() => void load()}>Try again</Button></div>}
          </div>
        )}
        {state.kind === 'pin' && <PinPrompt message={state.message} locked={state.locked} onSubmit={submitPin} />}
        {state.kind === 'ready' && <Ready state={state} days={days} setDays={setDays} now={now} onRefresh={() => void load()} />}
      </div>
    </main>
  );
}

function PinPrompt({ message, locked, onSubmit }: { message: string | null; locked: boolean; onSubmit: (pin: string) => void }) {
  const [pin, setPin] = useState('');
  const valid = /^\d{4,8}$/.test(pin);
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-600"><Logo className="h-7 w-7" /> My BP &amp; Weight Tracker</div>
      <h1 className="mb-2 text-xl font-bold">Enter the PIN</h1>
      <p className="mb-4 text-slate-700">The patient protected these records with a PIN. They should have told you it separately from the link.</p>
      {message && <div className="mb-4"><Notice tone="warn" role="alert">{message}</Notice></div>}
      <form onSubmit={(e) => { e.preventDefault(); if (valid && !locked) onSubmit(pin); }} className="flex flex-col gap-3">
        <TextField label="PIN" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} hint="4 to 8 digits" disabled={locked} />
        <Button variant="primary" type="submit" disabled={!valid || locked}>Open records</Button>
      </form>
    </div>
  );
}

function Ready({ state, days, setDays, now, onRefresh }: { state: Extract<State, { kind: 'ready' }>; days: number | null; setDays: (d: number | null) => void; now: number; onRefresh: () => void }) {
  const { snapshot: snap, updatedAt } = state;
  const d = snap.data;
  const windowDays = snap.options.windowDays;
  const choices = [7, 14, 30, 90, 180].filter((n) => n < windowDays);
  const to: ISODate = snap.to;
  const from: ISODate = days ? addDays(to, -(days - 1)) : snap.from;
  const opt = (k: string, def = true) => {
    const v = (snap.options as unknown as Record<string, unknown>)[k];
    return typeof v === 'boolean' ? v : def;
  };
  const updated = new Date(updatedAt);
  const stale = now - updatedAt > 3 * 86_400_000;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800">Read-only live link · updates automatically</p>
          <div className="flex flex-wrap gap-2">
            <Button icon="refresh" onClick={onRefresh}>Refresh</Button>
            <Button icon="printer" onClick={() => print()}>Print / Save as PDF</Button>
          </div>
        </div>
        <p className="text-sm text-slate-700">
          Last updated by the patient <strong>{relativeTime(updatedAt, now)}</strong> ({updated.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}). This page checks for new records every minute.
        </p>
        {state.refreshError && <Notice tone="warn" role="status">Couldn’t check for newer records just now. Showing the last version loaded.</Notice>}
        {stale && <Notice tone="info">No update for more than 3 days. The patient may not have opened the app recently, so newer readings may not be included yet.</Notice>}
        <div role="group" aria-label="Time period" className="flex flex-wrap gap-2">
          {choices.map((n) => (
            <Button key={n} variant={days === n ? 'primary' : 'secondary'} aria-pressed={days === n} onClick={() => setDays(n)}>Last {n} days</Button>
          ))}
          <Button variant={days === null ? 'primary' : 'secondary'} aria-pressed={days === null} onClick={() => setDays(null)}>All shared ({windowDays} days)</Button>
        </div>
        <p className="text-xs text-slate-600">Home-recorded by the patient. Not monitored: no one is alerted to new readings. For emergencies call 000.</p>
      </div>
      <article className="rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <ReportBody
          data={d}
          from={from}
          to={to}
          today={to}
          opt={opt}
          patientName={snap.options.displayName}
          preparedNote={<>Live shared link, last updated {updated.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</>}
          charts={
            <>
            <DoctorDashboard data={d} from={from} to={to} showSymptoms={opt('symptoms')} />
            <section aria-label="Charts" className="mt-6 flex flex-col gap-6 break-inside-avoid">
              <BPChart sessions={d.sessions.filter((s) => s.date >= from && s.date <= to)} measure="systolic" from={from} to={to} target={d.settings.targets.systolic} visible={ALL} targetLabel="Patient’s target" />
              <BPChart sessions={d.sessions.filter((s) => s.date >= from && s.date <= to)} measure="diastolic" from={from} to={to} target={d.settings.targets.diastolic} visible={ALL} targetLabel="Patient’s target" />
              <WeightChart weights={d.weights} from={from} to={to} unit={d.settings.weightUnit} goalKg={d.settings.weightGoal.goalKg} />
            </section>
            </>
          }
        />
      </article>
    </>
  );
}
