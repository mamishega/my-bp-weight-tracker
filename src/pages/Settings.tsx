import { useEffect, useState } from 'react';
import { useStore } from '../store/Store';
import type { Arm, CollectionName, Monitor, Settings, WeightUnit } from '../types';
import { NumberField, Badge, Button, Card, Checkbox, Modal, Notice, PageTitle, RadioGroup, SelectField, TextArea, TextField, TypedConfirm, useToast } from '../components/ui';
import { BackupNowButton, LastBackup } from '../components/Backup';
import { PrivacySummary, SafetyStatement, UrgentHelp } from '../components/safety';
import { applyMerge, applyReplace, planImport, validateBackup, type BackupFile, type ImportPlan, type MergeOptions } from '../lib/backup';
import { readFileText, saveFile } from '../lib/files';
import { buildIcs, reminderEvents } from '../lib/ics';
import { Icon } from '../components/Icon';
import { ImportReadingsCard } from '../components/ImportReadings';
import { CloudBackupCard } from '../components/CloudBackup';
import { disablePush, enablePush, isIos, pushConfigured, pushEnabledHere, pushSupported, testPush } from '../lib/push';
import { emptyData, uid } from '../lib/defaults';
import { deleteShare } from '../lib/share';
import { medSchedule } from '../lib/medication';
import { isValidTimeZone, listTimeZones, formatDateShort, localDateOf, formatTime } from '../lib/time';
import { requestPersistence } from '../db/db';
import { cryptoAvailable, passcodeProblem } from '../lib/crypto';
import { getTheme, setTheme, type ThemePref } from '../lib/theme';


const STORE_LABEL: Record<CollectionName, string> = {
  sessions: 'Blood pressure sessions', doses: 'Medication doses', medications: 'Medications', stock: 'Supply counts and refills',
  weights: 'Weight entries', dailyLogs: 'Daily lifestyle notes', habits: 'Habit goals', habitChecks: 'Completed habits',
  symptoms: 'Symptoms', appointments: 'Appointments', questions: 'Questions for doctor', reminderStates: 'Snoozed or dismissed reminders',
};

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

/** Re-mount the targets form whenever saved targets change (e.g. after a restore),
 * so stale form values can never overwrite restored data. */
function TargetsCardKeyed() {
  const { data } = useStore();
  return <TargetsCard key={JSON.stringify(data.settings.targets)} />;
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

function ClosedAppReminders() {
  const { data, mode } = useStore();
  const toast = useToast();
  const [on, setOn] = useState(pushEnabledHere());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pushConfigured() || mode === 'demo') return null;
  const toggle = async (v: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (v) {
        await enablePush(data);
        toast('Reminders when the app is closed are on for this device.');
      } else {
        await disablePush();
        toast('Reminders when the app is closed are off for this device.', 'info');
      }
      setOn(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    try {
      await testPush();
      toast('Test sent. A notification should appear within a few seconds.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="mt-5 rounded-xl bg-teal-50/60 p-4 ring-1 ring-teal-100">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Icon name="bell" className="h-[18px] w-[18px] text-teal-700" /> Reminders when the app is closed</h3>
      <p className="mt-1 text-sm text-slate-700">Your phone or computer shows the morning, medication, evening and weight reminders you turned on above at their times, even when this app is closed. Only this device’s push address, your time zone and the reminder times are sent to the app’s reminder server — no names, medicines or readings.{isIos() && ' On iPhone and iPad this works only in the app added to your Home Screen.'}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Checkbox label="Remind me when the app is closed (this device)" checked={on} onChange={(v) => void toggle(v)} />
        {on && <Button className="min-h-10 text-sm" disabled={busy} onClick={test}>Send a test reminder</Button>}
      </div>
      {!pushSupported() && <p className="mt-2 text-sm text-slate-600">This browser can’t receive reminders when the app is closed. Use the calendar option below instead.</p>}
      {error && <div className="mt-2"><Notice tone="warn" role="alert">{error}</Notice></div>}
      <p className="mt-2 text-xs text-slate-600">After-medication, refill, backup and appointment reminders depend on your records, so they still appear in the app.</p>
    </div>
  );
}

function RemindersCard() {
  const { data, saveSettings } = useStore();
  const toast = useToast();
  const st = data.settings;
  const r = st.reminders;
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const noTime = data.medications.filter((m) => m.active && medSchedule(m).times.some((t) => !t));
  const noInterval = data.medications.filter((m) => m.active && m.postDoseReminderMinutes == null);
  const set = (patch: Partial<Settings['reminders']>) => saveSettings({ ...st, reminders: { ...r, ...patch } });
  const enableNotifications = async (on: boolean) => {
    if (!on) return saveSettings({ ...st, notificationsEnabled: false });
    if (typeof Notification === 'undefined') return toast('This browser doesn’t support notifications. In-app reminders still work.', 'warn');
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p === 'granted') { await saveSettings({ ...st, notificationsEnabled: true }); toast('Browser notifications on (while the app is open).'); }
    else toast('Notification permission was not granted. In-app reminders still work.', 'warn');
  };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const exportCalendar = async () => {
    const out = await saveFile('health-reminders.ics', buildIcs(data), 'text/calendar');
    if (out.status === 'cancelled') return toast('Calendar export cancelled.', 'warn');
    if (out.status === 'failed') return toast(`Export failed: ${out.error}`, 'danger');
    toast('Calendar file ready. Open it to add the reminders to your calendar.');
  };
  return (
    <Card title="Reminders" icon="bell" iconTone="orange">
      <Notice tone="warn" title="What reminders can and can’t do">
        <p>Reminders appear inside the app while it is open (including when installed). If browser notifications are on, the app can also show a system notification — but <strong>only while the app is open or running in the background in a tab</strong>. To be reminded when the app is closed, turn on <strong>reminders when the app is closed</strong> below, or add the reminders to your calendar. Use your phone’s alarm as a backup for anything important.</p>
      </Notice>
      <div className="mt-3 flex flex-col gap-4">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_10rem]">
          <Checkbox label="Morning reading before medication" checked={r.morningPre.enabled} onChange={(v) => set({ morningPre: { ...r.morningPre, enabled: v } })} />
          <TextField label="Time" type="time" value={r.morningPre.time} onChange={(e) => e.target.value && set({ morningPre: { ...r.morningPre, time: e.target.value } })} />
        </div>
        <Checkbox label="Medication (at the usual time of each dose)" checked={r.medication.enabled} onChange={(v) => set({ medication: { enabled: v } })} hint="Asks you to record taken or skipped. It never marks a dose for you." />
        {r.medication.enabled && noTime.length > 0 && <Notice tone="warn" title="Some doses have no usual time">No reminder can be shown for those doses of {noTime.map((m) => m.name).join(', ')}. Add a usual time for each dose on the <a href="#/medication">Medication page</a>.</Notice>}
        {r.postDose.enabled && noInterval.length > 0 && <Notice tone="info">No after-medication reminder for {noInterval.map((m) => m.name).join(', ')} — no interval has been entered. Only add one if your clinician asked for after-medication readings.</Notice>}
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
          <NumberField label="Every (days)" value={r.backup.everyDays} isValid={(n) => n != null && Number.isInteger(n) && n > 0} invalidMessage="Enter a whole number of days (1 or more)." onValid={(n) => set({ backup: { ...r.backup, everyDays: n! } })} />
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_10rem]">
          <Checkbox label="Appointment reminder" checked={r.appointment.enabled} onChange={(v) => set({ appointment: { ...r.appointment, enabled: v } })} />
          <NumberField label="Days before" value={r.appointment.daysBefore} isValid={(n) => n != null && Number.isInteger(n) && n >= 0} invalidMessage="Enter a whole number of days (0 or more)." onValid={(n) => set({ appointment: { ...r.appointment, daysBefore: n! } })} />
        </div>
        <SelectField label="Snooze length" value={String(r.snoozeMinutes)} onChange={(e) => set({ snoozeMinutes: Number(e.target.value) })}>
          {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </SelectField>
        <Checkbox label="Also show browser notifications" checked={st.notificationsEnabled && perm === 'granted'} onChange={enableNotifications} hint={`Permission is only requested when you turn this on. Current permission: ${perm}.`} />
      </div>
      <ClosedAppReminders />
      <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Icon name="calendar" className="h-[18px] w-[18px] text-teal-700" /> Or add reminders to your calendar</h3>
        <p className="mt-1 text-sm text-slate-600">Add your reminder schedule to your phone’s calendar. Calendar alerts work even when this app is closed. Titles are generic — no medication names or readings — because calendars are often synced online. After-medication, refill, backup and appointment reminders depend on your records, so they stay in-app.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button icon="download" disabled={reminderEvents(data).length === 0} onClick={exportCalendar}>Add reminders to my calendar (.ics)</Button>
          {reminderEvents(data).length === 0 && <span className="text-sm text-slate-500">Turn on at least one timed reminder above first.</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500">If you change times later, export again and delete the old events in your calendar.</p>
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
          <div tabIndex={0} className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="p-1">Type</th><th className="p-1">In backup</th><th className="p-1">New</th><th className="p-1">Already identical</th><th className="p-1">Same ID, different content</th><th className="p-1">Possible duplicates</th></tr></thead>
              <tbody>{plan.stores.filter((s) => s.incoming || data[s.name].length).map((s) => <tr key={s.name} className="border-b border-slate-100"><td className="p-1">{STORE_LABEL[s.name]}</td><td className="p-1">{s.incoming}</td><td className="p-1">{s.newRecords.length}</td><td className="p-1">{s.identical}</td><td className="p-1">{s.conflicts.length}</td><td className="p-1">{s.possibleDuplicates.length}</td></tr>)}</tbody>
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
    // Turn off the doctor's live link too, so no copy of the data stays online.
    let linkNote = '';
    if (data.settings.share) {
      try {
        await deleteShare(data.settings.share);
      } catch {
        linkNote = ' The doctor share link could not be turned off (no connection); it stops updating and expires on its own.';
      }
    }
    const fresh = emptyData();
    await replaceAll({ ...fresh, settings: { ...fresh.settings, timeZone: data.settings.timeZone } });
    setDel(false);
    toast(`All data on this device has been deleted.${linkNote}`, 'info');
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
        {data.settings.vault && <Notice tone="info">Your encrypted cloud backup is kept and this device stops syncing. To remove the cloud copy too, use “Delete cloud backup” in Cloud backup and sync first.</Notice>}
        <BackupNowButton variant="secondary" />
      </TypedConfirm>
    </Card>
  );
}

function PasscodeCard() {
  const { lockEnabled, enableLock, disableLock, lockNow, mode } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState<'enable' | 'disable' | null>(null);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(null); setP1(''); setP2(''); setAck(false); setErr(null); };
  const doEnable = async () => {
    const problem = passcodeProblem(p1);
    if (problem) return setErr(problem);
    if (p1 !== p2) return setErr('The two passcodes don’t match.');
    if (!ack) return setErr('Please confirm you understand the passcode can’t be recovered.');
    setBusy(true);
    try { await enableLock(p1); toast('Passcode lock is on. Your records are now encrypted on this device.'); close(); }
    catch (e) { setErr(`Could not turn on the lock: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  const doDisable = async () => {
    setBusy(true);
    const ok = await disableLock(p1);
    setBusy(false);
    if (!ok) return setErr('That passcode is not correct.');
    toast('Passcode lock is off. Records are stored unencrypted again.', 'info');
    close();
  };
  if (!cryptoAvailable()) return null;
  return (
    <Card title="Passcode lock" subtitle="Optional encryption of your records on this device" icon="shield" iconTone="teal">
      <div className="flex flex-wrap items-center gap-2">
        {lockEnabled ? <Badge tone="ok">On — records encrypted</Badge> : <Badge>Off — records not encrypted</Badge>}
      </div>
      <p className="mt-2 text-sm text-slate-600">
        With a passcode, records and settings in this browser are encrypted (AES-256-GCM, key derived from your passcode). The app asks for it when opened and locks again after 5 minutes in the background.
        {mode === 'demo' && ' (This applies to the demo database only while in demo mode.)'}
      </p>
      <p className="mt-1 text-sm text-slate-600">Backup files you export are <strong>not</strong> encrypted — keep them private.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {lockEnabled ? (
          <>
            <Button icon="shield" onClick={lockNow}>Lock now</Button>
            <Button variant="ghost" onClick={() => setOpen('disable')}>Turn off passcode…</Button>
          </>
        ) : (
          <Button variant="primary" icon="shield" onClick={() => setOpen('enable')}>Set a passcode…</Button>
        )}
      </div>
      <Modal open={open === 'enable'} onClose={close} title="Set a passcode" footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={busy} onClick={doEnable}>{busy ? 'Encrypting…' : 'Turn on lock'}</Button></>}>
        <div className="flex flex-col gap-3">
          <Notice tone="warn" title="There is no way to recover a forgotten passcode">If you forget it, the records on this device can’t be opened. Make a backup first so you can restore if needed.</Notice>
          <BackupNowButton variant="secondary" />
          <TextField label="New passcode" type="password" autoComplete="new-password" value={p1} onChange={(e) => { setP1(e.target.value); setErr(null); }} hint="At least 6 characters. A short phrase is easier to remember." />
          <TextField label="Confirm passcode" type="password" autoComplete="new-password" value={p2} onChange={(e) => { setP2(e.target.value); setErr(null); }} error={err} />
          <Checkbox label="I understand the passcode can’t be recovered" checked={ack} onChange={setAck} />
        </div>
      </Modal>
      <Modal open={open === 'disable'} onClose={close} title="Turn off passcode" footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" disabled={busy} onClick={doDisable}>Turn off and decrypt</Button></>}>
        <div className="flex flex-col gap-3">
          <p>Records will be stored unencrypted in this browser again.</p>
          <TextField label="Current passcode" type="password" autoComplete="current-password" value={p1} onChange={(e) => { setP1(e.target.value); setErr(null); }} error={err} />
        </div>
      </Modal>
    </Card>
  );
}

function GeneralCard() {
  const { data, saveSettings } = useStore();
  const st = data.settings;
  const zones = listTimeZones();
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  return (
    <Card title="General" icon="sliders" iconTone="slate">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Time zone for grouping and display" value={st.timeZone} onChange={(e) => isValidTimeZone(e.target.value) && saveSettings({ ...st, timeZone: e.target.value })} hint="Each record keeps the time zone it was recorded in, so changing this never alters saved times.">
          {(zones.includes(st.timeZone) ? zones : [st.timeZone, ...zones]).map((z) => <option key={z} value={z}>{z}</option>)}
        </SelectField>
        <SelectField label="Weight unit" value={st.weightUnit} onChange={(e) => saveSettings({ ...st, weightUnit: e.target.value as WeightUnit })}>
          <option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option>
        </SelectField>
        <SelectField label="Appearance" value={theme} onChange={(e) => { const v = e.target.value as ThemePref; setThemeState(v); setTheme(v); }}>
          <option value="system">Match my device</option><option value="light">Light</option><option value="dark">Dark</option>
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
      <CloudBackupCard />
      <RestoreCard />
      <ImportReadingsCard />
      <PasscodeCard />
      <GeneralCard />
      <TargetsCardKeyed />
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
