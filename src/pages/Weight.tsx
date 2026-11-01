import { useState } from 'react';
import { useRoute } from '../store/router';
import { useStore } from '../store/Store';
import { useDirtyForm } from '../store/dirty';
import type { Milestone, WeightEntry, WeightUnit } from '../types';
import { NumberField, Badge, Button, Card, Empty, Modal, Notice, Optional, PageTitle, SelectField, Stat, TextArea, TextField, useToast } from '../components/ui';
import { WeightChart } from '../components/Charts';
import { addDays, formatDateShort, formatTime, instantToZoned, isValidDate, isValidTime, todayIn, zonedToInstant } from '../lib/time';
import { describeChange, fmtWeight, fromKg, movingAverage7, toKg, weightProgress } from '../lib/weight';
import { uid } from '../lib/defaults';
import { findDuplicateWeights } from '../lib/quality';

function WeightForm({ existing, onDone }: { existing?: WeightEntry; onDone: () => void }) {
  const { data, put } = useStore();
  const toast = useToast();
  const tz = existing?.timeZone ?? data.settings.timeZone;
  const [unit, setUnit] = useState<WeightUnit>(existing?.enteredUnit ?? data.settings.weightUnit);
  const [value, setValue] = useState(existing ? String(existing.enteredValue) : '');
  const [date, setDate] = useState(existing?.date ?? todayIn(tz));
  const [time, setTime] = useState(existing?.measuredAt ? instantToZoned(existing.measuredAt, tz).time : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  useDirtyForm('weight', value !== (existing ? String(existing.enteredValue) : '') || notes !== (existing?.notes ?? ''));

  const save = async () => {
    const e: Record<string, string> = {};
    const v = Number(value);
    if (value.trim() === '' || !Number.isFinite(v)) e.value = 'Enter your weight as a number, e.g. 82.4.';
    else if (v <= 0) e.value = 'Weight must be greater than zero.';
    if (!isValidDate(date)) e.date = 'Enter a valid date.';
    if (time && !isValidTime(time)) e.time = 'Enter a valid time or leave blank.';
    setErr(e);
    if (Object.keys(e).length) return;
    const kg = toKg(v, unit);
    const last = [...data.weights].filter((w) => w.id !== existing?.id && w.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    const unusual = kg < 30 || kg > 300 ? `${value} ${unit} is unusual. Please check the value and unit.` : last && Math.abs(kg - last.kg) > 5 ? `This is ${fmtWeight(Math.abs(kg - last.kg), unit)} different from your previous entry. Please check the value and unit.` : null;
    if (unusual && !confirmed) {
      setCheck(unusual);
      return;
    }
    const now = new Date().toISOString();
    const z = time ? zonedToInstant(date, time, tz) : null;
    await put('weights', { id: existing?.id ?? uid(), date, measuredAt: z?.iso ?? null, timeZone: tz, utcOffsetMinutes: z?.offsetMinutes ?? null, kg, enteredValue: v, enteredUnit: unit, notes, createdAt: existing?.createdAt ?? now, updatedAt: now });
    toast('Weight saved.');
    setValue('');
    setNotes('');
    setCheck(null);
    setConfirmed(false);
    onDone();
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <TextField label="Weight" inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setCheck(null); setConfirmed(false); }} error={err.value} check={check} className="text-2xl font-bold" />
        <SelectField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as WeightUnit)}>
          <option value="kg">kg</option>
          <option value="lb">lb</option>
        </SelectField>
      </div>
      {unit === 'lb' && value && Number.isFinite(Number(value)) && <p className="text-sm text-slate-600">= {toKg(Number(value), 'lb').toFixed(1)} kg. The value you typed in pounds is also kept.</p>}
      {check && (
        <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-teal-700" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I’ve checked — this is correct</label>
      )}
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={err.date} />
      <Optional summary="Time and notes" defaultOpen={!!existing?.measuredAt || !!existing?.notes}>
        <TextField label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} error={err.time} optional />
        <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} optional hint="e.g. after breakfast, different scales" />
      </Optional>
      <div className="flex gap-2"><Button type="submit" variant="primary">{existing ? 'Save changes' : 'Save weight'}</Button>{existing && <Button onClick={onDone}>Cancel</Button>}</div>
    </form>
  );
}

function GoalForm({ onClose }: { onClose: () => void }) {
  const { data, saveSettings } = useStore();
  const g = data.settings.weightGoal;
  const unit = data.settings.weightUnit;
  const conv = (kg: number | null) => (kg == null ? '' : fromKg(kg, unit).toFixed(1));
  const [start, setStart] = useState(conv(g.startKg));
  const [startDate, setStartDate] = useState(g.startDate ?? '');
  const [goal, setGoal] = useState(conv(g.goalKg));
  const [target, setTarget] = useState(g.targetDate ?? '');
  const [agreed, setAgreed] = useState(g.agreedWith);
  const [ms, setMs] = useState<Milestone[]>(g.milestones);
  const [err, setErr] = useState<Record<string, string>>({});
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const save = async () => {
    const e: Record<string, string> = {};
    for (const [k, v] of [['start', start], ['goal', goal]] as const) if (v.trim() && (!Number.isFinite(Number(v)) || Number(v) <= 0)) e[k] = 'Enter a number greater than zero, or leave blank.';
    if (startDate && !isValidDate(startDate)) e.startDate = 'Enter a valid date.';
    if (target && !isValidDate(target)) e.target = 'Enter a valid date.';
    setErr(e);
    if (Object.keys(e).length) return;
    const k = (s: string) => (num(s) == null ? null : toKg(num(s)!, unit));
    await saveSettings({ ...data.settings, weightGoal: { startKg: k(start), startDate: startDate || null, goalKg: k(goal), targetDate: target || null, agreedWith: agreed, milestones: ms.filter((m) => m.label.trim()) } });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Weight goal" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save goal</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Enter the goal you agreed with your healthcare professional. Values in {unit}.</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField label={`Starting weight (${unit})`} inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} error={err.start} />
          <TextField label="Starting date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={err.startDate} />
          <TextField label={`Goal weight (${unit})`} inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} error={err.goal} />
          <TextField label="Target date" type="date" optional value={target} onChange={(e) => setTarget(e.target.value)} error={err.target} />
        </div>
        <TextField label="Agreed with" optional value={agreed} onChange={(e) => setAgreed(e.target.value)} hint="e.g. GP, dietitian" />
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">Personal milestones (optional)</legend>
          {ms.map((m, i) => (
            <div key={m.id} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
              <TextField label={`Milestone ${i + 1}`} value={m.label} onChange={(e) => setMs(ms.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))} />
              <NumberField label={`At (${unit})`} optional value={m.kg == null ? null : Math.round(fromKg(m.kg, unit) * 10) / 10} isValid={(n) => n == null || n > 0} invalidMessage="Enter a weight greater than zero, or leave blank." onValid={(n) => setMs((cur) => cur.map((x) => (x.id === m.id ? { ...x, kg: n == null ? null : toKg(n, unit) } : x)))} />
              <Button variant="ghost" onClick={() => setMs(ms.filter((x) => x.id !== m.id))} aria-label={`Remove milestone ${i + 1}`}>Remove</Button>
            </div>
          ))}
          <Button onClick={() => setMs([...ms, { id: uid(), label: '', kg: null, achievedOn: null }])}>Add milestone</Button>
          <p className="text-sm text-slate-600">Milestones can be about actions too, such as “walked 3 times this week”.</p>
        </fieldset>
      </div>
    </Modal>
  );
}

export function WeightPage() {
  const { data, remove, saveSettings } = useStore();
  const tz = data.settings.timeZone;
  const unit = data.settings.weightUnit;
  const g = data.settings.weightGoal;
  const [goalOpen, setGoalOpen] = useState(false);
  const { params } = useRoute();
  const [editing, setEditing] = useState<WeightEntry | null>(() => data.weights.find((w) => w.id === params.get('edit')) ?? null);
  const [del, setDel] = useState<WeightEntry | null>(null);
  const today = todayIn(tz);
  const p = weightProgress(data.weights, g.startKg, g.goalKg);
  const ma = movingAverage7(data.weights);
  const latestMa = ma[ma.length - 1];
  const dupes = findDuplicateWeights(data.weights);
  const sorted = [...data.weights].sort((a, b) => b.date.localeCompare(a.date) || (b.measuredAt ?? '').localeCompare(a.measuredAt ?? ''));

  const toggleMilestone = (m: Milestone) =>
    saveSettings({ ...data.settings, weightGoal: { ...g, milestones: g.milestones.map((x) => (x.id === m.id ? { ...x, achievedOn: x.achievedOn ? null : today } : x)) } });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Weigh in whenever suits you — there is no need to weigh daily. Similar conditions each time (same scales, time of day, clothing) make trends easier to read.">Weight</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={editing ? 'Edit weight' : 'Record weight'} icon="weight" iconTone="violet">
          <WeightForm key={editing?.id ?? 'new'} existing={editing ?? undefined} onDone={() => setEditing(null)} />
        </Card>
        <Card title="Progress" icon="chart" iconTone="violet" actions={<Button variant="ghost" icon="pencil" onClick={() => setGoalOpen(true)}>{g.goalKg == null ? 'Set goal' : 'Edit goal'}</Button>}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Starting" value={fmtWeight(g.startKg, unit)} sub={g.startDate ? formatDateShort(g.startDate) : 'Not set'} />
            <Stat label="Current" value={fmtWeight(p.currentKg, unit)} sub={p.currentDate ? formatDateShort(p.currentDate) : 'No entries yet'} />
            <Stat label="Change since starting" value={describeChange(p.changeSinceStart, unit)} />
            <Stat label="Goal" value={fmtWeight(g.goalKg, unit)} sub={g.targetDate ? `Target date ${formatDateShort(g.targetDate)}` : g.agreedWith ? `Agreed with ${g.agreedWith}` : undefined} />
            <Stat label="Remaining towards goal" value={p.remainingToGoal == null ? '—' : Math.abs(p.remainingToGoal) < 0.05 ? 'Goal reached' : `${Math.abs(fromKg(p.remainingToGoal, unit)).toFixed(1)} ${unit}`} />
            <Stat label="7-day moving average" value={latestMa ? fmtWeight(latestMa.avgKg, unit) : '—'} sub={latestMa ? `From ${latestMa.daysContributing} day${latestMa.daysContributing === 1 ? '' : 's'} with a measurement` : undefined} />
          </div>
          {g.milestones.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold">Milestones</h3>
              <ul className="mt-1 space-y-1">
                {g.milestones.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2">
                    {m.achievedOn ? <Badge tone="ok">Reached {formatDateShort(m.achievedOn)}</Badge> : <Badge>Not yet</Badge>}
                    {m.label}{m.kg != null && ` (${fmtWeight(m.kg, unit)})`}
                    <Button variant="ghost" onClick={() => toggleMilestone(m)}>{m.achievedOn ? 'Undo' : 'Mark reached'}</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-600">This app doesn’t suggest calorie intakes, rates of weight loss or treatment changes. Talk with your healthcare professional about your plan.</p>
        </Card>
      </div>
      <Card title="Last 90 days" icon="chart" iconTone="violet">
        <WeightChart weights={data.weights} from={addDays(today, -89)} to={today} unit={unit} goalKg={g.goalKg} />
        <p className="mt-2 text-sm text-slate-600">The 7-day moving average for each day uses only days with a measurement in the previous 7 days. Missing days are never counted as zero.</p>
      </Card>
      <Card title={`Weight history (${sorted.length})`} icon="list" iconTone="slate">
        {sorted.length === 0 ? <Empty>No weight entries yet.</Empty> : (
          <div tabIndex={0} className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="p-2">Date</th><th className="p-2">Time</th><th className="p-2">Weight</th><th className="p-2">As entered</th><th className="p-2">7-day avg (days)</th><th className="p-2">Notes</th><th className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {sorted.map((w) => {
                  const m = ma.find((x) => x.date === w.date);
                  return (
                    <tr key={w.id} className="border-b border-slate-100">
                      <td className="p-2">{formatDateShort(w.date)}</td>
                      <td className="p-2">{w.measuredAt ? formatTime(w.measuredAt, w.timeZone) : '—'}</td>
                      <td className="p-2 font-semibold tabular-nums">{fmtWeight(w.kg, unit)} {dupes.has(w.id) && <Badge tone="warn">Possible duplicate</Badge>}</td>
                      <td className="p-2">{w.enteredValue} {w.enteredUnit}</td>
                      <td className="p-2">{m ? `${fmtWeight(m.avgKg, unit)} (${m.daysContributing})` : '—'}</td>
                      <td className="p-2">{w.notes}</td>
                      <td className="whitespace-nowrap p-2"><Button variant="ghost" onClick={() => { setEditing(w); window.scrollTo(0, 0); }}>Edit</Button><Button variant="ghost" onClick={() => setDel(w)}>Delete</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {goalOpen && <GoalForm onClose={() => setGoalOpen(false)} />}
      <Modal open={!!del} onClose={() => setDel(null)} title="Delete weight entry?" footer={<><Button onClick={() => setDel(null)}>Keep</Button><Button variant="danger" onClick={async () => { await remove('weights', del!.id); setDel(null); }}>Delete</Button></>}>
        <p>{del && `${formatDateShort(del.date)}: ${del.enteredValue} ${del.enteredUnit}`}</p>
      </Modal>
      <Notice tone="info">Weight changes alongside blood pressure changes don’t show that one caused the other.</Notice>
    </div>
  );
}
