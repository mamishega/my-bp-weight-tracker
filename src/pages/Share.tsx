import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store/Store';
import type { ShareConfig, ShareOptions } from '../types';
import { Badge, Button, Card, Checkbox, Modal, Notice, PageTitle, SelectField, TextField, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { DEFAULT_SHARE_OPTIONS, SHARE_EXPIRY_DAYS, SHARE_WINDOWS, buildShareLink, createShare, deleteShare, getSyncStatus, relativeTime, requestSync, shareAvailable, subscribeSync, type SyncStatus } from '../lib/share';

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function OptionsForm({ value, onChange }: { value: ShareOptions; onChange: (o: ShareOptions) => void }) {
  const set = (p: Partial<ShareOptions>) => onChange({ ...value, ...p });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Time period shown" hint="A rolling window that moves forward as you add records." value={String(value.windowDays)} onChange={(e) => set({ windowDays: Number(e.target.value) })}>
          {SHARE_WINDOWS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </SelectField>
        <TextField label="Name shown to your doctor" optional hint="Leave blank to show no name." value={value.displayName} maxLength={80} autoComplete="name" onChange={(e) => set({ displayName: e.target.value })} />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-slate-800">Always included: readings, medication records, weight, personal targets and your next appointment date.</legend>
        <p className="mb-2 text-sm text-slate-600">Also include:</p>
        <div className="grid gap-1 sm:grid-cols-2">
          <Checkbox label="Notes on readings" checked={value.sessionNotes} onChange={(v) => set({ sessionNotes: v })} />
          <Checkbox label="Symptoms diary" checked={value.symptoms} onChange={(v) => set({ symptoms: v })} />
          <Checkbox label="Lifestyle notes" checked={value.lifestyle} onChange={(v) => set({ lifestyle: v })} />
          <Checkbox label="Medication dose notes" checked={value.doseNotes} onChange={(v) => set({ doseNotes: v })} />
          <Checkbox label="Weight notes" checked={value.weightNotes} onChange={(v) => set({ weightNotes: v })} />
          <Checkbox label="My open questions for the doctor" checked={value.questions} onChange={(v) => set({ questions: v })} />
          <Checkbox label="Missing data and measurement quality notes" checked={value.quality} onChange={(v) => set({ quality: v })} />
        </div>
      </fieldset>
    </div>
  );
}

function StatusLine({ s, now }: { s: SyncStatus; now: number }) {
  if (s.state === 'uploading') return <Badge tone="info" icon="refresh">Updating link…</Badge>;
  if (s.state === 'offline') return <Badge tone="warn" icon="wifiOff">{s.message ?? 'Waiting for a connection'}</Badge>;
  if (s.state === 'error') return <Badge tone="danger" icon="alert">Last update failed: {s.message}</Badge>;
  if (s.state === 'gone') return <Badge tone="danger" icon="xCircle">{s.message}</Badge>;
  if (s.lastUploadedAt) return <Badge tone="ok" icon="checkCircle">Link up to date · updated {relativeTime(s.lastUploadedAt, now)}</Badge>;
  return <Badge tone="neutral" icon="clock">Not uploaded yet</Badge>;
}

function ActiveShare({ cfg }: { cfg: ShareConfig }) {
  const { data, saveSettings } = useStore();
  const toast = useToast();
  const now = useNow();
  const status = useSyncExternalStore(subscribeSync, () => getSyncStatus(cfg.id));
  const [opts, setOpts] = useState(cfg.options);
  const [confirm, setConfirm] = useState<null | 'stop' | 'renew'>(null);
  const [busy, setBusy] = useState(false);
  const link = buildShareLink(cfg.id, cfg.key);
  const expires = new Date(cfg.expiresAt);
  const expired = expires.getTime() <= now;
  const changed = JSON.stringify(opts) !== JSON.stringify(cfg.options);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied. Paste it into a message or email to your doctor.');
    } catch {
      toast('Couldn’t copy automatically. Select the link and copy it.', 'warn');
    }
  };
  const shareNative = async () => {
    try {
      await navigator.share({ title: 'My blood pressure & weight records', text: 'My home blood pressure and weight records (read-only, updates automatically):', url: link });
    } catch {
      /* cancelled */
    }
  };
  const saveOpts = async () => {
    await saveSettings({ ...data.settings, share: { ...cfg, options: opts } });
    toast('Saved. The link will update in a few seconds.');
  };
  const stop = async (thenRenew: boolean) => {
    setBusy(true);
    try {
      await deleteShare(cfg);
      if (thenRenew) {
        const span = Math.round((Date.parse(cfg.expiresAt) - Date.parse(cfg.createdAt)) / 86_400_000);
        const next = await createShare(data, cfg.options, SHARE_EXPIRY_DAYS.find((d) => d >= span) ?? 90);
        await saveSettings({ ...data.settings, share: next });
        toast('New link created. The old link no longer works.');
      } else {
        await saveSettings({ ...data.settings, share: null });
        toast('Sharing turned off. The link no longer works.', 'info');
      }
      setConfirm(null);
    } catch (e) {
      toast(`Couldn’t reach the share server: ${(e as Error).message}. Check your connection and try again.`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Your live link" subtitle="Anyone with this link can view the records below. Send it only to your doctor." icon="link">
        <div className="flex flex-col gap-3">
          <label htmlFor="share-link" className="text-sm font-semibold text-slate-800">Link</label>
          <input id="share-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800" />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="copy" onClick={copy}>Copy link</Button>
            {typeof navigator !== 'undefined' && 'share' in navigator && <Button icon="share" onClick={shareNative}>Share…</Button>}
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-medium text-slate-800 no-underline hover:bg-slate-50">
              <Icon name="file" className="h-4 w-4" /> Preview what your doctor sees<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <StatusLine s={status} now={now} />
            <Button icon="refresh" disabled={status.state === 'uploading' || expired} onClick={() => void requestSync(data, { force: true })}>Update now</Button>
          </div>
          {expired ? (
            <Notice tone="warn" title="This link has expired">Create a new link to keep sharing.</Notice>
          ) : (
            <p className="text-sm text-slate-600">Expires {expires.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}. The link updates automatically a few seconds after you add or change a record, whenever you’re online.</p>
          )}
        </div>
      </Card>

      <Card title="What the link shows" icon="sliders">
        <OptionsForm value={opts} onChange={setOpts} />
        <div className="mt-4 flex gap-2">
          <Button variant="primary" disabled={!changed} onClick={saveOpts}>Save changes</Button>
          {changed && <Button onClick={() => setOpts(cfg.options)}>Undo</Button>}
        </div>
      </Card>

      <Card title="Stop or replace the link" icon="shield" iconTone="slate">
        <p className="text-sm text-slate-700">Turning sharing off deletes the copy on the share server straight away, so the link stops working. Creating a new link does the same and gives you a fresh one, for example if you sent the link to the wrong person.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="danger" icon="xCircle" onClick={() => setConfirm('stop')}>Turn off sharing</Button>
          <Button icon="refresh" onClick={() => setConfirm('renew')}>Replace with a new link</Button>
        </div>
      </Card>

      <Modal open={confirm !== null} onClose={() => !busy && setConfirm(null)} title={confirm === 'renew' ? 'Replace the link?' : 'Turn off sharing?'} footer={<>
        <Button disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
        <Button variant={confirm === 'renew' ? 'primary' : 'danger'} disabled={busy} onClick={() => void stop(confirm === 'renew')}>{busy ? 'Working…' : confirm === 'renew' ? 'Create new link' : 'Turn off sharing'}</Button>
      </>}>
        <p>The current link will stop working for anyone who has it.{confirm === 'renew' && ' You’ll need to send the new link to your doctor.'} Your records on this device are not affected.</p>
      </Modal>
    </>
  );
}

function CreateShare() {
  const { data, saveSettings } = useStore();
  const toast = useToast();
  const [opts, setOpts] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const cfg = await createShare(data, opts, days);
      await saveSettings({ ...data.settings, share: cfg });
      toast('Live link created. Copy it and send it to your doctor.');
    } catch (e) {
      setError(`Couldn’t create the link: ${(e as Error).message}. Check your internet connection and try again.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Create a live link" subtitle="Your doctor opens it in any web browser. No app or account needed." icon="link">
      <OptionsForm value={opts} onChange={setOpts} />
      <div className="mt-4 max-w-xs">
        <SelectField label="Link stops working after" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {SHARE_EXPIRY_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
        </SelectField>
      </div>
      {error && <div className="mt-3"><Notice tone="danger" role="alert">{error}</Notice></div>}
      <div className="mt-4">
        <Button variant="primary" icon="link" disabled={busy} onClick={create}>{busy ? 'Creating link…' : 'Create link'}</Button>
      </div>
    </Card>
  );
}

export function SharePage() {
  const { data, mode } = useStore();
  const cfg = data.settings.share;
  return (
    <div className="flex flex-col gap-5">
      <PageTitle sub="A private, read-only link that always shows your latest records.">Share with my doctor</PageTitle>
      <Notice tone="info" title="How it works" icon="shield">
        <ul className="list-disc pl-5">
          <li>Your records are <strong>encrypted on this device</strong> before upload. The key to unlock them is only in the link, so the share server can’t read them.</li>
          <li>When you add or change a record, the same link shows the update within a minute. Your doctor doesn’t need a new link.</li>
          <li>Anyone you give the link to can see the shared records, so send it only to your doctor. You can turn it off at any time.</li>
          <li>This is not monitoring. Your doctor won’t be alerted to new readings. <strong>For urgent symptoms call Triple Zero (000).</strong></li>
        </ul>
      </Notice>
      {mode === 'demo' ? (
        <Notice tone="demo" title="Sharing is off in demo mode">Sample data can’t be shared. Switch back to your own records in Settings to create a link.</Notice>
      ) : !shareAvailable() ? (
        <Notice tone="warn" title="Sharing isn’t set up for this copy of the app">Live links need the small share server described in the app’s README (“Doctor share link”). Until it’s set up, use <a href="#/history">History &amp; Reports</a> to print or save a PDF report.</Notice>
      ) : cfg ? (
        <ActiveShare key={cfg.id} cfg={cfg} />
      ) : (
        <CreateShare />
      )}
    </div>
  );
}
