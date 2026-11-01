import { useState } from 'react';
import { useStore } from '../store/Store';
import { Button, TextField, TypedConfirm, Notice } from './ui';
import { Logo, Icon } from './Icon';
import { UrgentHelp } from './safety';

/** Shown instead of the app while records are locked. Urgent guidance stays visible. */
export function LockScreen() {
  const { unlock, eraseLockedData, mode } = useStore();
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erase, setErase] = useState(false);
  const submit = async () => {
    if (!pass) return setErr('Enter your passcode.');
    setBusy(true);
    const ok = await unlock(pass);
    setBusy(false);
    if (!ok) {
      setErr('That passcode is not correct. Please try again.');
      setPass('');
    }
  };
  return (
    <div className="flex min-h-screen flex-col items-center bg-[var(--app-bg)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-bold tracking-tight text-slate-900">My BP &amp; Weight</p>
            <p className="text-sm text-slate-500">{mode === 'demo' ? 'Demo records' : 'Your records'} are locked</p>
          </div>
        </div>
        <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <h1 className="mb-1 flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900"><Icon name="shield" className="h-5 w-5 text-teal-700" /> Enter passcode</h1>
          <p className="mb-4 text-sm text-slate-600">Your records on this device are encrypted. Enter your passcode to open them.</p>
          <TextField label="Passcode" type="password" autoComplete="current-password" autoFocus value={pass} onChange={(e) => { setPass(e.target.value); setErr(null); }} error={err} />
          <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
        </form>
        <div className="mt-4"><UrgentHelp compact /></div>
        <details className="mt-4 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-teal-800">Forgotten your passcode?</summary>
          <div className="mt-2 flex flex-col gap-2">
            <Notice tone="warn">The passcode can’t be recovered or reset, and the records can’t be decrypted without it. You can restore from a backup file after erasing.</Notice>
            <Button variant="danger" onClick={() => setErase(true)}>Erase all records on this device…</Button>
          </div>
        </details>
      </div>
      <TypedConfirm open={erase} onClose={() => setErase(false)} onConfirm={async () => { setErase(false); await eraseLockedData(); }} title="Erase all locked records?" word="ERASE" confirmLabel="Erase everything">
        <p>This permanently deletes every record and setting stored in this browser. Backup files you saved elsewhere are not affected and can be restored afterwards in Settings.</p>
        <p className="mt-2">If you shared a live link with your doctor, it can’t be turned off from here (its key is locked too). It stops updating and stops working when it expires. Restoring a backup that has the link brings back the option to turn it off.</p>
      </TypedConfirm>
    </div>
  );
}
