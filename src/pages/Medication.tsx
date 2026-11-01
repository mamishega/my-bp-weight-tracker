import { useState } from 'react';
import { useStore } from '../store/Store';
import { useDirtyForm } from '../store/dirty';
import type { DoseRecord, DoseStatus, Medication, StockEvent } from '../types';
import { Badge, Button, Card, Checkbox, Empty, Modal, Notice, PageTitle, TextArea, TextField, useToast, Optional } from '../components/ui';
import { DoseForm } from '../components/DoseForm';
import { dayDoseStatus, estimateSupply, updateMedication } from '../lib/medication';
import { formatClock, formatDateShort, formatTime, isValidDate, isValidTime, localDateOf, nowTimeIn, todayIn, zonedToInstant, addDays, dateRange } from '../lib/time';
import { uid } from '../lib/defaults';
import { findDuplicateDoses } from '../lib/quality';

function MedForm({ med, onClose }: { med?: Medication; onClose: () => void }) {
  const { put } = useStore();
  const toast = useToast();
  const [name, setName] = useState(med?.name ?? '');
  const [dose, setDose] = useState(med?.dose ?? '');
  const [time, setTime] = useState(med?.usualTime ?? '');
  const [instr, setInstr] = useState(med?.instructions ?? '');
  const [active, setActive] = useState(med?.active ?? true);
  const [postMins, setPostMins] = useState(med?.postDoseReminderMinutes == null ? '' : String(med.postDoseReminderMinutes));
  const [supplyOn, setSupplyOn] = useState(med?.supply?.enabled ?? false);
  const [perDay, setPerDay] = useState(String(med?.supply?.unitsPerDay ?? '1'));
  const [threshold, setThreshold] = useState(med?.supply?.refillThresholdUnits == null ? '' : String(med.supply.refillThresholdUnits));
  const [renewal, setRenewal] = useState(med?.supply?.renewalDate ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useDirtyForm('med-form', dirty);
  const d = <T,>(f: (v: T) => void) => (v: T) => { setDirty(true); f(v); };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter the medication name as prescribed.';
    if (time && !isValidTime(time)) e.time = 'Enter a valid time.';
    const pm = postMins.trim() === '' ? null : Number(postMins);
    if (pm != null && (!Number.isInteger(pm) || pm < 1 || pm > 1440)) e.postMins = 'Enter whole minutes between 1 and 1440, or leave blank.';
    const pd = Number(perDay);
    if (supplyOn && (!Number.isFinite(pd) || pd <= 0)) e.perDay = 'Enter the prescribed units per day (more than 0).';
    const th = threshold.trim() === '' ? null : Number(threshold);
    if (th != null && (!Number.isFinite(th) || th < 0)) e.threshold = 'Enter 0 or more, or leave blank.';
    if (renewal && !isValidDate(renewal)) e.renewal = 'Enter a valid date.';
    setErr(e);
    if (Object.keys(e).length) return;
    const now = new Date().toISOString();
    const supply = { enabled: supplyOn, unitsPerDay: pd || 1, refillThresholdUnits: th, renewalDate: renewal || null };
    const fields = { name: name.trim(), dose: dose.trim(), usualTime: time || null, instructions: instr, active, postDoseReminderMinutes: pm, supply };
    const rec: Medication = med
      ? updateMedication(med, fields, now)
      : { id: uid(), ...fields, history: [{ effectiveFrom: now, name: fields.name, dose: fields.dose, usualTime: fields.usualTime, instructions: instr }], createdAt: now, updatedAt: now };
    await put('medications', rec);
    setDirty(false);
    toast(med ? 'Medication updated. Previous details are kept in its history.' : 'Medication added.');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={med ? `Edit ${med.name}` : 'Add morning medication'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <TextField label="Medication name" value={name} onChange={(e) => d(setName)(e.target.value)} error={err.name} />
        <TextField label="Dose" value={dose} onChange={(e) => d(setDose)(e.target.value)} hint="As written on your prescription, e.g. 10 mg, 1 tablet." optional />
        <TextField label="Usual morning time" type="time" value={time} onChange={(e) => d(setTime)(e.target.value)} error={err.time} optional />
        <TextArea label="Prescription instructions" value={instr} onChange={(e) => d(setInstr)(e.target.value)} optional />
        <TextField label="After-medication reading reminder (minutes after the recorded dose)" inputMode="numeric" value={postMins} onChange={(e) => d(setPostMins)(e.target.value)} error={err.postMins} optional hint="Only enter this if your clinician asked for after-medication readings, using the interval they gave you. The app does not suggest an interval." />
        <Checkbox label="Currently taking this medication" checked={active} onChange={d(setActive)} hint="Inactive medications stay in your history and reports." />
        <Optional summary="Supply tracking (optional, estimates only)" defaultOpen={supplyOn}>
          <Checkbox label="Track estimated supply" checked={supplyOn} onChange={d(setSupplyOn)} />
          {supplyOn && (
            <>
              <TextField label="Prescribed units taken per day" inputMode="decimal" value={perDay} onChange={(e) => d(setPerDay)(e.target.value)} error={err.perDay} />
              <TextField label="Refill reminder when estimated units reach" inputMode="numeric" value={threshold} onChange={(e) => d(setThreshold)(e.target.value)} error={err.threshold} optional />
              <TextField label="Prescription renewal date" type="date" value={renewal} onChange={(e) => d(setRenewal)(e.target.value)} error={err.renewal} optional />
              <p className="text-sm text-slate-600">After saving, enter a manual count of units on hand to start the estimate.</p>
            </>
          )}
        </Optional>
      </div>
    </Modal>
  );
}

function StockForm({ med, onClose }: { med: Medication; onClose: () => void }) {
  const { data, put } = useStore();
  const toast = useToast();
  const tz = data.settings.timeZone;
  const [kind, setKind] = useState<StockEvent['kind']>('count');
  const [units, setUnits] = useState('');
  const [date, setDate] = useState(todayIn(tz));
  const [time, setTime] = useState(nowTimeIn(tz));
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    const u = Number(units);
    if (units.trim() === '' || !Number.isFinite(u) || u < 0) return setErr('Enter a number of units (0 or more).');
    if (!isValidDate(date) || !isValidTime(time)) return setErr('Enter a valid date and time.');
    const z = zonedToInstant(date, time, tz);
    await put('stock', { id: uid(), medicationId: med.id, at: z.iso, kind, units: u, note, createdAt: new Date().toISOString() });
    toast(kind === 'count' ? 'Manual count saved. The estimate now starts from this count.' : 'Refill added to the estimate.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Supply: ${med.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Type of supply entry">
          <Button aria-pressed={kind === 'count'} variant={kind === 'count' ? 'primary' : 'secondary'} onClick={() => setKind('count')}>Manual count / correction</Button>
          <Button aria-pressed={kind === 'add'} variant={kind === 'add' ? 'primary' : 'secondary'} onClick={() => setKind('add')}>Add refill</Button>
        </div>
        <p className="text-sm text-slate-600">{kind === 'count' ? 'The number of units you actually have on hand right now. The estimate restarts from this count.' : 'Units added, e.g. a new box.'}</p>
        <TextField label={kind === 'count' ? 'Units on hand' : 'Units added'} inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} error={err || null} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} optional />
      </div>
    </Modal>
  );
}

function SupplyPanel({ med }: { med: Medication }) {
  const { data, remove } = useStore();
  const [open, setOpen] = useState(false);
  const tz = data.settings.timeZone;
  const est = estimateSupply(med, data.doses, data.stock, todayIn(tz));
  const events = data.stock.filter((e) => e.medicationId === med.id).sort((a, b) => b.at.localeCompare(a.at));
  if (!med.supply?.enabled) return null;
  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-400 p-3">
      <p className="font-semibold">Estimated supply <Badge tone="neutral" icon="≈">Estimate</Badge></p>
      {!est.known ? (
        <p className="text-slate-700">Enter a manual count to start the estimate.</p>
      ) : (
        <>
          <p className="text-3xl font-bold tabular-nums">≈ {est.remaining} units</p>
          <p className="text-sm text-slate-700">
            {est.countedUnits} counted {formatDateShort(localDateOf(est.countedAt!, tz))} + {est.addedSince} added − {est.usedSince} used by {est.dosesCounted} dose{est.dosesCounted === 1 ? '' : 's'} recorded as taken since.
            {est.daysLeft != null && <> About {est.daysLeft} days at {med.supply.unitsPerDay} per day.</>}
          </p>
          {est.belowThreshold && <Badge tone="warn">At or below your refill reminder level</Badge>}
        </>
      )}
      {med.supply.renewalDate && <p className="mt-1 text-sm">Prescription renewal: {formatDateShort(med.supply.renewalDate)} {est.renewalSoon && <Badge tone="warn">Within 14 days</Badge>}</p>}
      <p className="mt-1 text-xs text-slate-600">Only doses you record as taken reduce the estimate. It is recalculated from your records each time, so editing or deleting a dose never counts twice. Always check your actual supply.</p>
      <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => setOpen(true)}>Count / add refill</Button></div>
      {events.length > 0 && (
        <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">Supply entries ({events.length})</summary>
          <ul className="mt-1 space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                {formatDateShort(localDateOf(e.at, tz))} {formatTime(e.at, tz)} — {e.kind === 'count' ? `counted ${e.units}` : `added ${e.units}`} {e.note && `(${e.note})`}
                <Button variant="ghost" onClick={() => remove('stock', e.id)} aria-label={`Delete supply entry from ${e.at}`}>Delete</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {open && <StockForm med={med} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function MedicationPage() {
  const { data, remove } = useStore();
  const tz = data.settings.timeZone;
  const today = todayIn(tz);
  const [edit, setEdit] = useState<Medication | 'new' | null>(null);
  const [doseFor, setDoseFor] = useState<{ med: Medication; dose?: DoseRecord; status?: DoseStatus; date?: string } | null>(null);
  const [delDose, setDelDose] = useState<DoseRecord | null>(null);
  const meds = [...data.medications].sort((a, b) => Number(b.active) - Number(a.active));
  const dupes = findDuplicateDoses(data.doses);
  const recent = [...data.doses].sort((a, b) => b.date.localeCompare(a.date) || (b.takenAt ?? '').localeCompare(a.takenAt ?? '')).slice(0, 60);
  const days = dateRange(addDays(today, -13), today);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Record each dose as you take it. The app never advises delaying, repeating, skipping, stopping or changing a dose.">Medication &amp; Supply</PageTitle>
      <div><Button variant="primary" onClick={() => setEdit('new')}>➕ Add medication</Button></div>
      {meds.length === 0 && <Empty>No medications yet. Add the morning medication(s) you have been prescribed.</Empty>}
      {meds.map((m) => {
        const st = dayDoseStatus(data.doses, m.id, today);
        return (
          <Card key={m.id} title={<>{m.name} <span className="font-normal text-slate-700">{m.dose}</span> {!m.active && <Badge>Inactive</Badge>}</>} actions={<Button variant="ghost" onClick={() => setEdit(m)}>Edit</Button>}>
            <p className="text-slate-700">Usual time: {formatClock(m.usualTime)} · After-medication reminder: {m.postDoseReminderMinutes == null ? 'not set' : `${m.postDoseReminderMinutes} min after recorded dose (from your clinician’s instructions)`}</p>
            {m.instructions && <p className="mt-1 text-sm text-slate-700">Instructions: {m.instructions}</p>}
            {m.active && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-medium">Today:</span>
                {st === 'not_recorded' ? <Badge icon="○">Not recorded</Badge> : st === 'taken' ? <Badge tone="ok">Taken</Badge> : <Badge tone="info" icon="⤼">Skipped</Badge>}
                <Button variant="primary" onClick={() => setDoseFor({ med: m, status: 'taken', date: today })}>Record taken</Button>
                <Button onClick={() => setDoseFor({ med: m, status: 'skipped', date: today })}>Record skipped</Button>
              </div>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="text-center text-sm">
                <caption className="text-left text-sm font-medium">Last 14 days</caption>
                <thead><tr>{days.map((d) => <th key={d} scope="col" className="px-1 font-normal text-slate-600">{d.slice(8)}</th>)}</tr></thead>
                <tbody><tr>{days.map((d) => {
                  const s = dayDoseStatus(data.doses, m.id, d);
                  return <td key={d} className="px-1" title={`${d}: ${s.replace('_', ' ')}`}><span aria-label={`${d}: ${s === 'not_recorded' ? 'not recorded' : s}`}>{s === 'taken' ? '✔' : s === 'skipped' ? '⤼' : '·'}</span></td>;
                })}</tr></tbody>
              </table>
              <p className="text-xs text-slate-600">✔ taken · ⤼ skipped · · not recorded</p>
            </div>
            <SupplyPanel med={m} />
            {m.history.length > 1 && (
              <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">Prescription history ({m.history.length} versions)</summary>
                <ul className="mt-1 text-sm">
                  {[...m.history].reverse().map((v, i) => <li key={i}>From {formatDateShort(localDateOf(v.effectiveFrom, tz))}: {v.name} {v.dose}, usual time {formatClock(v.usualTime)}{v.instructions && `, “${v.instructions}”`}</li>)}
                </ul>
              </details>
            )}
          </Card>
        );
      })}

      <Card title="Dose records">
        {recent.length === 0 ? <Empty>No doses recorded yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b"><th className="p-2">Date</th><th className="p-2">Medication</th><th className="p-2">Status</th><th className="p-2">Time taken</th><th className="p-2">Notes</th><th className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {recent.map((d) => {
                  const med = data.medications.find((m) => m.id === d.medicationId);
                  return (
                    <tr key={d.id} className="border-b border-slate-100">
                      <td className="p-2">{formatDateShort(d.date)}</td>
                      <td className="p-2">{d.nameSnapshot} {d.doseSnapshot}</td>
                      <td className="p-2">{d.status === 'taken' ? '✔ Taken' : '⤼ Skipped'} {dupes.has(d.id) && <Badge tone="warn">Possible duplicate</Badge>}</td>
                      <td className="p-2">{d.status !== 'taken' ? '—' : d.takenAt ? formatTime(d.takenAt, d.timeZone, tz) : <Badge tone="warn">Medication time unknown</Badge>}</td>
                      <td className="p-2">{d.notes}</td>
                      <td className="whitespace-nowrap p-2">
                        {med && <Button variant="ghost" onClick={() => setDoseFor({ med, dose: d })}>Edit</Button>}
                        <Button variant="ghost" onClick={() => setDelDose(d)}>Delete</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Notice tone="info">Missing a record never means a dose was missed — it only means nothing was recorded.</Notice>

      {edit && <MedForm med={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {doseFor && <DoseForm open med={doseFor.med} existing={doseFor.dose} initialStatus={doseFor.status} date={doseFor.date} onClose={() => setDoseFor(null)} />}
      <Modal open={!!delDose} onClose={() => setDelDose(null)} title="Delete dose record?" footer={<><Button onClick={() => setDelDose(null)}>Keep</Button><Button variant="danger" onClick={async () => { await remove('doses', delDose!.id); setDelDose(null); }}>Delete</Button></>}>
        <p>The estimated supply will be recalculated automatically. Readings linked to this dose will show “No dose linked”.</p>
      </Modal>
    </div>
  );
}
