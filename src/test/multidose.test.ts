import { describe, it, expect } from 'vitest';
import { dayDoseStatus, dayDoseSummary, daySlots, describeSchedule, doseCounts, doseLabel, medSchedule, nextOpenSlot, scheduleOn, suggestDoseLinks, updateMedication, estimateSupply } from '../lib/medication';
import { dosesCsv } from '../lib/csv';
import { findDuplicateDoses } from '../lib/quality';
import { dueReminders } from '../lib/reminders';
import { reminderEvents } from '../lib/ics';
import { emptyData } from '../lib/defaults';
import type { DoseRecord, Medication } from '../types';

const t0 = '2026-10-01T00:00:00.000Z';
function med(p: Partial<Medication> = {}): Medication {
  return { id: 'm2', name: 'Medicine B', dose: '5 mg', usualTime: '08:00', timesPerDay: 2, doseTimes: ['08:00', '20:00'], instructions: '', active: true, postDoseReminderMinutes: null,
    supply: null, history: [], createdAt: t0, updatedAt: t0, ...p };
}
let n = 0;
function dose(p: Partial<DoseRecord>): DoseRecord {
  n++;
  return { id: `d${n}`, medicationId: 'm2', date: '2026-11-02', status: 'taken', takenAt: '2026-11-01T21:05:00.000Z', timeZone: 'Australia/Sydney', utcOffsetMinutes: 660, units: 1,
    nameSnapshot: 'Medicine B', doseSnapshot: '5 mg', notes: '', createdAt: '2026-11-01T21:06:00.000Z', updatedAt: '2026-11-01T21:06:00.000Z', ...p };
}

describe('medication schedule', () => {
  it('treats older medicines (no schedule fields) as once a day at their usual time', () => {
    const old = med({ timesPerDay: undefined, doseTimes: undefined, usualTime: '07:30' });
    expect(medSchedule(old)).toEqual({ perDay: 1, times: ['07:30'] });
    expect(describeSchedule(old)).toBe('Once a day, usually 7:30 am');
  });

  it('describes several doses a day and labels each dose', () => {
    const m = med({ timesPerDay: 3, doseTimes: ['08:00', null, '20:00'] });
    expect(medSchedule(m)).toEqual({ perDay: 3, times: ['08:00', null, '20:00'] });
    expect(describeSchedule(m)).toBe('3 times a day: 8:00 am, no set time, 8:00 pm');
    expect(doseLabel(m, 0)).toBe('Dose 1 (8:00 am)');
    expect(doseLabel(m, 1)).toBe('Dose 2');
  });

  it('keeps the schedule in the prescription history when it changes', () => {
    const m = med({ history: [{ effectiveFrom: t0, name: 'Medicine B', dose: '5 mg', usualTime: '08:00', timesPerDay: 2, doseTimes: ['08:00', '20:00'], instructions: '' }] });
    const next = updateMedication(m, { timesPerDay: 3, doseTimes: ['08:00', '14:00', '20:00'] }, '2026-11-01T00:00:00.000Z');
    expect(next.history).toHaveLength(2);
    expect(next.history[1]).toMatchObject({ timesPerDay: 3, doseTimes: ['08:00', '14:00', '20:00'] });
    expect(updateMedication(m, { notes: undefined } as never, '2026-11-01T00:00:00.000Z').history).toHaveLength(1);
  });
});

describe('several doses a day', () => {
  const m = med();
  it('shows each dose as not recorded until the patient records it (never "missed")', () => {
    expect(dayDoseStatus([], m, '2026-11-02')).toBe('not_recorded');
    expect(doseCounts([], m, ['2026-11-02'])).toEqual({ expected: 2, taken: 0, skipped: 0, notRecorded: 2 });
  });

  it('counts one of two doses as partly recorded, both as taken', () => {
    const morning = dose({ doseIndex: 0, scheduledTime: '08:00' });
    expect(dayDoseStatus([morning], m, '2026-11-02')).toBe('partial');
    expect(dayDoseSummary([morning], m, '2026-11-02')).toBe('1 of 2 taken');
    expect(nextOpenSlot([morning], m, '2026-11-02')).toBe(1);
    const evening = dose({ doseIndex: 1, scheduledTime: '20:00', takenAt: '2026-11-02T09:10:00.000Z' });
    expect(dayDoseStatus([morning, evening], m, '2026-11-02')).toBe('taken');
    expect(nextOpenSlot([morning, evening], m, '2026-11-02')).toBeNull();
  });

  it('reports a day with every dose skipped as skipped, and a mix as partial', () => {
    const a = dose({ doseIndex: 0, status: 'skipped', takenAt: null });
    const b = dose({ doseIndex: 1, status: 'skipped', takenAt: null });
    expect(dayDoseStatus([a, b], m, '2026-11-02')).toBe('skipped');
    expect(dayDoseStatus([a, dose({ doseIndex: 1 })], m, '2026-11-02')).toBe('partial');
    expect(dayDoseSummary([a, dose({ doseIndex: 1 })], m, '2026-11-02')).toBe('1 of 2 taken, 1 skipped');
  });

  it('puts older records without a dose number into free slots in time order', () => {
    const late = dose({ takenAt: '2026-11-02T09:00:00.000Z' });
    const early = dose({ takenAt: '2026-11-01T21:00:00.000Z' });
    const { slots, extra } = daySlots([late, early], m, '2026-11-02');
    expect(slots.map((s) => s.record?.id)).toEqual([early.id, late.id]);
    expect(extra).toEqual([]);
    const third = dose({ takenAt: '2026-11-02T10:00:00.000Z' });
    expect(daySlots([late, early, third], m, '2026-11-02').extra.map((d) => d.id)).toEqual([third.id]);
  });

  it('once-a-day medicines behave exactly as before', () => {
    const once = med({ timesPerDay: 1, doseTimes: ['07:30'] });
    expect(dayDoseStatus([dose({})], once, '2026-11-02')).toBe('taken');
    expect(dayDoseStatus([dose({ status: 'skipped', takenAt: null })], once, '2026-11-02')).toBe('skipped');
    expect(dayDoseSummary([dose({})], once, '2026-11-02')).toBe('');
  });

  it('flags a duplicate only when the same dose is recorded twice', () => {
    const a = dose({ doseIndex: 0 });
    const b = dose({ doseIndex: 1 });
    expect(findDuplicateDoses([a, b]).size).toBe(0);
    const a2 = dose({ doseIndex: 0 });
    expect([...findDuplicateDoses([a, b, a2])].sort()).toEqual([a.id, a2.id].sort());
    // Older untagged record + a new record for the (only) dose of a once-a-day medicine.
    expect(findDuplicateDoses([dose({}), dose({ doseIndex: 0 })]).size).toBe(2);
  });

  it('supply counts every dose recorded as taken', () => {
    const s = med({ supply: { enabled: true, unitsPerDay: 2, refillThresholdUnits: null, renewalDate: null } });
    const stock = [{ id: 's', medicationId: 'm2', at: '2026-10-31T00:00:00.000Z', kind: 'count' as const, units: 20, note: '', createdAt: t0 }];
    const est = estimateSupply(s, [dose({ doseIndex: 0 }), dose({ doseIndex: 1, takenAt: '2026-11-02T09:00:00.000Z' })], stock, '2026-11-02');
    expect(est.remaining).toBe(18);
    expect(est.daysLeft).toBe(9);
  });
});

describe('reminders for several doses a day', () => {
  const base = emptyData();
  const data = { ...base, settings: { ...base.settings, timeZone: 'Australia/Sydney', reminders: { ...base.settings.reminders, medication: { enabled: true }, postDose: { enabled: true } } } };

  it('reminds once per unrecorded dose after its usual time', () => {
    const d = { ...data, medications: [med()] };
    // 21:00 Sydney on 2 Nov: both doses due.
    const at = new Date('2026-11-02T10:00:00.000Z');
    expect(dueReminders(d, at).filter((r) => r.kind === 'medication').map((r) => r.title)).toEqual(['Medication: Medicine B — dose 1 of 2', 'Medication: Medicine B — dose 2 of 2']);
    const recorded = { ...d, doses: [dose({ doseIndex: 0 })] };
    expect(dueReminders(recorded, at).filter((r) => r.kind === 'medication')).toHaveLength(1);
    // 12:00 Sydney: only the morning dose is due.
    expect(dueReminders(d, new Date('2026-11-02T01:00:00.000Z')).filter((r) => r.kind === 'medication')).toHaveLength(1);
  });

  it('after-medication reading reminders follow only the first dose of the day', () => {
    const m = med({ postDoseReminderMinutes: 60 });
    const d = { ...data, medications: [m], doses: [dose({ doseIndex: 0, takenAt: '2026-11-01T21:05:00.000Z' }), dose({ doseIndex: 1, takenAt: '2026-11-02T09:05:00.000Z' })] };
    const due = dueReminders(d, new Date('2026-11-02T10:30:00.000Z')).filter((r) => r.kind === 'postDose');
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe(`postDose:${d.doses[0].id}`);
  });

  it('calendar export includes every dose time once', () => {
    const d = { ...data, medications: [med(), med({ id: 'm3', timesPerDay: 1, doseTimes: ['08:00'] })] };
    expect(reminderEvents(d).filter((e) => e.uid.startsWith('medication')).map((e) => e.time)).toEqual(['08:00', '20:00']);
  });
});

describe('multi-dose bug fixes', () => {
  it('links a morning after-medication reading only to the first dose of each medicine', () => {
    const morning = dose({ doseIndex: 0, takenAt: '2026-11-01T21:05:00.000Z' });
    const evening = dose({ doseIndex: 1, takenAt: '2026-11-02T09:05:00.000Z' });
    const other = dose({ medicationId: 'm1', takenAt: '2026-11-01T20:30:00.000Z' });
    expect(suggestDoseLinks('2026-11-02', [evening, morning, other]).sort()).toEqual([morning.id, other.id].sort());
    // Older records without a dose number: the earliest one is used.
    const a = dose({ takenAt: '2026-11-02T09:00:00.000Z' });
    const b = dose({ takenAt: '2026-11-01T21:00:00.000Z' });
    expect(suggestDoseLinks('2026-11-02', [a, b])).toEqual([b.id]);
  });

  it('changing how often a medicine is taken does not rewrite earlier days', () => {
    const once = med({ timesPerDay: 1, doseTimes: ['08:00'], history: [{ effectiveFrom: t0, effectiveDate: '2026-10-01', name: 'Medicine B', dose: '5 mg', usualTime: '08:00', timesPerDay: 1, doseTimes: ['08:00'], instructions: '' }] });
    const twice = updateMedication(once, { timesPerDay: 2, doseTimes: ['08:00', '20:00'] }, '2026-11-04T22:00:00.000Z', '2026-11-05');
    expect(twice.history.at(-1)?.effectiveDate).toBe('2026-11-05');
    const before = dose({ date: '2026-11-02', doseIndex: 0 });
    expect(dayDoseStatus([before], twice, '2026-11-02')).toBe('taken'); // was once a day then
    expect(doseCounts([before], twice, ['2026-11-02'])).toEqual({ expected: 1, taken: 1, skipped: 0, notRecorded: 0 });
    const after = dose({ date: '2026-11-05', doseIndex: 0 });
    expect(dayDoseStatus([after], twice, '2026-11-05')).toBe('partial'); // twice a day from the change
  });

  it('older prescription versions without a schedule count as once a day', () => {
    const legacy = med({ timesPerDay: 2, doseTimes: ['08:00', '20:00'], history: [
      { effectiveFrom: t0, name: 'Medicine B', dose: '5 mg', usualTime: '08:00', instructions: '' },
      { effectiveFrom: '2026-11-04T22:00:00.000Z', effectiveDate: '2026-11-05', name: 'Medicine B', dose: '5 mg', usualTime: '08:00', timesPerDay: 2, doseTimes: ['08:00', '20:00'], instructions: '' },
    ] });
    expect(scheduleOn(legacy, '2026-10-15').perDay).toBe(1);
    expect(scheduleOn(legacy, '2026-11-06').perDay).toBe(2);
  });

  it('damaged schedule data falls back to once a day instead of crashing', () => {
    expect(medSchedule(med({ timesPerDay: 'two' as never, doseTimes: 'x' as never, usualTime: '07:00' }))).toEqual({ perDay: 1, times: ['07:00'] });
    expect(medSchedule(med({ timesPerDay: Number.NaN }))).toMatchObject({ perDay: 1 });
    expect(medSchedule(med({ timesPerDay: 99, doseTimes: ['8am', '20:00'] }))).toMatchObject({ perDay: 6, times: [null, '20:00', null, null, null, null] });
    expect(daySlots([], med({ timesPerDay: -3 }), '2026-11-02').slots).toHaveLength(1);
  });

  it('CSV export says which dose each record was for', () => {
    const csv = dosesCsv({ ...emptyData(), doses: [dose({ doseIndex: 1, scheduledTime: '20:00' })] });
    const [head, row] = csv.split(/\r?\n/);
    expect(head.endsWith('dose_number,scheduled_time')).toBe(true);
    expect(row.endsWith(',2,20:00')).toBe(true);
  });
});
