import { useEffect, useState } from 'react';
import { useStore } from '../store/Store';
import { buildBackup, backupFileName } from '../lib/backup';
import { saveFile } from '../lib/files';
import { Button, Modal, useToast, Badge } from './ui';
import { formatDateShort, formatTime, localDateOf } from '../lib/time';

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    const vis = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [intervalMs]);
  return now;
}

export function LastBackup() {
  const { data } = useStore();
  const last = data.meta.lastBackupAt;
  const tz = data.settings.timeZone;
  if (!last) return <Badge tone="warn">No successful backup yet</Badge>;
  return (
    <Badge tone="ok">
      Last backup {formatDateShort(localDateOf(last, tz))}, {formatTime(last, tz)}
    </Badge>
  );
}

/** "Back up now": only counts as a backup once the file is confirmed saved. */
export function BackupNowButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const { data, mode, saveMeta } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const record = async (method: string) => {
    await saveMeta({ ...data.meta, lastBackupAt: new Date().toISOString(), lastBackupMethod: method });
    toast('Backup saved. Keep the file somewhere safe — it contains your health records.');
  };

  const run = async () => {
    setBusy(true);
    try {
      const name = backupFileName(mode);
      const out = await saveFile(name, JSON.stringify(buildBackup(data, mode), null, 2), 'application/json');
      if (out.status === 'saved') await record('file-picker');
      else if (out.status === 'cancelled') toast('Backup cancelled. Nothing was saved and the last backup date has not changed.', 'warn');
      else if (out.status === 'failed') toast(`Backup failed: ${out.error}. The last backup date has not changed.`, 'danger');
      else setConfirming(name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant={variant} onClick={run} disabled={busy}>
        <span aria-hidden="true">💾</span> {busy ? 'Preparing…' : 'Back up now'}
      </Button>
      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title="Did the backup file save?"
        footer={
          <>
            <Button onClick={() => { setConfirming(null); toast('Not counted as a backup.', 'warn'); }}>No / not sure</Button>
            <Button variant="primary" onClick={async () => { setConfirming(null); await record('download'); }}>Yes, the file saved</Button>
          </>
        }
      >
        <p>
          Your browser started downloading <strong>{confirming}</strong>, but it cannot tell the app whether the file was saved. Check your Downloads (or Files app), then confirm. The last-backup date only changes if you confirm.
        </p>
      </Modal>
    </>
  );
}
