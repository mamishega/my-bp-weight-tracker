import { useEffect, useState } from 'react';
import { useStore } from '../store/Store';
import type { Arm, Monitor, Settings, WeightUnit } from '../types';
import { Badge, Button, Card, Checkbox, Modal, Notice, PageTitle, RadioGroup, SelectField, TextArea, TextField, TypedConfirm, useToast } from '../components/ui';
import { BackupNowButton, LastBackup } from '../components/Backup';
import { PrivacySummary, SafetyStatement, UrgentHelp } from '../components/safety';
import { applyMerge, applyReplace, planImport, validateBackup, type BackupFile, type ImportPlan, type MergeOptions } from '../lib/backup';
import { readFileText } from '../lib/files';
import { emptyData, uid } from '../lib/defaults';
import { isValidTimeZone, listTimeZones, formatDateShort, localDateOf, formatTime } from '../lib/time';
import { requestPersistence } from '../db/db';


function TargetsCard() {
  const { data, saveSettings } = useStore();
  const toast = useToast();
  const t = data.settings.targets;
  const s = (n: number | null) => (n == null ? '' : String(n));
  const [f, setF] = useState({ systolic: s(t.systolic), diastolic: s(t.diastolic), cs: s(t.contactSystolicAbove), cd: s(t.contactDiastolicAbove), instr: t.contactInstruction, source: t.source, setOn: t.setOn ?? '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = async () => {
    const e: Record<string, string> = {};
    const n = (k: keyof typeof f) => {
      const v = f[k].trim();
      if (!v) return null;
      const x = Number(v);
      if (!Number.isInteger(x) || x <= 0 || x > 300) { e[k] = 'Enter a whole number in mmHg, or leave blank.'; return null; }
      return x;
    };
    const next = { systolic: n('systolic'), diastolic: n('diastolic'), contactSystolicAbove: n('cs'), contactDiastolicAbove: n('cd'), contactInstruction: f.instr, source: f.source, setOn: f.setOn || null };
    setErr(e);
    if (Object.keys(e).length) return;
    await saveSettings({ ...data.settings, targets: next });
    toast('Personal targets saved.');
  };
  return (
    <Card title="Personal blood pressure targets" subtitle="Only numbers your clinician has given you" icon="stethoscope">
      <p className="mb-3 text-sm text-slate-700">Targets differ from person to person. Only enter numbers your clinician has given you. The app doesn’t assume any target. Targets never change the urgent symptom guidance.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Target systolic (mmHg)" optional inputMode="numeric" value={f.systolic} onChange={(e) => setF({ ...f, systolic: e.target.value })} error={err.systolic} />
        <TextField label="Target diastolic (mmHg)" optional inputMode="numeric" value={f.diastolic} onChange={(e) => setF({ ...f, diastolic: e.target.value })} error={err.diastolic} />
        <TextField label="Contact my clinician if systolic is above" optional inputMode="numeric" value={f.cs} onChange={(e) => setF({ ...f, cs: e.target.value })} error={err.cs} />
        <TextField label="Contact my clinician if diastolic is above" optional inputMode="numeric" value={f.cd} onChange={(e) => setF({ ...f, cd: e.target.value })} error={err.cd} />
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <TextArea label="What my clinician asked me to do in that case" optional value={f.instr} onChange={(e) => setF({ ...f, instr: e.target.value })} hint="Shown with any reading above your contact levels." />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Advice from" optional value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} hint="e.g. Dr Lee, GP" />
          <TextField label="Date of advice" type="date" optional value={f.setOn} onChange={(e) => setF({ ...f, setOn: e.target.value })} />
        </div>
        <div><Button variant="primary" onClick={save}>Save targets</Button></div>
      </div>
      <Notice tone="info">Home readings are commonly taken before medication. If your clinician has asked for additional after-medication readings, follow their schedule — the app doesn’t recommend one.</Notice>
    </Card>
  );
}

function MonitorsCard() {
  const { data, saveSettings } = useStore();
  const st = data.settings;
  const [edit, setEdit] = useState<Monitor | null>(null);
  const save = async (m: Monitor) => {
    const exists = st.monitors.some((x) => x.id === m.id);
    await saveSettings({ ...st, monitors: exists ? st.monitors.map((x) => (x.id === m.id ? m : x)) : [...st.monitors, m], defaultMonitorId: st.defaultMonitorId ?? m.id });
    setEdit(null);
  };
  return (
    <Card title="Measurement consistency" subtitle="Usual arm, monitors and cuffs" icon="activity" iconTone="blue">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Usual arm" value={st.defaultArm ?? ''} onChange={(e) => saveSettings({ ...st, defaultArm: (e.target.value || null) as Arm | null })}>
          <option value="">Not set</option><option value="left">Left</option><option value="right">Right</option>
        </SelectField>
        <SelectField label="Default monitor" value={st.defaultMonitorId ?? ''} onChange={(e) => saveSettings({ ...st, defaultMonitorId: e.target.value || null })}>
          <option value="">None</option>{st.monitors.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </SelectField>
      </div>
      <h3 className="mt-4 font-semibold">Monitors and cuffs</h3>
      <ul className="mt-1 space-y-1">
        {st.monitors.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <span>{m.label}{m.model && ` — ${m.model}`}{m.cuffSize && ` · cuff ${m.cuffSize}`}</span>
            {st.defaultMonitorId === m.id && <Badge tone="ok">Default</Badge>}
            <Button variant="ghost" onClick={() => setEdit(m)}>Edit</Button>
          </li>
        ))}
      </ul>
      <Button className="mt-2" onClick={() => setEdit({ id: uid(), label: '', model: '', cuffSize: '', notes: '' })}>Add monitor</Button>
      <p className="mt-2 text-sm text-slate-600">Previous readings keep the monitor name they were recorded with.</p>
      {edit && <MonitorForm m={edit} onSave={save} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function MonitorForm({ m, onSave, onClose }: { m: Monitor; onSave: (m: Monitor) => void; onClose: () => void }) {
  const [f, setF] = useState(m);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="Monitor details" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => (f.label.trim() ? onSave({ ...f, label: f.label.trim() }) : setErr('Give the monitor a name.'))}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} error={err} hint="e.g. Home upper-arm monitor" />
        <TextField label="Brand and model" optional value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
        <TextField label="Cuff size" optional value={f.cuffSize} onChange={(e) => setF({ ...f, cuffSize: e.target.value })} hint="e.g. Medium 22–32 cm" />
        <TextArea label="Notes" optional value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} hint="e.g. validated device list checked, last calibration" />
      </div>
    </Modal>
  );
}

function RemindersCard() {
  const { data, saveSettings } = useStore();
  const toast = useToast();
  const st = data.settings;
  const r = st.reminders;
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const set = (patch: Partial<Settings['reminders']>) => saveSettings({ ...st, reminders: { ...r, ...patch } });
  const enableNotifications = async (on: boolean) => {
    if (!on) return saveSettings({ ...st, notificationsEnabled: false });
    if (typeof Notification === 'undefined') return toast('This browser doesn’t support notifications. In-app reminders still work.', 'warn');
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p === 'granted') { await saveSettings({ ...st, notificationsEnabled: true }); toast('Browser notifications on (while the app is open).'); }
    else toast('Notification permission was not granted. In-app reminders still work.', 'warn');
  };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <Card title="Reminders" icon="bell" iconTone="orange">
      <Notice tone="warn" title="What reminders can and can’t do">
        <p>Reminders appear inside the app while it is open (including when installed). If browser notifications are on, the app can also show a system notification — but <strong>only while the app is open or running in the background in a tab</strong>. This web app has no server, so it cannot reliably remind you when it is closed, the phone is asleep, or the browser has stopped it. Use your phone’s alarm or calendar as a backup for important reminders.</p>
      </Notice>
      <div className="mt-3 flex flex-col gap-4">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_10rem]">
          <Checkbox label="Morning reading before medication" checked={r.morningPre.enabled} onChange={(v) => set({ morningPre: { ...r.morningPre, enabled: v } })} />
          <TextField label="Time" type="time" value={r.morningPre.time} onChange={(e) => e.target.value && set({ morningPre: { ...r.morningPre, time: e.target.value } })} />
        </div>
        <Checkbox label="Morning medication (at each medicine’s usual time)" checked={r.medication.enabled} onChange={(v) => set({ medication: { enabled: v } })} hint="Asks you to record taken or skipped. It never marks a dose for you." />
        <Checkbox label="After-medication reading" checked={r.postDose.enabled} onChange={(v) => set({ postDose: { enabled: v } })} hint="Timed from the actual recorded dose time, using the interval you entered for each medication from your clinician’s instructions." />
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_10rem]">
          <Checkbox label="Evening reading" checked={r.evening.enabled} onChange={(v) => set({ evening: { ...r.evening, enabled: v } })} />
          <TextField label="Time" type="time" value={r.evening.time} onChange={(e) => e.target.value && set({ evening: { ...r.evening, time: e.target.value } })} />
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_10rem]">
          <Checkbox label="Weight entry (optional)" checked={r.weight.enabled} onChange={(v) => set({ weight: { ...r.weight, enabled: v } })} />
          <TextField label="Time" type="time" value={r.weight.time} onChange={(e) => e.target.value && set({ weight: { ...r.weight, time: e.target.value } })} />
        </div>
        {r.weight.enabled && (
          <fieldset className="flex flex-wrap gap-3"><legend className="mb-1 text-sm font-medium">Weight reminder days</legend>
            {days.map((d, i) => <Checkbox key={d} label={d} checked={r.weight.weekdays.includes(i)} onChange={(v) => set({ weight: { ...r.weight, weekdays: v ? [...r.weight.weekdays, i] : r.weight.weekdays.filter((x) => x !== i) } })} />)}
          </fieldset>
        )}
        <Checkbox label="Medication refill and prescription renewal" checked={r.refill.enabled} onChange={(v) => set({ refill: { enabled: v } })} />
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_10rem]">
          <Checkbox label="Backup reminder" checked={r.backup.enabled} onChange={(v) => set({ backup: { ...r.backup, enabled: v } })} />
          <TextField label="Every (days)" inputMode="numeric" value={String(r.backup.everyDays)} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n > 0) set({ backup: { ...r.backup, everyDays: n } }); }} />
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_10rem]">
          <Checkbox label="Appointment reminder" checked={r.appointment.enabled} onChange={(v) => set({ appointment: { ...r.appointment, enabled: v } })} />
          <TextField label="Days before" inputMode="numeric" value={String(r.appointment.daysBefore)} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0) set({ appointment: { ...r.appointment, daysBefore: n } }); }} />
        </div>
        <SelectField label="Snooze length" value={String(r.snoozeMinutes)} onChange={(e) => set({ snoozeMinutes: Number(e.target.value) })}>
          {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </SelectField>
        <Checkbox label="Also show browser notifications" checked={st.notificationsEnabled && perm === 'granted'} onChange={enableNotifications} hint={`Permission is only requested when you turn this on. Current permission: ${perm}.`} />
      </div>
    </Card>
  );
}

function RestoreCard() {
  const { data, mode, replaceAll } = useStore();
  const toast = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [strategy, setStrategy] = useState<'merge' | 'replace'>('merge');
  const [opts, setOpts] = useState<MergeOptions>({ conflicts: 'keep_current', possibleDuplicates: 'skip', settings: 'keep_current' });
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  const onFile = async (file: File | undefined) => {
    setErrors([]); setBackup(null); setPlan(null);
    if (!file) return;
    let raw: unknown;
    try { raw = JSON.parse(await readFileText(file)); } catch { setErrors(['This file is not valid JSON. Choose a backup file created by this app.']); return; }
    const v = validateBackup(raw, mode);
    if (!v.ok) { setErrors(v.errors); return; }
    setBackup(v.backup);
    setPlan(planImport(data, v.backup!));
  };
  const reset = () => { setBackup(null); setPlan(null); setFileKey((k) => k + 1); };
  const apply = async () => {
    if (!backup || !plan) return;
    const next = strategy === 'replace' ? applyReplace(data, backup) : applyMerge(data, backup, plan, opts);
    await replaceAll(next);
    toast(strategy === 'replace' ? 'Backup restored. Your records now match the backup.' : 'Backup merged into your records.');
    setConfirmReplace(false);
    reset();
  };
  const totals = plan ? plan.stores.reduce((a, s) => ({ n: a.n + s.newRecords.length, i: a.i + s.identical, c: a.c + s.conflicts.length, d: a.d + s.possibleDuplicates.length }), { n: 0, i: 0, c: 0, d: 0 }) : null;

  return (
    <Card title="Restore from backup" subtitle="Validated and previewed before anything changes" icon="upload" iconTone="slate">
      <label className="text-sm font-semibold text-slate-800" htmlFor="restore-file">Choose a JSON backup file</label>
      <input key={fileKey} id="restore-file" type="file" accept="application/json,.json" className="mt-1.5 block w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2 text-sm text-slate-600 file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-4 file:text-sm file:font-semibold file:text-slate-800 hover:file:bg-slate-50" onChange={(e) => onFile(e.target.files?.[0])} />
      <p className="mt-1 text-sm text-slate-600">The file is checked and previewed first. Nothing changes until you confirm.</p>
      {errors.length > 0 && <div className="mt-3"><Notice tone="danger" role="alert" title="This backup can’t be restored"><ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice></div>}
      {backup && plan && totals && (
        <div className="mt-3 flex flex-col gap-3">
          <Notice tone="info" title="Backup preview">
            <p>Created {formatDateShort(localDateOf(backup.exportedAt, data.settings.timeZone))} {formatTime(backup.exportedAt, data.settings.timeZone)} (time zone {backup.exportedTimeZone}), {plan.totalIncoming} records.</p>
          </Notice>
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="p-1">Type</th><th className="p-1">In backup</th><th className="p-1">New</th><th className="p-1">Already identical</th><th className="p-1">Same ID, different content</th><th className="p-1">Possible duplicates</th></tr></thead>
              <tbody>{plan.stores.filter((s) => s.incoming || data[s.name].length).map((s) => <tr key={s.name} className="border-b border-slate-100"><td className="p-1">{s.name}</td><td className="p-1">{s.incoming}</td><td className="p-1">{s.newRecords.length}</td><td className="p-1">{s.identical}</td><td className="p-1">{s.conflicts.length}</td><td className="p-1">{s.possibleDuplicates.length}</td></tr>)}</tbody>
            </table>
          </div>
          <RadioGroup name="restore-strategy" legend="How should the backup be used?" value={strategy} onChange={setStrategy} options={[
            { value: 'merge', label: 'Merge', hint: 'Add records from the backup. Your current records are kept.' },
            { value: 'replace', label: 'Replace everything', hint: 'Delete all current records on this device and use only the backup.' },
          ]} />
          {strategy === 'merge' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField label={`Same ID, different content (${totals.c})`} value={opts.conflicts} onChange={(e) => setOpts({ ...opts, conflicts: e.target.value as MergeOptions['conflicts'] })}><option value="keep_current">Keep my current version</option><option value="use_backup">Use the backup version</option></SelectField>
              <SelectField label={`Possible duplicates (${totals.d})`} value={opts.possibleDuplicates} onChange={(e) => setOpts({ ...opts, possibleDuplicates: e.target.value as MergeOptions['possibleDuplicates'] })}><option value="skip">Skip them</option><option value="import">Import them anyway</option></SelectField>
              <SelectField label="Settings" value={opts.settings} onChange={(e) => setOpts({ ...opts, settings: e.target.value as MergeOptions['settings'] })}><option value="keep_current">Keep my current settings</option><option value="use_backup">Use backup settings</option></SelectField>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant={strategy === 'replace' ? 'danger' : 'primary'} onClick={() => (strategy === 'replace' ? setConfirmReplace(true) : apply())}>{strategy === 'replace' ? 'Replace with backup…' : `Merge ${totals.n + (opts.possibleDuplicates === 'import' ? totals.d : 0)} new records`}</Button>
            <Button onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}
      <TypedConfirm open={confirmReplace} onClose={() => setConfirmReplace(false)} onConfirm={apply} title="Replace all records?" word="REPLACE" confirmLabel="Replace all records">
        <p>All records currently on this device will be removed and replaced with the {plan?.totalIncoming} records in the backup. Consider backing up first.</p>
        <BackupNowButton variant="secondary" />
      </TypedConfirm>
    </Card>
  );
}

function StorageCard() {
  const { data, mode, setMode, replaceAll, resetDemo } = useStore();
  const toast = useToast();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    navigator.storage?.estimate?.().then((e) => e.usage != null && setUsage(`${(e.usage / 1024).toFixed(0)} KB used`)).catch(() => {});
  }, []);
  const deleteAll = async () => {
    const fresh = emptyData();
    await replaceAll({ ...fresh, settings: { ...fresh.settings, timeZone: data.settings.timeZone } });
    setDel(false);
    toast('All data on this device has been deleted.', 'info');
  };
  return (
    <Card title="Privacy and storage" icon="shield" iconTone="slate">
      <PrivacySummary />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {persisted ? <Badge tone="ok">Browser asked to keep storage</Badge> : <Badge tone="warn">Storage may be cleared by the browser</Badge>}
        {usage && <Badge>{usage}</Badge>}
        {!persisted && <Button onClick={async () => { const r = await requestPersistence(); setPersisted(r); toast(r ? 'The browser agreed to keep this app’s storage. Backups are still recommended.' : 'The browser did not grant persistent storage. Installing the app can help. Keep making backups.', r ? 'ok' : 'warn'); }}>Ask browser to keep my data</Button>}
      </div>
      <h3 className="mt-4 font-semibold">Demo mode</h3>
      <p className="text-sm text-slate-700">Demo mode uses a separate, clearly labelled sample database. It can never mix with your personal records, and demo backups can’t be restored into personal records.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {mode === 'real' ? <Button icon="flask" onClick={() => setMode('demo')}>Open demo mode</Button> : <><Button variant="primary" onClick={() => setMode('real')}>Return to my records</Button><Button onClick={async () => { await resetDemo(); toast('Sample data reset.', 'info'); }}>Reset sample data</Button></>}
      </div>
      <h3 className="mt-4 font-semibold text-red-900">Delete all data</h3>
      <p className="text-sm text-slate-700">Permanently deletes every {mode === 'demo' ? 'demo' : 'personal'} record and setting stored in this browser. Backup files you saved are not affected.</p>
      <Button variant="danger" className="mt-2" onClick={() => setDel(true)}>Delete all {mode === 'demo' ? 'demo ' : ''}data…</Button>
      <TypedConfirm open={del} onClose={() => setDel(false)} onConfirm={deleteAll} title="Delete all data on this device?" word="DELETE" confirmLabel="Delete everything">
        <p>This removes {data.sessions.length} blood pressure sessions, {data.doses.length} dose records, {data.weights.length} weight entries, {data.symptoms.length} symptoms and all other records and settings. It can’t be undone.</p>
        <BackupNowButton variant="secondary" />
      </TypedConfirm>
    </Card>
  );
}

function GeneralCard() {
  const { data, saveSettings } = useStore();
  const st = data.settings;
  const zones = listTimeZones();
  return (
    <Card title="General" icon="sliders" iconTone="slate">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Time zone for grouping and display" value={st.timeZone} onChange={(e) => isValidTimeZone(e.target.value) && saveSettings({ ...st, timeZone: e.target.value })} hint="Each record keeps the time zone it was recorded in, so changing this never alters saved times.">
          {(zones.includes(st.timeZone) ? zones : [st.timeZone, ...zones]).map((z) => <option key={z} value={z}>{z}</option>)}
        </SelectField>
        <SelectField label="Weight unit" value={st.weightUnit} onChange={(e) => saveSettings({ ...st, weightUnit: e.target.value as WeightUnit })}>
          <option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option>
        </SelectField>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Settings &amp; Backups</PageTitle>
      <Card title="Backup" subtitle="One file with every record and setting" icon="database">
        <div className="flex flex-wrap items-center gap-3"><LastBackup /><BackupNowButton /></div>
        <p className="mt-2 text-sm text-slate-700">The backup is one JSON file with every record (with its ID, timestamps and time zone), your settings and full medication history. A backup only counts once the file is saved; cancelled or failed saves never update the date.</p>
        <Notice tone="warn">Backup files contain sensitive personal health information and are not encrypted. Keep them somewhere private.</Notice>
      </Card>
      <RestoreCard />
      <GeneralCard />
      <TargetsCard />
      <MonitorsCard />
      <RemindersCard />
      <StorageCard />
      <Card title="Install on your phone or computer" icon="smartphone" iconTone="slate">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li><strong>iPhone / iPad (Safari):</strong> tap Share, then “Add to Home Screen”.</li>
          <li><strong>Android (Chrome):</strong> tap the ⋮ menu, then “Install app” or “Add to Home screen”.</li>
          <li><strong>Desktop (Chrome / Edge):</strong> click the install icon in the address bar.</li>
          <li>After the app has loaded once, it opens and works offline. Records stay on that device only — an installed app and the browser may keep separate storage on some phones (notably iPhone), so back up before switching.</li>
        </ul>
      </Card>
      <Card title="About and safety" icon="heartPulse">
        <SafetyStatement />
        <div className="mt-3"><UrgentHelp /></div>
        <p className="mt-3 text-xs text-slate-500">Version {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}</p>
      </Card>
    </div>
  );
}
