import { useState } from 'react';
import type { DoseRecord, DoseStatus, Medication } from '../types';
import { useStore } from '../store/Store';
import { useDirtyForm } from '../store/dirty';
import { Button, Checkbox, Modal, RadioGroup, TextArea, TextField, useToast, Notice } from './ui';
import { instantToZoned, isValidDate, isValidTime, nowTimeIn, todayIn, zonedToInstant } from '../lib/time';
import { uid } from '../lib/defaults';
import { versionAt } from '../lib/medication';

interface Props {
  med: Medication;
  existing?: DoseRecord;
  initialStatus?: DoseStatus;
  date?: string;
  open: boolean;
  onClose: () => void;
}

/** Record a dose as taken or skipped. The user always chooses; nothing is assumed. */
export function DoseForm({ med, existing, initialStatus, date, open, onClose }: Props) {
  const { data, put } = useStore();
  const toast = useToast();
  const tz = existing?.timeZone ?? data.settings.timeZone;
  const init = existing?.takenAt ? instantToZoned(existing.takenAt, tz) : null;
  const [status, setStatus] = useState<DoseStatus>(existing?.status ?? initialStatus ?? 'taken');
  const [day, setDay] = useState(existing?.date ?? date ?? todayIn(tz));
  const [time, setTime] = useState(init?.time ?? nowTimeIn(tz));
  const [unknown, setUnknown] = useState(existing ? existing.status === 'taken' && !existing.takenAt : false);
  const [units, setUnits] = useState(String(existing?.units ?? med.supply?.unitsPerDay ?? ''));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useDirtyForm(`dose-${med.id}`, open && dirty);
  const ch = <T,>(f: (v: T) => void) => (v: T) => { setDirty(true); f(v); };

  const duplicates = data.doses.filter((d) => d.medicationId === med.id && d.date === day && d.id !== existing?.id);

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
      nameSnapshot: existing?.nameSnapshot ?? v.name,
      doseSnapshot: existing?.doseSnapshot ?? v.dose,
      notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await put('doses', rec);
    setDirty(false);
    toast(status === 'taken' ? `${med.name} recorded as taken${rec.takenAt ? '' : ' (time unknown)'}.` : `${med.name} recorded as skipped.`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`${existing ? 'Edit' : 'Record'} dose: ${med.name} ${med.dose}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save dose record</Button></>}>
      <div className="flex flex-col gap-4">
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
            There {duplicates.length === 1 ? 'is already a record' : `are already ${duplicates.length} records`} for {med.name} on this date. Both will be kept — you can delete one in History if it was entered twice.
          </Notice>
        )}
        <p className="text-sm text-slate-600">This app never advises delaying, repeating, skipping, stopping or changing a dose. Follow your prescriber’s instructions.</p>
      </div>
    </Modal>
  );
}
