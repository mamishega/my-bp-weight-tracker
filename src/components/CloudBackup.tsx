import { useState, useSyncExternalStore } from 'react';
import { useStore } from '../store/Store';
import { COLLECTIONS, type AppData } from '../types';
import { emptyData } from '../lib/defaults';
import { Badge, Button, Card, Checkbox, Modal, Notice, TextField, TypedConfirm, useToast } from './ui';
import { saveFile } from '../lib/files';
import { relativeTime, shareAvailable } from '../lib/share';
import { VaultKeyError, deleteRemote, fetchRemote, formatRecoveryKey, generateRecoveryKey, getVaultStatus, joinData, normaliseRecoveryKey, subscribeVault, syncVault, type Remote } from '../lib/vault';

function KeyBox({ k }: { k: string }) {
  const toast = useToast();
  const text = formatRecoveryKey(k);
  return (
    <div className="flex flex-col gap-2">
      <p className="break-all rounded-lg bg-slate-900 px-4 py-3 text-center font-mono text-lg font-semibold tracking-wider text-white" aria-label={`Recovery key: ${text.split('').join(' ')}`}>{text}</p>
      <div className="flex flex-wrap gap-2">
        <Button icon="copy" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Recovery key copied. Paste it somewhere safe, such as a password manager.'); } catch { toast('Couldn’t copy. Write the key down instead.', 'warn'); } }}>Copy</Button>
        <Button icon="download" onClick={async () => { const r = await saveFile('bp-tracker-recovery-key.txt', `My BP & Weight Tracker — cloud backup recovery key\n\n${text}\n\nKeep this private. Anyone with this key and an internet connection can open your cloud backup.\n`, 'text/plain'); if (r.status === 'failed') toast(`Couldn’t save: ${r.error}`, 'danger'); }}>Save as a file</Button>
      </div>
    </div>
  );
}

const count = (d: Pick<AppData, 'sessions' | 'doses' | 'weights'>) => `${d.sessions.length} reading sessions, ${d.doses.length} dose records, ${d.weights.length} weights`;

export function CloudBackupCard() {
  const { data, mode, saveSettings, replaceAll, applySync } = useStore();
  const toast = useToast();
  const status = useSyncExternalStore(subscribeVault, getVaultStatus);
  const cfg = data.settings.vault;
  const [flow, setFlow] = useState<null | 'new' | 'join' | 'delete' | 'off'>(null);
  const [newKey, setNewKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [input, setInput] = useState('');
  const [found, setFound] = useState<{ key: string; remote: Remote } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  if (mode === 'demo' || !shareAvailable()) return null;
  const close = () => { setFlow(null); setError(null); setFound(null); setInput(''); setSaved(false); setBusy(false); };
  const syncNow = () => syncVault(() => data, (d) => applySync(d));

  const startNew = () => { setNewKey(generateRecoveryKey()); setFlow('new'); };
  const confirmNew = async () => {
    setBusy(true);
    await saveSettings({ ...data.settings, vault: { key: newKey, enabledAt: new Date().toISOString() } });
    toast('Cloud backup is on. Your records are being encrypted and uploaded.');
    close();
  };
  const lookUp = async () => {
    setError(null);
    const k = normaliseRecoveryKey(input);
    if (!k) return setError('That isn’t a complete recovery key. It has 32 letters and numbers, e.g. ABCD-EFGH-….');
    setBusy(true);
    try {
      const remote = await fetchRemote(k);
      if (!remote) setError('No cloud backup was found for this recovery key. Check it was typed correctly.');
      else setFound({ key: k, remote });
    } catch (e) {
      setError(e instanceof VaultKeyError ? e.message : `Couldn’t reach the cloud backup: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const join = async (how: 'merge' | 'replace') => {
    if (!found) return;
    setBusy(true);
    const vault = { key: found.key, enabledAt: new Date().toISOString() };
    const p = found.remote.payload;
    const next: AppData = how === 'merge'
      ? joinData(data, p, vault)
      : { ...emptyData(), ...(p.data as Omit<AppData, 'meta'>), ...Object.fromEntries(COLLECTIONS.map((c) => [c, (p.data as Partial<AppData>)[c] ?? []])), settings: { ...p.data.settings, vault, notificationsEnabled: data.settings.notificationsEnabled }, meta: { ...data.meta, tombstones: p.tombstones } };
    await replaceAll(next);
    toast(how === 'merge' ? 'Connected. Records from both are now combined and kept in step.' : 'Connected. This device now has the records from your cloud backup.');
    close();
  };
  const turnOff = async () => {
    await saveSettings({ ...data.settings, vault: null });
    toast('Cloud sync is off on this device. The cloud copy is kept.', 'info');
    close();
  };
  const deleteCloud = async () => {
    if (!cfg) return;
    try {
      await deleteRemote(cfg.key);
      await saveSettings({ ...data.settings, vault: null });
      toast('Cloud backup deleted. Records on this device are not affected.', 'info');
    } catch (e) {
      toast(`Couldn’t delete the cloud backup: ${(e as Error).message}`, 'danger');
    }
    close();
  };

  return (
    <Card title="Cloud backup and sync" subtitle="Encrypted on this device — the server can’t read it" icon="refresh" iconTone="teal">
      {!cfg ? (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
            <li>Keeps an <strong>encrypted copy</strong> of all your records online, updated automatically, so a lost phone or cleared browser doesn’t lose them.</li>
            <li>Use the same records on your phone and computer: they stay in step within a couple of minutes.</li>
            <li>You get a <strong>recovery key</strong>. Only the key can open the backup. Nobody else can, including the app’s developer, and a lost key can’t be replaced.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon="shield" onClick={startNew}>Turn on cloud backup</Button>
            <Button icon="smartphone" onClick={() => setFlow('join')}>I have a recovery key</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            {status.state === 'syncing' ? <Badge tone="info" icon="refresh">Syncing…</Badge>
              : status.state === 'error' ? <Badge tone="danger" icon="alert">{status.message}</Badge>
              : status.state === 'offline' ? <Badge tone="warn" icon="wifiOff">{status.message}</Badge>
              : status.lastSyncAt ? <Badge tone="ok" icon="checkCircle">Backed up and in sync · {relativeTime(status.lastSyncAt)}</Badge>
              : <Badge>Waiting to sync</Badge>}
            <Button className="min-h-10 text-sm" icon="refresh" disabled={status.state === 'syncing'} onClick={() => void syncNow()}>Sync now</Button>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-800">Recovery key</p>
            <p className="text-sm text-slate-600">Enter it on another device (Settings → Cloud backup → “I have a recovery key”) to use or restore your records there.</p>
            {showKey ? <div className="mt-2"><KeyBox k={cfg.key} /></div> : <Button className="mt-2 min-h-10 text-sm" onClick={() => setShowKey(true)}>Show recovery key</Button>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setFlow('off')}>Turn off on this device</Button>
            <Button variant="ghost" onClick={() => setFlow('delete')}>Delete cloud backup</Button>
          </div>
        </div>
      )}

      <Modal open={flow === 'new'} onClose={close} title="Your recovery key" footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!saved || busy} onClick={confirmNew}>Turn on cloud backup</Button></>}>
        <div className="flex flex-col gap-3">
          <p>Save this key somewhere safe <strong>outside this device</strong>, such as a password manager or on paper. You’ll need it to restore your records or use them on another device.</p>
          <KeyBox k={newKey} />
          <Notice tone="warn">If you lose this key and this device, the cloud backup can’t be opened by anyone.</Notice>
          <Checkbox label="I’ve saved my recovery key somewhere safe" checked={saved} onChange={setSaved} />
        </div>
      </Modal>

      <Modal open={flow === 'join'} onClose={close} title="Use a recovery key" footer={found ? <><Button onClick={close}>Cancel</Button><Button disabled={busy} onClick={() => void join('replace')}>Replace this device’s records</Button><Button variant="primary" disabled={busy} onClick={() => void join('merge')}>Combine with this device</Button></> : <><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={busy} onClick={lookUp}>{busy ? 'Checking…' : 'Find my backup'}</Button></>}>
        <div className="flex flex-col gap-3">
          {!found ? (
            <TextField label="Recovery key" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} hint="32 letters and numbers. Dashes and spaces don’t matter." error={error} />
          ) : (
            <>
              <Notice tone="ok" title="Cloud backup found">Saved {relativeTime(found.remote.updatedAt)}: {count(found.remote.payload.data)}.</Notice>
              <p className="text-sm">This device has {count(data)}.</p>
              <ul className="list-disc pl-5 text-sm">
                <li><strong>Combine</strong> keeps everything from both. Where the same record was changed on both, the newer change is kept. Recommended.</li>
                <li><strong>Replace</strong> makes this device match the cloud backup. Records only on this device are removed.</li>
              </ul>
            </>
          )}
        </div>
      </Modal>

      <TypedConfirm open={flow === 'off'} onClose={close} onConfirm={turnOff} title="Turn off cloud sync on this device?" word="OFF" confirmLabel="Turn off">
        <p>This device stops syncing. Your records here and the cloud copy are both kept. You can turn it on again with your recovery key.</p>
      </TypedConfirm>
      <TypedConfirm open={flow === 'delete'} onClose={close} onConfirm={deleteCloud} title="Delete the cloud backup?" word="DELETE" confirmLabel="Delete cloud backup">
        <p>The encrypted copy online is deleted for all your devices. Records on this device are kept. Other devices keep their own records but stop syncing.</p>
      </TypedConfirm>
    </Card>
  );
}
