import { useState } from 'react';
import { useStore } from '../store/Store';
import { useRoute, navigate } from '../store/router';
import { useDirtyForm } from '../store/dirty';
import type { DailyLog, Severity, SymptomEntry } from '../types';
import { Badge, Button, Card, Checkbox, Empty, Modal, Optional, PageTitle, SelectField, TextArea, TextField, useToast, cx } from '../components/ui';
import { UrgentHelp } from '../components/safety';
import { addDays, dateRange, formatDateShort, formatTime, instantToZoned, isValidDate, isValidTime, nowTimeIn, todayIn, weekStart, zonedToInstant } from '../lib/time';
import { uid } from '../lib/defaults';
import { SESSION_SHORT, sessionAverage, fmtBP } from '../lib/bp';
import { findDuplicateSymptoms } from '../lib/quality';

function SymptomForm({ existing, onDone }: { existing?: SymptomEntry; onDone: () => void }) {
  const { data, put } = useStore();
  const toast = useToast();
  const tz = existing?.timeZone ?? data.settings.timeZone;
  const init = existing ? instantToZoned(existing.occurredAt, tz) : { date: todayIn(tz), time: nowTimeIn(tz) };
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [desc, setDesc] = useState(existing?.description ?? '');
  const [sev, setSev] = useState<Severity | ''>(existing?.severity ?? '');
  const [duration, setDuration] = useState(existing?.duration ?? '');
  const [sessionId, setSessionId] = useState(existing?.relatedSessionId ?? '');
  const [doseId, setDoseId] = useState(existing?.relatedDoseId ?? '');
  const [actions, setActions] = useState(existing?.actionsTaken ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  useDirtyForm('symptom', desc !== (existing?.description ?? '') || notes !== (existing?.notes ?? ''));
  const nearSessions = data.sessions.filter((s) => s.date >= addDays(date, -1) && s.date <= date).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const nearDoses = data.doses.filter((d) => d.date >= addDays(date, -1) && d.date <= date);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!desc.trim()) e.desc = 'Describe the symptom in your own words.';
    if (!isValidDate(date)) e.date = 'Enter a valid date.';
    if (!isValidTime(time)) e.time = 'Enter a valid time.';
    setErr(e);
    if (Object.keys(e).length) return;
    const z = zonedToInstant(date, time, tz);
    const now = new Date().toISOString();
    await put('symptoms', { id: existing?.id ?? uid(), date, occurredAt: z.iso, timeZone: tz, utcOffsetMinutes: z.offsetMinutes, description: desc.trim(), severity: sev || null, duration, relatedSessionId: sessionId || null, relatedDoseId: doseId || null, actionsTaken: actions, notes, createdAt: existing?.createdAt ?? now, updatedAt: now });
    toast('Symptom saved.');
    setDesc(''); setNotes(''); setActions(''); setDuration(''); setSev('');
    onDone();
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <TextArea label="What are you experiencing?" value={desc} onChange={(e) => setDesc(e.target.value)} error={err.desc} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={err.date} />
        <TextField label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} error={err.time} />
      </div>
      <Optional summary="Severity, duration and related records" defaultOpen={!!existing}>
        <SelectField label="Severity" optional value={sev} onChange={(e) => setSev(e.target.value as Severity | '')}>
          <option value="">Not recorded</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option>
        </SelectField>
        <TextField label="Duration" optional value={duration} onChange={(e) => setDuration(e.target.value)} hint="e.g. 20 minutes, since this morning" />
        <SelectField label="Related reading" optional value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">None</option>
          {nearSessions.map((s) => <option key={s.id} value={s.id}>{formatDateShort(s.date)} {SESSION_SHORT[s.sessionType]} {formatTime(s.measuredAt, s.timeZone)} — {fmtBP(sessionAverage(s).systolic, sessionAverage(s).diastolic)}</option>)}
        </SelectField>
        <SelectField label="Related medication record" optional value={doseId} onChange={(e) => setDoseId(e.target.value)}>
          <option value="">None</option>
          {nearDoses.map((d) => <option key={d.id} value={d.id}>{formatDateShort(d.date)} {d.nameSnapshot} — {d.status}{d.takenAt ? ` ${formatTime(d.takenAt, d.timeZone)}` : ''}</option>)}
        </SelectField>
        <TextArea label="Actions taken" optional value={actions} onChange={(e) => setActions(e.target.value)} hint="e.g. rested, called healthdirect, saw GP" />
        <TextArea label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Optional>
      <div className="flex gap-2"><Button type="submit" variant="primary">{existing ? 'Save changes' : 'Save symptom'}</Button>{existing && <Button onClick={onDone}>Cancel</Button>}</div>
      <p className="text-sm text-slate-600">The app does not diagnose symptoms or suggest medication changes. If you’re worried, contact your doctor or healthdirect.</p>
    </form>
  );
}

function SymptomsTab() {
  const { data, remove } = useStore();
  const [edit, setEdit] = useState<SymptomEntry | null>(null);
  const [del, setDel] = useState<SymptomEntry | null>(null);
  const dupes = findDuplicateSymptoms(data.symptoms);
  const list = [...data.symptoms].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={edit ? 'Edit symptom' : 'Record a symptom'} icon="clipboard"><SymptomForm key={edit?.id ?? 'new'} existing={edit ?? undefined} onDone={() => setEdit(null)} /></Card>
      <Card title={`Symptom diary (${list.length})`} icon="list" iconTone="slate">
        {list.length === 0 ? <Empty>No symptoms recorded.</Empty> : (
          <ul className="space-y-3">
            {list.map((s) => (
              <li key={s.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm text-slate-600">{formatDateShort(s.date)} {formatTime(s.occurredAt, s.timeZone)} {s.severity && <Badge>{s.severity}</Badge>} {dupes.has(s.id) && <Badge tone="warn">Possible duplicate</Badge>}</p>
                <p className="font-medium">{s.description}</p>
                {s.duration && <p className="text-sm">Duration: {s.duration}</p>}
                {s.actionsTaken && <p className="text-sm">Actions: {s.actionsTaken}</p>}
                {s.notes && <p className="text-sm">Notes: {s.notes}</p>}
                <div className="mt-1 flex gap-1"><Button variant="ghost" onClick={() => setEdit(s)}>Edit</Button><Button variant="ghost" onClick={() => setDel(s)}>Delete</Button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={!!del} onClose={() => setDel(null)} title="Delete symptom?" footer={<><Button onClick={() => setDel(null)}>Keep</Button><Button variant="danger" onClick={async () => { await remove('symptoms', del!.id); setDel(null); }}>Delete</Button></>}><p>{del?.description}</p></Modal>
    </div>
  );
}

const SCALE = ['1', '2', '3', '4', '5'];

function LifestyleTab() {
  const { data, put, remove } = useStore();
  const toast = useToast();
  const tz = data.settings.timeZone;
  const [date, setDate] = useState(todayIn(tz));
  const existing = data.dailyLogs.find((l) => l.date === date);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Daily context" subtitle="Every field is optional" icon="activity">
        <p className="mb-3 text-sm text-slate-600">These notes give context to your trends. They are never treated as the cause of a reading or weight change.</p>
        <TextField label="Day" type="date" value={date} onChange={(e) => isValidDate(e.target.value) && setDate(e.target.value)} />
        <LifestyleForm key={date + (existing?.updatedAt ?? '')} date={date} existing={existing} onSave={async (l) => { await put('dailyLogs', l); toast('Daily notes saved.'); }} onDelete={existing ? async () => { await remove('dailyLogs', existing.id); toast('Daily notes removed.', 'info'); } : undefined} />
      </Card>
      <Card title="Recent daily notes" icon="list" iconTone="slate">
        {data.dailyLogs.length === 0 ? <Empty>No daily notes yet.</Empty> : (
          <ul className="space-y-2 text-sm">
            {[...data.dailyLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map((l) => (
              <li key={l.id}><button type="button" className="text-left underline" onClick={() => setDate(l.date)}>{formatDateShort(l.date)}</button>: {lifestyleSummary(l) || 'notes only'}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function lifestyleSummary(l: DailyLog): string {
  const parts: string[] = [];
  if (l.sleepHours != null) parts.push(`sleep ${l.sleepHours} h${l.sleepQuality ? ` (quality ${l.sleepQuality}/5)` : ''}`);
  if (l.stress != null) parts.push(`stress ${l.stress}/5`);
  if (l.activityMinutes != null) parts.push(`activity ${l.activityMinutes} min${l.activityNote ? ` (${l.activityNote})` : ''}`);
  if (l.caffeineDrinks != null) parts.push(`caffeine ${l.caffeineDrinks}`);
  if (l.alcoholDrinks != null) parts.push(`alcohol ${l.alcoholDrinks}`);
  if (l.saltyMeal) parts.push('unusually salty meal');
  if (l.illnessOrPain) parts.push('illness or pain');
  if (l.unusual) parts.push(l.unusual);
  if (l.tags.length) parts.push(`tags: ${l.tags.join(', ')}`);
  return parts.join(' · ');
}

function LifestyleForm({ date, existing, onSave, onDelete }: { date: string; existing?: DailyLog; onSave: (l: DailyLog) => Promise<void>; onDelete?: () => Promise<void> }) {
  const n = (v: number | null | undefined) => (v == null ? '' : String(v));
  const [f, setF] = useState({
    sleepHours: n(existing?.sleepHours), sleepQuality: n(existing?.sleepQuality), stress: n(existing?.stress), activityMinutes: n(existing?.activityMinutes),
    activityNote: existing?.activityNote ?? '', caffeineDrinks: n(existing?.caffeineDrinks), alcoholDrinks: n(existing?.alcoholDrinks), saltyMeal: existing?.saltyMeal ?? false,
    illnessOrPain: existing?.illnessOrPain ?? false, unusual: existing?.unusual ?? '', tags: (existing?.tags ?? []).join(', '), notes: existing?.notes ?? '',
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useDirtyForm('lifestyle', dirty);
  const set = (k: keyof typeof f, v: string | boolean) => { setDirty(true); setF((x) => ({ ...x, [k]: v })); };
  const save = async () => {
    const e: Record<string, string> = {};
    const num = (k: keyof typeof f, max: number) => {
      const s = String(f[k]).trim();
      if (!s) return null;
      const v = Number(s);
      if (!Number.isFinite(v) || v < 0 || v > max) { e[k] = `Enter a number from 0 to ${max}, or leave blank.`; return null; }
      return v;
    };
    const rec: DailyLog = {
      id: date, date, sleepHours: num('sleepHours', 24), sleepQuality: num('sleepQuality', 5), stress: num('stress', 5), activityMinutes: num('activityMinutes', 1440),
      activityNote: f.activityNote, caffeineDrinks: num('caffeineDrinks', 50), alcoholDrinks: num('alcoholDrinks', 50), saltyMeal: f.saltyMeal, illnessOrPain: f.illnessOrPain,
      unusual: f.unusual, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), notes: f.notes, createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setErr(e);
    if (Object.keys(e).length) return;
    await onSave(rec);
    setDirty(false);
  };
  return (
    <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Sleep (hours)" inputMode="decimal" value={f.sleepHours} onChange={(e) => set('sleepHours', e.target.value)} error={err.sleepHours} optional />
        <SelectField label="Sleep quality" optional value={f.sleepQuality} onChange={(e) => set('sleepQuality', e.target.value)}><option value="">—</option>{SCALE.map((s) => <option key={s} value={s}>{s} {s === '1' ? '(poor)' : s === '5' ? '(very good)' : ''}</option>)}</SelectField>
        <SelectField label="Stress level" optional value={f.stress} onChange={(e) => set('stress', e.target.value)}><option value="">—</option>{SCALE.map((s) => <option key={s} value={s}>{s} {s === '1' ? '(low)' : s === '5' ? '(high)' : ''}</option>)}</SelectField>
        <TextField label="Activity / walking (minutes)" inputMode="numeric" value={f.activityMinutes} onChange={(e) => set('activityMinutes', e.target.value)} error={err.activityMinutes} optional />
        <TextField label="Activity note" value={f.activityNote} onChange={(e) => set('activityNote', e.target.value)} optional />
        <TextField label="Caffeinated drinks" inputMode="numeric" value={f.caffeineDrinks} onChange={(e) => set('caffeineDrinks', e.target.value)} error={err.caffeineDrinks} optional />
        <TextField label="Alcoholic drinks" inputMode="numeric" value={f.alcoholDrinks} onChange={(e) => set('alcoholDrinks', e.target.value)} error={err.alcoholDrinks} optional />
      </div>
      <Checkbox label="Unusually salty meal(s)" checked={f.saltyMeal} onChange={(v) => set('saltyMeal', v)} />
      <Checkbox label="Illness or pain" checked={f.illnessOrPain} onChange={(v) => set('illnessOrPain', v)} />
      <TextField label="Unusual circumstances" value={f.unusual} onChange={(e) => set('unusual', e.target.value)} optional hint="e.g. travel, late night, hot weather" />
      <TextField label="Tags (comma separated)" value={f.tags} onChange={(e) => set('tags', e.target.value)} optional />
      <TextArea label="Notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} optional />
      <div className="flex gap-2"><Button type="submit" variant="primary">Save daily notes</Button>{onDelete && <Button variant="ghost" onClick={onDelete}>Clear this day</Button>}</div>
    </form>
  );
}

function HabitsTab() {
  const { data, put, remove } = useStore();
  const tz = data.settings.timeZone;
  const today = todayIn(tz);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const week = dateRange(weekStart(today), addDays(weekStart(today), 6));
  const add = async (n: string) => {
    if (!n.trim()) return setErr('Enter a habit, e.g. “Walk for 20 minutes”.');
    const now = new Date().toISOString();
    await put('habits', { id: uid(), name: n.trim(), active: true, createdAt: now, updatedAt: now });
    setName('');
    setErr(null);
  };
  const toggle = async (habitId: string, date: string, done: boolean) => {
    const id = `${habitId}:${date}`;
    if (done) await put('habitChecks', { id, habitId, date, createdAt: new Date().toISOString() });
    else await remove('habitChecks', id);
  };
  const suggestions = ['Walk for 20 minutes', 'Prepare a meal at home', 'Choose a lower-salt option', 'Wind down for bed on time', 'Have an alcohol-free day'];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Choose habit goals" icon="award" iconTone="green">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void add(name); }}>
          <div className="min-w-60 flex-1"><TextField label="New habit" value={name} onChange={(e) => setName(e.target.value)} error={err} /></div>
          <Button type="submit" variant="primary">Add habit</Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.filter((s) => !data.habits.some((h) => h.name === s)).map((s) => <Button key={s} variant="ghost" onClick={() => add(s)}>+ {s}</Button>)}
        </div>
        <p className="mt-2 text-sm text-slate-600">Habits celebrate actions you complete — not blood pressure numbers or weight.</p>
      </Card>
      <Card title="This week" icon="calendar" iconTone="slate">
        {data.habits.length === 0 ? <Empty>No habits chosen yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2 text-left">Habit</th>{week.map((d) => <th key={d} scope="col" className="p-1 font-normal">{formatDateShort(d).split(' ')[0]}</th>)}<th className="p-2">Done</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.habits.map((h) => {
                  const done = week.filter((d) => data.habitChecks.some((c) => c.habitId === h.id && c.date === d)).length;
                  return (
                    <tr key={h.id} className={cx('border-t', !h.active && 'opacity-60')}>
                      <th scope="row" className="p-2 text-left font-medium">{h.name}</th>
                      {week.map((d) => {
                        const c = data.habitChecks.some((x) => x.habitId === h.id && x.date === d);
                        return <td key={d} className="p-1 text-center"><input type="checkbox" className="h-5 w-5 accent-teal-700" aria-label={`${h.name} on ${formatDateShort(d)}`} checked={c} disabled={d > today} onChange={(e) => toggle(h.id, d, e.target.checked)} /></td>;
                      })}
                      <td className="p-2 text-center">{done > 0 ? <Badge tone="ok" icon="award">{done}</Badge> : '—'}</td>
                      <td className="p-2"><Button variant="ghost" onClick={() => put('habits', { ...h, active: !h.active, updatedAt: new Date().toISOString() })}>{h.active ? 'Pause' : 'Resume'}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function SymptomsLifestylePage() {
  const { params } = useRoute();
  const tab = params.get('tab') ?? 'symptoms';
  const tabs = [{ id: 'symptoms', label: 'Symptoms diary' }, { id: 'lifestyle', label: 'Daily lifestyle notes' }, { id: 'habits', label: 'Habit goals' }];
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Symptoms &amp; Lifestyle</PageTitle>
      <UrgentHelp />
      <div role="tablist" aria-label="Section" className="inline-flex w-full flex-wrap gap-1 rounded-xl bg-slate-200/70 p-1 sm:w-auto">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => navigate(`/symptoms?tab=${t.id}`)} className={cx('min-h-10 flex-1 rounded-lg px-4 text-sm font-semibold transition-colors sm:flex-none', tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel">{tab === 'symptoms' ? <SymptomsTab /> : tab === 'lifestyle' ? <LifestyleTab /> : <HabitsTab />}</div>
    </div>
  );
}
