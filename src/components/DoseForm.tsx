import { useState } from 'react';
import type { DoseRecord, DoseStatus, Medication } from '../types';
import { useStore } from '../store/Store';
import { useDirtyForm } from '../store/dirty';
import { Button, Checkbox, Modal, RadioGroup, TextArea, TextField, useToast, Notice } from './ui';
import { formatClock, instantToZoned, isValidDate, isValidTime, nowTimeIn, todayIn, zonedToInstant } from '../lib/time';
import { uid } from '../lib/defaults';
import { daySlots, doseLabel, medFrequency, medSchedule, nextOpenSlot, scheduleOn, versionAt } from '../lib/medication';

interface Props {
  med: Medication;
  existing?: DoseRecord;
  initialStatus?: DoseStatus;
  date?: string;
  /** Which scheduled dose (0-based). Defaults to the first one not yet recorded that day. */
  doseIndex?: number;
  open: boolean;
  onClose: () => void;
}

/** Record a dose as taken or skipped. The user always chooses; nothing is assumed. */
export function DoseForm({ med, existing, initialStatus, date, doseIndex, open, onClose }: Props) {
  const { data, put } = useStore();
  const toast = useToast();
  const tz = existing?.timeZone ?? data.settings.timeZone;
  const init = existing?.takenAt ? instantToZoned(existing.takenAt, tz) : null;
  const [status, setStatus] = useState<DoseStatus>(existing?.status ?? initialStatus ?? 'taken');
  const [day, setDay] = useState(existing?.date ?? date ?? todayIn(tz));
  const [time, setTime] = useState(init?.time ?? nowTimeIn(tz));
  const [unknown, setUnknown] = useState(existing ? existing.status === 'taken' && !existing.takenAt : false);
  const sched0 = medSchedule(med);
  const [slot, setSlot] = useState<number>(() => {
    if (existing) return existing.doseIndex ?? daySlots(data.doses, med, existing.date).slots.find((x) => x.record?.id === existing.id)?.index ?? 0;
    return doseIndex ?? nextOpenSlot(data.doses, med, date ?? todayIn(tz)) ?? 0;
  });
  const perDose = med.supply?.unitsPerDay != null ? Math.round((med.supply.unitsPerDay / sched0.perDay) * 100) / 100 : null;
  const [units, setUnits] = useState(String(existing?.units ?? perDose ?? ''));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useDirtyForm(`dose-${med.id}`, open && dirty);
  const ch = <T,>(f: (v: T) => void) => (v: T) => { setDirty(true); f(v); };

  // The schedule that applied on the chosen day (it may have changed since).
  const sched = scheduleOn(med, day);
  const label = (i: number) => (sched.perDay === 1 ? doseLabel(med, 0) : `Dose ${i + 1}${sched.times[i] ? ` (${formatClock(sched.times[i]!)})` : ''}`);
  const unscheduled = !sched.doseDay;
  // Another record for the same dose on the same day (several doses a day are normal).
  const duplicates = unscheduled ? [] : daySlots(data.doses.filter((d) => d.id !== existing?.id), med, day).slots.filter((x) => x.index === slot && x.record).map((x) => x.record!);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!isValidDate(day)) e.day = 'Enter a valid date.';
    if (status === 'taken' && !unknown && !isValidTime(time)) e.time = 'Enter the time taken, or tick “I don’t know the exact time”.';
    const u = units.trim() === '' ? null : Number(units);
    if (u != null && (!Number.isFinite(u) || u < 0)) e.units = 'Units must be a number of 0 or more.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const now = new Date().toISOString();
    const z = status === 'taken' && !unknown ? zonedToInstant(day, time, tz) : null;
    const v = versionAt(med, z?.iso ?? now);
    const rec: DoseRecord = {
      id: existing?.id ?? uid(),
      medicationId: med.id,
      date: day,
      status,
      takenAt: z?.iso ?? null,
      timeZone: tz,
      utcOffsetMinutes: z?.offsetMinutes ?? null,
      units: status === 'taken' ? u : null,
      // No scheduled dose that day (only when needed, or not a dose day): not tied to a dose number.
      doseIndex: unscheduled ? null : Math.min(slot, sched.perDay - 1),
      scheduledTime: unscheduled ? null : sched.times[Math.min(slot, sched.perDay - 1)] ?? null,
      nameSnapshot: existing?.nameSnapshot ?? v.name,
      doseSnapshot: existing?.doseSnapshot ?? v.dose,
      notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await put('doses', rec);
    setDirty(false);
    const which = !unscheduled && sched.perDay > 1 ? ` (${label(slot).toLowerCase()})` : '';
    toast(status === 'taken' ? `${med.name}${which} recorded as taken${rec.takenAt ? '' : ' (time unknown)'}.` : `${med.name}${which} recorded as skipped.`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`${existing ? 'Edit' : 'Record'} dose: ${med.name} ${med.dose}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save dose record</Button></>}>
      <div className="flex flex-col gap-4">
 {unscheduled && <Notice tone="info">{medFrequency(med).kind === 'as_needed' ? 'Taken only when needed: each dose is recorded on its own.' : 'No dose is scheduled on this day. The record is kept as an extra dose.'}</Notice>}
        {!unscheduled && sched.perDay > 1 && (
          <RadioGroup
            name={`slot-${med.id}`}
            legend={`Which dose? (${sched.perDay} a day)`}
            value={String(slot)}
            onChange={(v) => { setDirty(true); setSlot(Number(v)); }}
            options={sched.times.map((_, i) => {
              const rec = daySlots(data.doses.filter((d) => d.id !== existing?.id), med, day).slots[i].record;
              return { value: String(i), label: label(i), hint: rec ? `Already recorded as ${rec.status}` : undefined };
            })}
          />
        )}
        <RadioGroup name={`st-${med.id}`} legend="What happened?" value={status} onChange={ch(setStatus)} options={[{ value: 'taken', label: 'Taken' }, { value: 'skipped', label: 'Skipped / not taken' }]} />
        <TextField label="Date" type="date" value={day} onChange={(e) => ch(setDay)(e.target.value)} error={errors.day} />
        {status === 'taken' && (
          <>
            <TextField label="Time actually taken" type="time" value={time} disabled={unknown} onChange={(e) => ch(setTime)(e.target.value)} error={errors.time} hint={`Time zone: ${tz}`} />
            <Checkbox label="I don’t know the exact time" checked={unknown} onChange={ch(setUnknown)} hint="It will show as “Medication time unknown”." />
            {med.supply?.enabled && <TextField label="Units taken" inputMode="decimal" value={units} onChange={(e) => ch(setUnits)(e.target.value)} error={errors.units} hint="Used only for the estimated supply." />}
          </>
        )}
        <TextArea label="Notes" optional value={notes} onChange={(e) => ch(setNotes)(e.target.value)} />
        {duplicates.length > 0 && (
          <Notice tone="warn" title="Possible duplicate">
            There is already a record for {sched.perDay > 1 ? label(slot).toLowerCase() + ' of ' : ''}{med.name} on this date. Both will be kept — you can delete one in History if it was entered twice.
          </Notice>
        )}
        <p className="text-sm text-slate-600">This app never advises delaying, repeating, skipping, stopping or changing a dose. Follow your prescriber’s instructions.</p>
      </div>
    </Modal>
  );
}
